"""Build the monthly folder of MPR PDFs from mpr_data.json + comments.json.

Output: "MPR DV <Teacher> <Month Year>/" with one PDF per student
("<Last> - <Month Year> - MPR.pdf"), plus a combined review PDF, a zip of the
folder and VERIFICATION.txt. Every PDF starts with the email block (To + Subject).

comments.json format (keys = the "key" field in mpr_data.json, e.g. "Doe, Jane"):
  {"Doe, Jane": {"comment": "...", "satisfactory": false,
                  "concerns": ["attendance","time","graduation","communications","wslp"],
                  "exclude_courses": ["Geometry A"], "grade": "11", "exclude": false}}
Any field except "comment" is optional and overrides the proposal in mpr_data.json.
"""
import os
import re
import sys
import json
import glob
import shutil
import argparse
import subprocess
import tempfile
from reportlab.lib.pagesizes import letter as LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, Spacer, Image, KeepTogether
from xml.sax.saxutils import escape

CONCERNS = [("attendance", "Student attendance check-ins"),
            ("time", "Amount of time student is engaged in coursework"),
            ("communications", "Student responding to staff communications promptly and appropriately"),
            ("wslp", "Students meeting objectives as indicated in WSLP or Intervention Plan"),
            ("graduation", "Student making adequate progress to on time graduation")]


def fonts():
    cands = {"R": ["FiraSans-Regular.ttf"], "B": ["FiraSans-SemiBold.ttf", "FiraSans-Bold.ttf"],
             "I": ["FiraSans-Italic.ttf"], "S": ["DejaVuSans.ttf"]}
    found = {}
    for k, names in cands.items():
        for n in names:
            hits = glob.glob(f"/usr/share/fonts/**/{n}", recursive=True) + glob.glob(os.path.expanduser(f"~/Library/Fonts/{n}"))
            if hits:
                pdfmetrics.registerFont(TTFont("MPR" + k, hits[0])); found[k] = "MPR" + k; break
    reg = found.get("R", "Helvetica")
    return reg, found.get("B", "Helvetica-Bold"), found.get("I", "Helvetica-Oblique"), found.get("S", reg)


def header_image(template, workdir):
    if shutil.which("pdfimages"):
        subprocess.run(["pdfimages", "-png", "-f", "1", "-l", "1", template, os.path.join(workdir, "hdr")], check=True)
        imgs = sorted(glob.glob(os.path.join(workdir, "hdr-*.png")))
        if imgs:
            from PIL import Image as PImage
            base = PImage.open(imgs[0]).convert("RGB")
            if len(imgs) > 1:
                base.putalpha(PImage.open(imgs[1]).convert("L"))
            out = os.path.join(workdir, "header.png"); base.save(out)
            return out, base.size
    from pypdf import PdfReader
    img = PdfReader(template).pages[0].images[0]
    out = os.path.join(workdir, "header.png"); img.image.save(out)
    return out, img.image.size


