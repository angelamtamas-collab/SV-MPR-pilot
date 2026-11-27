"""Draft a first-pass comments.json from mpr_data.json, using simple rules.

The drafts are a starting point: the teacher (or the Claude assistant) should read and
edit every comment before reports go out. Names come only from the input data.
"""
import os
import sys
import json
import argparse
from datetime import date

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]


def _d(s):
    m, d, y = (int(x) for x in s.split("/"))
    return date(2000 + y if y < 100 else y, m, d)


def format_dates(strs):
    ds = sorted({_d(s) for s in strs})
    if not ds:
        return ""
    runs, cur = [], [ds[0]]
    for x in ds[1:]:
        gap = (x - cur[-1]).days
        if gap == 1 or (gap == 3 and cur[-1].weekday() == 4):  # next day, or Fri -> Mon
            cur.append(x)
        else:
            runs.append(cur); cur = [x]
    runs.append(cur)
    parts = []
    for r in runs:
        a, b = r[0], r[-1]
        if a == b:
            parts.append(f"{MONTHS[a.month - 1]} {a.day}")
        elif len(r) == 2 and a.month == b.month:
            parts.append(f"{MONTHS[a.month - 1]} {a.day} and {b.day}")
        elif a.month == b.month:
            parts.append(f"{MONTHS[a.month - 1]} {a.day} to {b.day}")
        else:
            parts.append(f"{MONTHS[a.month - 1]} {a.day} to {MONTHS[b.month - 1]} {b.day}")
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def join(items):
    items = list(items)
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def draft(st):
    first = st["first"]
    started = [r for r in st["courses"] if r["started"]]
    behind = sorted([r for r in started if not r["complete_on_target"]],
                    key=lambda r: (r["goal"] or 0) - r["percent"], reverse=True)
    not_started = [r for r in st["courses"] if not r["started"]]
    done = [r for r in started if r["percent"] >= 100]
    strong = [r for r in started if r["actual"] >= 90]
    s = []
    if done:
        s.append(f"Congratulations to {first} on finishing {join(r['course'] for r in done)}!")
    on_pace = not behind and not not_started
    tail = " and is on pace in every course" if on_pace else ""
    if strong:
        s.append(f"{first} has {'an A' if len(strong) == 1 else 'A\'s'} in {join(r['course'] for r in strong[:3])}{tail}.")
    elif started and all(r["grade_on_target"] for r in started):
        s.append(f"{first} is passing every course{tail}.")
    elif on_pace:
        s.append(f"{first} is on pace in every course.")
    if not on_pace:
        bits = [f"{r['course']} is {r['percent']}% complete (goal about {round(r['goal'])}%)" for r in behind[:2]]
        if bits:
            s.append("The main concern is pace: " + join(bits) + ".")
        if not_started:
            s.append(f"{join(r['course'] for r in not_started)} {'has' if len(not_started) == 1 else 'have'} not been started yet.")
    status = st.get("attendance_status")
    if status == "absent":
        nc = " with no contact" if st.get("absence_no_contact") else ""
        s.append(f"Our attendance records show {first} absent{nc} {'from' if ' to ' in format_dates(st['absence_dates']) else 'on'} {format_dates(st['absence_dates'])}, so please make sure {first} connects with me every week.")
    elif status == "meets_requirements_post_checkins":
        s.append(f"Attendance requirements are being met, but some check-ins haven't been posted in Edgenuity, so please remind {first} to post them each week.")
    serious = "graduation" in st["proposed"]["concerns"] or len(behind) >= 3 or not_started
    if serious:
        s.append(f"I'd like to meet with {first} and family to make a plan for getting back on track.")
    elif behind:
        s.append(f"Setting aside time each school day for {behind[0]['course']} will help close the gap.")
    else:
        s.append(f"Keep up the great work, {first}!")
    return " ".join(s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data"); ap.add_argument("-o", "--out", default="comments.json")
    a = ap.parse_args()
    data = json.load(open(a.data))
    out = {st["key"]: {"comment": draft(st)} for st in data["students"]}
    json.dump(out, open(a.out, "w"), indent=2)
    print(f"Drafted {len(out)} comments -> {a.out}. Read and edit them before building reports.")


if __name__ == "__main__":
    main()
