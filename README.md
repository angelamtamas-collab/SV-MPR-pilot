# Seaview Monthly Progress Reports (MPR)

Turns your monthly exports into one finished Monthly Progress Report PDF per student.

| You provide | Where it comes from | What it supplies |
| --- | --- | --- |
| Student progress data | Edgenuity **Group Progress Overview**, saved as PDF | Grades, percent complete, pace goals |
| Attendance + email file | Skyward **Information Report** (Attendance Detail + Family Members), PDF | Grade level, student and family emails, attendance |
| Template | `templates/2027_Monthly_Progress_Report_Template.pdf` (or your own copy) | The report layout and school header |

Each PDF starts with the email block (student + family recipients and the subject
`SV - MPR - <Month> Overviews`), followed by the completed report. Reports are saved in a folder
named `MPR DV <YourLastName> <Month Year>`, one file per student (`<Last> - <Month Year> - MPR.pdf`),
plus a combined REVIEW PDF, a zip, and a VERIFICATION file that re-checks every number.

**This repository contains no student data, and it must stay that way.** See "Keeping it clean" below.

## Option A: the MPR Maker web app (any browser, no AI account needed)
Open **https://angelamtamas-collab.github.io/SV-MPR-pilot/** (it asks for the staff password), upload your two
PDFs, review each student, and download the finished folder. Tick **Auto populate comments** in
step 4 for draft comments, or leave it unticked to write your own. Everything stays in your
browser tab. You can also download `app/index.html` and double-click it to open it in Chrome.

## Option B: with ChatGPT
Custom GPTs can no longer be created on personal ChatGPT accounts, so use a **Project**:
1. In ChatGPT, create a new Project named "Seaview MPR".
2. Open the Project's instructions and paste the whole of `AGENTS.md`.
3. Add `docs/RULES.md` and `examples/sample-comments.json` as Project files.
4. Start chats inside the Project. ChatGPT walks you through the web app step by step and
   helps write comments. It does not build the PDFs itself; the web app does.
OpenAI Codex reads `AGENTS.md` from this repository automatically.

## Option C: with Gemini
1. At gemini.google.com, open **Gem manager** and click **New Gem**. Name it "Seaview MPR".
2. Paste the whole of `AGENTS.md` into Instructions.
3. Under Knowledge, add `docs/RULES.md` and `examples/sample-comments.json`. Save.
4. Chat with the Gem; it guides you through the web app and helps write comments.
Gemini CLI reads `GEMINI.md` from this repository automatically.

## Option D: with Claude
Fork this repository, connect your fork to Claude (Settings → Connectors → GitHub, then install
the Claude GitHub App on your fork), and start a chat with the fork attached. `CLAUDE.md` makes
the assistant walk you through each month one question at a time, write the comments with you,
and hand back the finished folder.

`AGENTS.md`, `GEMINI.md` and `CLAUDE.md` hold the same instructions. If you change one, copy
the change into the other two.

## Option E: on your own Mac
One-time setup in **Terminal** (Applications → Utilities → Terminal). Paste each line, press Return:
```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install python poppler git
git clone https://github.com/<your-account>/<your-fork>.git ~/mpr
pip3 install -r ~/mpr/requirements.txt
```
Each month (put your exports in a folder such as `~/MPR-work/November`, never inside `~/mpr`):
```
cd ~/mpr
python3 mpr/run.py --edgenuity ~/MPR-work/November/progress.pdf --skyward ~/MPR-work/November/skyward.pdf --month "November 2026" --teacher YourLastName --date-taken 11/27/2026 --out ~/MPR-work/November
```
The first run checks your data, lists anything that needs your decision, and writes draft comments
to `~/MPR-work/November/comments.json`. Open that file in TextEdit, read and edit every comment,
save, then run the same command again to build the reports.

To use your own template, add `--template ~/path/to/your_template.pdf`.

## How each report is filled in
See `docs/RULES.md` (grades, pace goals, on-target checks, attendance rule, checkboxes).
To adjust any box for one student, add it to that student's entry in `comments.json`:
```
"Doe, Jane": {"comment": "...", "satisfactory": true, "concerns": ["time"], "exclude_courses": ["Geometry B"]}
```
Concern keys: `attendance`, `time`, `communications`, `wslp`, `graduation`.

## Keeping it clean (required)
- Never put exports, contact lists, `mpr_data.json`, `comments.json` or reports in the repository.
  `run.py` refuses to write inside it, and `.gitignore` blocks those file types.
- Before every push, run `python3 scripts/check_no_student_data.py --all`. It fails on email
  addresses, phone numbers, and data files.
- To run the check automatically on every commit:
  `printf '#!/bin/sh\npython3 scripts/check_no_student_data.py\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`
- The parsers ignore Skyward health alerts, birthdates and home addresses, and never print excused-absence reasons.
- Check district policy before using AI tools with student records.

## Contents
| Path | What it does |
| --- | --- |
| `AGENTS.md`, `GEMINI.md`, `CLAUDE.md` | The same assistant instructions for ChatGPT, Gemini and Claude |
| `app/index.html` | The MPR Maker web app (one file, runs in any browser) |
| `mpr/run.py` | One command: exports in, reports out |
| `mpr/parse_edgenuity.py` | Reads the Edgenuity Group Progress Overview PDF |
| `mpr/parse_skyward.py` | Reads the Skyward Information Report PDF |
| `mpr/compute.py` | Applies the rules and lists flags for your review |
| `mpr/draft_comments.py` | Drafts a first-pass comment for each student |
| `mpr/build_reports.py` | Builds the PDFs, review PDF, zip and verification file |
| `scripts/check_no_student_data.py` | Blocks commits that contain student data |
| `docs/RULES.md` | How every field and checkbox is decided |
| `templates/` | The blank 2027 Monthly Progress Report template |
| `examples/sample-comments.json` | Comment file format (fictional student) |
