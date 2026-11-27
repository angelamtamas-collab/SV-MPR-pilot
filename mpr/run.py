"""One command: exports in, folder of Monthly Progress Reports out.

  python3 mpr/run.py --edgenuity progress.pdf --skyward skyward.pdf \
      --month "November 2026" --teacher Smith --date-taken 11/27/2026 --out ~/MPR-work

First run: writes mpr_data.json and draft comments.json into --out, then stops so you can
read and edit the comments. Run the same command again to build the reports.
Use --template to point at your own copy of the template (default: templates/).
"""
import os
import sys
import json
import argparse
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from compute import build          # noqa: E402
from draft_comments import draft   # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--edgenuity", required=True, help="Edgenuity Group Progress Overview PDF")
    ap.add_argument("--skyward", required=True, help="Skyward Information Report PDF (attendance + family emails)")
    ap.add_argument("--month", required=True); ap.add_argument("--teacher", required=True)
    ap.add_argument("--date-taken", default="")
    ap.add_argument("--template", default=os.path.join(HERE, "..", "templates", "2027_Monthly_Progress_Report_Template.pdf"))
    ap.add_argument("--out", required=True, help="working folder OUTSIDE this repository")
    a = ap.parse_args()
    out = os.path.abspath(os.path.expanduser(a.out))
    repo = os.path.abspath(os.path.join(HERE, ".."))
    if out == repo or out.startswith(repo + os.sep):
        sys.exit("Choose an --out folder outside the repository so student data is never committed.")
    os.makedirs(out, exist_ok=True)
    data_path, com_path = os.path.join(out, "mpr_data.json"), os.path.join(out, "comments.json")
    data = build(a.edgenuity, a.skyward)
    json.dump(data, open(data_path, "w"), indent=2)
    print(f"{len(data['students'])} students, {sum(len(s['courses']) for s in data['students'])} courses.")
    if data["flags"]:
        print("\nPlease review:\n  - " + "\n  - ".join(data["flags"]))
    if not os.path.exists(com_path):
        json.dump({s["key"]: {"comment": draft(s)} for s in data["students"]}, open(com_path, "w"), indent=2)
        print(f"\nDraft comments written to {com_path}.\nRead and edit them, then run this same command again to build the reports.")
        return
    cmd = [sys.executable, os.path.join(HERE, "build_reports.py"), data_path, com_path,
           "--month", a.month, "--teacher", a.teacher, "--date-taken", a.date_taken,
           "--template", a.template, "--out", out]
    sys.stdout.flush()
    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    main()