def build_one(st, c, month, path, hdr, F):
    REG, BOLD, ITAL, SYM = F
    B = ParagraphStyle("b", fontName=BOLD, fontSize=10.5, leading=14)
    N = ParagraphStyle("n", fontName=REG, fontSize=10.5, leading=14.5)
    T = ParagraphStyle("t", fontName=BOLD, fontSize=14, alignment=TA_CENTER, spaceBefore=4, spaceAfter=10)
    CH = ParagraphStyle("c", fontName=BOLD, fontSize=10, leading=12, alignment=TA_CENTER)
    CL = ParagraphStyle("cl", fontName=BOLD, fontSize=10, leading=12)
    SM = ParagraphStyle("s", fontName=ITAL, fontSize=8, leading=10, textColor=colors.HexColor("#444444"))
    EH = ParagraphStyle("eh", fontName=REG, fontSize=9.5, leading=13)
    box = lambda on: f'<font name="{SYM}">{"&#9746;" if on else "&#9744;"}</font>'
    cb = lambda text, on: Paragraph(f"&nbsp;&nbsp;&nbsp;&nbsp;{box(on)}&nbsp;&nbsp;{escape(text)}", B)
    sat = c.get("satisfactory", st["proposed"]["satisfactory"])
    conc = c.get("concerns", st["proposed"]["concerns"])
    grade = c.get("grade", st.get("grade", ""))
    excl = set(c.get("exclude_courses", []))
    doc = SimpleDocTemplate(path, pagesize=LETTER, leftMargin=0.6 * inch, rightMargin=0.6 * inch,
                            topMargin=0.4 * inch, bottomMargin=0.5 * inch,
                            title=f"Monthly Progress Report - {month} - {st['display_name']}", author="Seaview Academy")
    to = [f"{escape(r['name'])} ({escape(r['relationship'])}) &lt;{escape(r['email'])}&gt;" for r in st["recipients"]]
    et = Table([[Paragraph(f'<font name="{BOLD}">To:</font>', EH), Paragraph("<br/>".join(to) or "(no email on file)", EH)],
                [Paragraph(f'<font name="{BOLD}">Subject:</font>', EH), Paragraph(f"SV - MPR - {month.split()[0]} Overviews", EH)]],
               colWidths=[0.8 * inch, 6.5 * inch])
    et.setStyle([("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#5b7c99")), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#eef3f7")),
                 ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)])
    w, h = hdr[1]
    st_ = [et, Spacer(1, 10), Image(hdr[0], width=5.7 * inch, height=5.7 * inch * h / w),
           Paragraph(f"Monthly Progress Report - {month}", T),
           Paragraph(f'Student Name: <font name="{REG}">{escape(st["display_name"])}</font>', B),
           Paragraph(f'Grade Level: <font name="{REG}">{escape(str(grade))}</font>', B)]
    info = Table([[Paragraph(f'Gradebook Snapshot: <font name="{REG}">Imagine Edgenuity Group Progress</font>', B),
                   Paragraph(f'Date Taken: <font name="{REG}">{escape(c.get("date_taken", st.get("date_taken", "")))}</font>', B)]],
                 colWidths=[4.6 * inch, 2.7 * inch])
    info.setStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)])
    st_.append(info)
    rows = [[Paragraph(x, CH if i else CL) for i, x in enumerate(["Course", "Actual<br/>Grade", "Grade", "On Target?", "Percent<br/>Complete", "On Target?"])]]
    for r in st["courses"]:
        if r["course"] in excl:
            continue
        if not r["started"]:
            rows.append([Paragraph(escape(r["course"]), CL), Paragraph("—", CH), Paragraph("—", CH), Paragraph("—", CH),
                         Paragraph('0%<br/><font size="7">Not started</font>', CH), Paragraph("No", CH)])
        else:
            rows.append([Paragraph(escape(r["course"]), CL), Paragraph(f"{r['og']:.1f}%", CH), Paragraph(r["letter"], CH),
                         Paragraph("Yes" if r["grade_on_target"] else "No", CH),
                         Paragraph(f'{r["percent"]}%<br/><font size="7">{r["goal_label"]}</font>', CH),
                         Paragraph("Yes" if r["complete_on_target"] else "No", CH)])
    t = Table(rows, colWidths=[2.35 * inch, 0.9 * inch, 0.75 * inch, 1.05 * inch, 1.1 * inch, 1.15 * inch], repeatRows=1)
    t.setStyle([("GRID", (0, 0), (-1, -1), 0.75, colors.black), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)])
    st_ += [t, Spacer(1, 3), Paragraph("Actual Grade is the grade on completed work. Percent Complete is time-weighted; Goal is where the student should be by this date based on the course calendar. Goal: on pace means the student is on or ahead of schedule.", SM), Spacer(1, 10),
            Paragraph("See attached Session Log for detailed account of time logged into Edgenuity and number of activities completed.", B), Spacer(1, 10),
            Paragraph("Student is making Satisfactory Monthly progress as evidenced by gradebook snapshot:", B),
            cb("Yes", sat), cb("No", not sat), Spacer(1, 10), Paragraph("There are concerns with:", B)]
    st_ += [cb(label, key in conc) for key, label in CONCERNS]
    st_.append(Spacer(1, 10))
    cm = Table([[Paragraph(escape(c["comment"]), N)]], colWidths=[7.3 * inch])
    cm.setStyle([("BOX", (0, 0), (-1, -1), 0.75, colors.black), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                 ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)])
    st_.append(KeepTogether([Paragraph("Additional Comments:", B), Spacer(1, 3), cm]))
    L = ParagraphStyle("x", fontName=REG, fontSize=7.5, alignment=TA_CENTER)
    sig = Table([["", "", ""], [Paragraph("Certificated Staff", L), "", Paragraph("Date", L)]], colWidths=[4.4 * inch, 0.9 * inch, 1.6 * inch],
                rowHeights=[26, 16], hAlign="LEFT")
    sig.setStyle([("LINEBELOW", (0, 0), (0, 0), 0.8, colors.black), ("LINEBELOW", (2, 0), (2, 0), 0.8, colors.black),
                  ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 1), (-1, 1), 3)])
    st_.append(KeepTogether([Spacer(1, 12), Paragraph("Date Monthly Progress Report was shared with:", B), cb("Student", False), cb("Family", False), Spacer(1, 6), sig]))
    doc.build(st_)


