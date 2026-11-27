"""Combine Edgenuity + Skyward exports into one reviewable data file (mpr_data.json).

Applies the Seaview MPR rules (see docs/RULES.md). Comments are NOT written here:
the assistant writes them in comments.json after the teacher confirms this data.
"""
import re
import sys
import json
import argparse
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_edgenuity import parse as parse_edg
from parse_skyward import parse as parse_sky

ATTENDANCE_AG_OK = 90.0      # Edgenuity attendance-course AG at/above this = check-ins posted
NEAR_GOAL = 5.0              # within this many points of the goal counts as on target
PASSING = 60.0


def letter(p):
    for cut, l in [(93, "A"), (90, "A-"), (87, "B+"), (83, "B"), (80, "B-"), (77, "C+"),
                   (73, "C"), (70, "C-"), (67, "D+"), (60, "D")]:
        if p >= cut:
            return l
    return "F"


def clean_course(name):
    n = name.strip()
    lincoln = bool(re.match(r"^(Lincoln|LINCOLN HIGH SCHOOL)\b", n))
    n = re.sub(r"^(SV\s?\d\d|SV HS \d{4}|SEAVIEW ACADEMY|Seaview|LINCOLN HIGH SCHOOL|Lincoln)\s+", "", n)
    n = re.sub(r"^(SV\s?\d\d|SV HS \d{4})\s+", "", n)
    n = re.sub(r"\s*-\s*\d{1,2}/\d{1,2}/\d{4}$", "", n)
    n = re.sub(r":\s*(1st|2nd)\s+Semester", "", n)
    n = re.sub(r"\s*-?\s*(WA)?\d{4,6}$", "", n)
    n = re.sub(r"\s*-\s*$", "", n).strip()
    return n + (" (Lincoln)" if lincoln else "")


def course_row(c):
    if c["og"] == 0 and c["time"] == 0:
        return {"course": clean_course(c["name"]), "raw_name": c["name"], "started": False,
                "og": None, "letter": "—", "grade_on_target": None, "percent": 0,
                "goal": None, "goal_label": "Not started", "complete_on_target": False, "source": c}
    on_pace = c["ag"] >= c["og"] - 0.05
    goal = None if on_pace else min(100.0, c["time"] * c["og"] / c["ag"]) if c["ag"] > 0 else 100.0
    return {"course": clean_course(c["name"]), "raw_name": c["name"], "started": True,
            "og": c["og"], "letter": letter(c["og"]), "grade_on_target": c["og"] >= PASSING,
            "percent": round(c["time"]), "goal": goal,
            "goal_label": "Goal: on pace" if goal is None else f"Goal: {round(goal)}%",
            "complete_on_target": goal is None or c["time"] >= goal - NEAR_GOAL, "source": c}


def match(edg, sky):
    """Match an Edgenuity student to a Skyward record by last name + first-name prefix."""
    cands = [s for s in sky if s["last"].lower() == edg["last"].lower()]
    f = edg["first"].lower()
    best = [s for s in cands if s["first"].lower().startswith(f) or f.startswith(s["first"].lower())]
    return best[0] if len(best) == 1 else None


def build(edg_pdf, sky_pdf):
    edg, sky = parse_edg(edg_pdf), parse_sky(sky_pdf)
    out, flags, used = [], [], set()
    for e in edg:
        s = match(e, sky)
        rows = [course_row(c) for c in e["courses"]]
        started = [r for r in rows if r["started"]]
        behind = [r for r in started if not r["complete_on_target"]]
        not_started = [r for r in rows if not r["started"]]
        failing = [r for r in started if not r["grade_on_target"]]
        att_ag = e["attendance"]["ag"] if e["attendance"] else None
        st = {"key": f"{e['last']}, {e['first']}", "edgenuity_name": e["name_raw"],
              "first": e["first"], "last": e["last"], "courses": rows,
              "edgenuity_attendance_ag": att_ag}
        if s is None:
            flags.append(f"{e['first']} {e['last']}: not found in the Skyward report (no grade, email or attendance).")
            st.update({"display_name": f"{e['first']} {e['last']}", "grade": "", "recipients": [],
                       "attendance_status": "unknown", "absence_dates": [], "other_school_absence_days": 0})
        else:
            used.add(s["name_raw"])
            dates = sorted({a["date"] for a in s["home_absences"]})
            no_contact = any(any("NC" in c for c in a["codes"]) for a in s["home_absences"])
            if dates:
                status = "absent"
            elif att_ag is not None and att_ag < ATTENDANCE_AG_OK:
                status = "meets_requirements_post_checkins"
            else:
                status = "ok"
            rec = []
            if s["school_email"]:
                rec.append({"name": f"{s['first']} {s['last']}", "relationship": "student", "email": s["school_email"]})
            for f in s["family"]:
                if f["email"]:
                    rec.append({"name": f["name"], "relationship": f["relationship"].lower(), "email": f["email"]})
                else:
                    flags.append(f"{s['first']} {s['last']}: no email on file for {f['name']} ({f['relationship'].lower()}).")
            other_days = len({a["date"] for a in s["other_absences"]})
            st.update({"display_name": f"{s['first']} {s['last']}", "grade": s["grade"], "recipients": rec,
                       "attendance_status": status, "absence_dates": dates, "absence_no_contact": no_contact,
                       "other_school_absence_days": other_days})
            if s["restriction"]:
                flags.append(f"{s['first']} {s['last']}: {s['restriction']}")
            if other_days:
                flags.append(f"{s['first']} {s['last']}: {other_days} day(s) of absences at another school in Skyward (not written into the comment unless you say so).")
            if len(rec) < 2:
                flags.append(f"{s['first']} {s['last']}: only {len(rec)} email recipient(s).")
        for r in not_started:
            flags.append(f"{st['display_name']}: {r['course']} shows 0% and no grade (Not started). Keep it on the report?")
        concerns = []
        if st["attendance_status"] == "absent":
            concerns.append("attendance")
        if len(behind) >= 2 or (behind and len(started) <= 2):
            concerns.append("time")
        if not_started or (st.get("grade") == "12" and len(behind) >= 2) or failing:
            concerns.append("graduation")
        st["proposed"] = {
            "satisfactory": not failing and not not_started and len(behind) <= max(1, len(started) // 3),
            "concerns": concerns,
        }
        st["summary"] = {"behind": [r["course"] for r in behind], "not_started": [r["course"] for r in not_started],
                         "failing": [r["course"] for r in failing]}
        out.append(st)
    for s in sky:
        if s["name_raw"] not in used:
            flags.append(f"{s['first']} {s['last']}: in Skyward but not in the Edgenuity export, so no report.")
    return {"students": out, "flags": flags}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("edgenuity_pdf"); ap.add_argument("skyward_pdf"); ap.add_argument("-o", "--out", default="mpr_data.json")
    a = ap.parse_args()
    data = build(a.edgenuity_pdf, a.skyward_pdf)
    json.dump(data, open(a.out, "w"), indent=2)
    print(f"{len(data['students'])} students, {sum(len(s['courses']) for s in data['students'])} courses, {len(data['flags'])} flags -> {a.out}")
