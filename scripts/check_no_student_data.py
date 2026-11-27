"""Block commits that contain student data. Run before every push (or as a git pre-commit hook):

  python3 scripts/check_no_student_data.py          # checks files staged for commit
  python3 scripts/check_no_student_data.py --all    # checks every tracked file

Fails if it finds email addresses, student-ID-style school emails, phone numbers, or data
file types (exports, reports) outside templates/ and examples/.
"""
import re
import sys
import subprocess

ALLOWED_EMAILS = {"noreply@anthropic.com"}
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"\(\d{3}\)\s?\d{3}-\d{4}")
BLOCKED_EXT = (".csv", ".xlsx", ".xls", ".zip", ".json", ".pdf")
ALLOWED_DIRS = ("templates/", "examples/")
VENDOR_DIRS = ("app/source/lib/",)  # unmodified third-party libraries (pdf.js, pdf-lib, JSZip)


def files(all_files):
    cmd = ["git", "ls-files"] if all_files else ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"]
    return [f for f in subprocess.run(cmd, capture_output=True, text=True).stdout.splitlines() if f]


def main():
    problems = []
    for f in files("--all" in sys.argv):
        if f.lower().endswith(BLOCKED_EXT) and not f.startswith(ALLOWED_DIRS):
            problems.append(f"{f}: data file type is not allowed in this repository")
            continue
        if f.lower().endswith(".pdf") or f.startswith(VENDOR_DIRS):
            continue
        try:
            text = open(f, encoding="utf-8").read()
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        for e in set(EMAIL.findall(text)) - ALLOWED_EMAILS:
            if not e.endswith("example.com"):
                problems.append(f"{f}: contains an email address ({e})")
        if PHONE.search(text):
            problems.append(f"{f}: contains a phone number")
    if problems:
        print("Student data check FAILED:\n  " + "\n  ".join(problems))
        sys.exit(1)
    print("Student data check passed.")


if __name__ == "__main__":
    main()