def verify(students, comments, files):
    problems = []
    for st in students:
        c = comments[st["key"]]
        path = files[st["key"]]
        txt = subprocess.run(["pdftotext", path, "-"], capture_output=True, text=True).stdout if shutil.which("pdftotext") else ""
        for r in st["courses"]:
            if r["course"] in set(c.get("exclude_courses", [])) or not r["started"]:
                continue
            for v in (f"{r['og']:.1f}%", f"{r['percent']}%"):
                if txt and v not in txt:
                    problems.append(f"{st['display_name']}: {r['course']} value {v} not found in PDF")
        if not st["recipients"]:
            problems.append(f"{st['display_name']}: no email recipients")
        if not c.get("comment", "").strip():
            problems.append(f"{st['display_name']}: empty comment")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data"); ap.add_argument("comments")
    ap.add_argument("--month", required=True, help='e.g. "November 2026"')
    ap.add_argument("--teacher", required=True, help="teacher last name for the folder, e.g. Smith")
    ap.add_argument("--date-taken", default="", help="date of the Edgenuity snapshot, e.g. 11/27/2026")
    ap.add_argument("--template", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "templates", "2027_Monthly_Progress_Report_Template.pdf"))
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    data, comments = json.load(open(a.data)), json.load(open(a.comments))
    students = [s for s in data["students"] if not comments.get(s["key"], {}).get("exclude")]
    missing = [s["key"] for s in students if s["key"] not in comments]
    if missing:
        sys.exit("Missing comments for: " + "; ".join(missing))
    folder = os.path.join(a.out, f"MPR DV {a.teacher} {a.month}")
    shutil.rmtree(folder, ignore_errors=True); os.makedirs(folder)
    F = fonts()
    lastcount = {}
    for s in students:
        lastcount[s["last"]] = lastcount.get(s["last"], 0) + 1
    files = {}
    with tempfile.TemporaryDirectory() as tmp:
        hdr = header_image(a.template, tmp)
        for s in students:
            c = dict(comments[s["key"]]); c.setdefault("date_taken", a.date_taken)
            first = s["display_name"].split()[0]
            fn = (f"{s['last']}, {first}" if lastcount[s["last"]] > 1 else s["last"]) + f" - {a.month} - MPR.pdf"
            files[s["key"]] = os.path.join(folder, fn)
            build_one(s, c, a.month, files[s["key"]], hdr, F)
    problems = verify(students, comments, files)
    from pypdf import PdfWriter
    w = PdfWriter()
    for k in sorted(files.values()):
        w.append(k)
    review = os.path.join(a.out, f"MPR DV {a.teacher} {a.month} - REVIEW.pdf"); w.write(review)
    with open(os.path.join(a.out, f"VERIFICATION {a.month}.txt"), "w") as f:
        f.write(f"{len(students)} reports built\n")
        f.write("No problems found\n" if not problems else "\n".join(problems) + "\n")
        f.write("\nFlags from the data check:\n" + "\n".join(data.get("flags", [])) + "\n")
    shutil.make_archive(folder, "zip", a.out, os.path.basename(folder))
    print(f"{len(students)} reports -> {folder}.zip ; review -> {review} ; problems: {len(problems)}")
    for p in problems:
        print("  PROBLEM:", p)


if __name__ == "__main__":
    main()
