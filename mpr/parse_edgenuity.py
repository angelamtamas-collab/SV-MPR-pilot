"""Parse an Imagine Edgenuity "Group Progress Overview" page saved as PDF.

Returns a list of students:
  {"name_raw": "DOE, JANE", "last": "Doe", "first": "Jane",
   "courses": [{"name","time","count","rg","og","ag"}], "attendance": {...} or None}
The teacher's attendance check-in course (name contains "Attendance") is returned
separately as "attendance", never as a course.
"""
import re
import sys
import json
import pdfplumber

PCT = re.compile(r"^\d+(?:\.\d+)?%$")
STUDENT = re.compile(r"^[A-Za-z][A-Za-z'\-. ]*,\s*[A-Za-z][A-Za-z'\-. ]*$")
STOP = ("Back to Home", "Copyright")


def _title(s):
    s = s.strip().lower()
    s = re.sub(r"(^|[\s\-'])([a-z])", lambda m: m.group(1) + m.group(2).upper(), s)
    return re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), s)


def _lines(pdf_path):
    """Yield text lines (reading order) with page header/footer and watermark removed."""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            # drop browser print header/footer (Times) and the page-number watermark (Arial Bold)
            page = page.filter(lambda o: o.get("object_type") != "char" or
                               not any(f in o.get("fontname", "") for f in ("Times", "Arial-Bold")))
            words = page.extract_words(keep_blank_chars=False, use_text_flow=False)
            rows = {}
            for w in words:
                key = round(w["top"] / 3)  # ~3pt buckets
                rows.setdefault(key, []).append(w)
            for key in sorted(rows):
                ws = sorted(rows[key], key=lambda w: w["x0"])
                yield [w["text"] for w in ws]


def parse(pdf_path):
    students, cur, last_row, started = [], None, None, False
    for toks in _lines(pdf_path):
        text = " ".join(toks).strip()
        if not text:
            continue
        if text.startswith(STOP):
            break
        if text == "Latest":
            started = True
            continue
        if not started:
            continue
        if text.startswith("Course Name"):
            continue
        tail = toks[-5:]
        if len(toks) >= 6 and all(PCT.match(t) for t in tail):
            name = " ".join(toks[:-5])
            vals = [float(t[:-1]) for t in tail]
            row = dict(zip(["time", "count", "rg", "og", "ag"], vals))
            row["name"] = name
            if cur is None:
                raise ValueError("course row before any student: " + text)
            cur["_rows"].append(row)
            last_row = row
            continue
        if STUDENT.match(text) and "%" not in text:
            last, first = [p.strip() for p in text.split(",", 1)]
            cur = {"name_raw": text, "last": _title(last), "first": _title(first), "_rows": []}
            students.append(cur)
            last_row = None
            continue
        if last_row is not None:  # wrapped course name continues below its row
            last_row["name"] += " " + text
    for s in students:
        rows = s.pop("_rows")
        att = [r for r in rows if "attendance" in r["name"].lower()]
        s["attendance"] = att[0] if att else None
        s["courses"] = [r for r in rows if r not in att]
    return students


if __name__ == "__main__":
    print(json.dumps(parse(sys.argv[1]), indent=2))
