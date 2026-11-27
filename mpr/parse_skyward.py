"""Parse a Skyward "Information Report" (student profile + family + attendance detail).

Keeps only what MPRs need: name, grade, school/home email, guardian names + emails,
attendance detail, and a flag when an Alert mentions a legal contact restriction.
Health alerts, birthdates and addresses are deliberately NOT extracted.
"""
import re
import sys
import json
import shutil
import subprocess

HEADER = re.compile(r"^([A-Z][A-Z .'\-]+?)\s{3,}(.+?)\s{3,}Grade\s+(\S+)\s*$")
NOISE = re.compile(r"^\s*(1serst\S*|05\.\d\d\.\S+)")
RESTRICT = re.compile(r"no contact|protection order|restrain|custody|court order|not to be within", re.I)
PHONE = re.compile(r"\(\d{3}\)\s*\d{3}-\d{4}")
DATE_ROW = re.compile(r"^\s*(\d\d/\d\d/\d\d)\s+(\w{3})\s+(Yes|No)?\s*(.*)$")
TYPE_ROW = re.compile(r"^\s*([A-Z0-9]{1,3})\s*:\s*(.+?)\s+Days:\s*(\d+)\s+Periods:\s*(\d+)")


def _text(path):
    if shutil.which("pdftotext"):
        return subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, check=True).stdout
    import pdfplumber
    with pdfplumber.open(path) as pdf:
        return "\n".join(p.extract_text(layout=True) or "" for p in pdf.pages)


def _title(s):
    s = s.strip().lower()
    s = re.sub(r"(^|[\s\-'])([a-z])", lambda m: m.group(1) + m.group(2).upper(), s)
    return re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), s)


def parse(path):
    lines = [l for l in _text(path).splitlines() if not NOISE.match(l)]
    students, cur = {}, None
    section, att = None, None
    for i, line in enumerate(lines):
        m = HEADER.match(line.strip())
        if m:
            full = m.group(1).strip()
            cur = students.get(full)
            if cur is None:
                parts = full.split()
                cur = {"name_raw": full, "first": _title(parts[0]), "last": _title(parts[-1]),
                       "grade": m.group(3).lstrip("0") or "0", "school_email": "", "home_email": "",
                       "entity": "", "family": [], "restriction": "", "attendance": []}
                students[full] = cur
            section = None
            continue
        if cur is None:
            continue
        s = line.strip()
        if s.startswith("Profile Information"):
            section = "profile"; continue
        if s.startswith("Family Members"):
            section = "family"; continue
        if s.startswith("Attendance Detail"):
            section = "attendance"
            att = {"school": "", "rows": [], "types": []}
            cur["attendance"].append(att)
            continue
        if s.startswith("Attendance Types") or s.startswith("Attendance Reasons"):
            section = "att_types"; continue
        if section == "profile":
            if "School Email:" in line:
                cur["school_email"] = line.split("School Email:")[1].split()[0] if line.split("School Email:")[1].split() else ""
            if "Home Email:" in line:
                rest = line.split("Home Email:")[1].split()
                cur["home_email"] = rest[0] if rest and "@" in rest[0] else ""
            if "Entity:" in line:
                cur["entity"] = line.split("Entity:")[1].strip().split("/")[0]
            if s.startswith("Alert:") or (cur.get("_in_alert") and s and not s.startswith("_")):
                cur["_in_alert"] = not s.startswith("_")
                if RESTRICT.search(s):
                    cur["restriction"] = "Skyward alert mentions a court order or no-contact restriction - review recipients before sending."
            if s.startswith("_"):
                cur["_in_alert"] = False
        elif section == "family":
            nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
            if nxt.startswith("Guardian Email:") and s and not s.startswith("Family"):
                body = PHONE.sub("", s).strip()
                parts = [p for p in re.split(r"\s{2,}", body) if p]
                rel, name = ("", parts[0]) if len(parts) == 1 else (parts[0], parts[1])
                email = nxt.split("Guardian Email:")[1].strip()
                name_t = _title(name)
                if name_t.lower() == f"{cur['first']} {cur['last']}".lower():
                    continue  # student listed as own guardian
                if not any(f["name"] == name_t for f in cur["family"]):
                    cur["family"].append({"name": name_t, "relationship": _title(rel) or "Guardian",
                                          "email": email.lower() if email else ""})
        elif section == "attendance":
            sm = re.match(r"^\s*(\d{3})/(.+)$", line)
            if sm and not att["rows"]:
                att["school"] = sm.group(1)
                continue
            dm = DATE_ROW.match(line)
            if dm:
                att["rows"].append({"date": dm.group(1), "day": dm.group(2), "codes": dm.group(4).split()})
        elif section == "att_types":
            tm = TYPE_ROW.match(line)
            if tm and att is not None:
                att["types"].append({"code": tm.group(1), "desc": tm.group(2).strip(),
                                     "days": int(tm.group(3)), "periods": int(tm.group(4))})
    out = []
    for st in students.values():
        st.pop("_in_alert", None)
        home = st["entity"] or "520"
        st["home_absences"], st["other_absences"] = [], []
        for a in st["attendance"]:
            bucket = "home_absences" if a["school"] in ("", home) else "other_absences"
            for r in a["rows"]:
                st[bucket].append({"school": a["school"] or home, "date": r["date"], "codes": r["codes"]})
        out.append(st)
    return out


if __name__ == "__main__":
    print(json.dumps(parse(sys.argv[1]), indent=2))
