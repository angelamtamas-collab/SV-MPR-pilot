#!/usr/bin/env python3
"""Build app/index.html (one self-contained file) from app/source/.

Edit the files in app/source/, then run:  python3 scripts/build_standalone.py
"""
import base64, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "app" / "source"
OUT = ROOT / "app" / "index.html"

def b64(p): return base64.b64encode((SRC / p).read_bytes()).decode()
def text(p): return (SRC / p).read_text(encoding="utf-8")

html = text("index.html")

# Images -> data URIs
html = re.sub(r'<img src="(img/[^"]+\.png)"', lambda m: f'<img src="data:image/png;base64,{b64(m.group(1))}"', html)

# Classic libraries inline
for lib in ("lib/pdf-lib.min.js", "lib/jszip.min.js"):
    tag = f'<script src="{lib}"></script>'
    assert html.count(tag) == 1, tag
    html = html.replace(tag, "<script>" + text(lib) + "\n</script>")

# Core module -> function scope
core = text("mpr-core.js")
exports = re.findall(r'^export (?:async function|function|const) (\w+)', core, flags=re.M)
core = re.sub(r'^export ', '', core, flags=re.M)

app = text("app.js")
head, rest = app.split("\n", 4)[:4], app.split("\n", 4)[4]
assert head[0].startswith("import * as pdfjsLib") and head[1].startswith("import * as core"), "app.js imports changed"
rest = rest.replace('if (!state.header) state.header = new Uint8Array(await (await fetch("header.png")).arrayBuffer());',
                    'if (!state.header) state.header = b64bytes(HEADER_B64);')
assert "HEADER_B64" in rest, "header loader changed"

module = (
    '\nconst b64bytes = s => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };\n'
    'const blobUrl = id => URL.createObjectURL(new Blob([b64bytes(document.getElementById(id).textContent.trim())], { type: "text/javascript" }));\n'
    'const pdfjsLib = await import(blobUrl("lib-pdfjs"));\n'
    'pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrl("lib-pdfjs-worker");\n'
    'const HEADER_B64 = document.getElementById("img-header").textContent.trim();\n\n'
    'const core = (() => {\n' + core + '\nreturn { ' + ", ".join(exports) + ' };\n})();\n' + rest
)
tag = '<script type="module" src="app.js"></script>'
assert html.count(tag) == 1
html = html.replace(tag,
    f'<script type="text/plain" id="lib-pdfjs">{b64("lib/pdf.min.js")}</script>\n'
    f'<script type="text/plain" id="lib-pdfjs-worker">{b64("lib/pdf.worker.min.js")}</script>\n'
    f'<script type="text/plain" id="img-header">{b64("header.png")}</script>\n'
    f'<script type="module">{module}</script>')
OUT.write_text(html, encoding="utf-8")
print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
