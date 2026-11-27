// MPR core: parse Skyward + Edgenuity PDFs, apply the Seaview MPR rules, draft comments,
// and draw each report with pdf-lib. Runs in the browser and in Node (libs are passed in).
// All student data stays in memory; nothing here stores or sends it.

const PCT = /^\d+(?:\.\d+)?%$/;
const STUDENT_NAME = /^[A-Za-z][A-Za-z'\-. ]*,\s*[A-Za-z][A-Za-z'\-. ]*$/;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export const CONCERNS = [
  ["attendance", "Student attendance check-ins"],
  ["time", "Amount of time student is engaged in coursework"],
  ["communications", "Student responding to staff communications promptly and appropriately"],
  ["wslp", "Students meeting objectives as indicated in WSLP or Intervention Plan"],
  ["graduation", "Student making adequate progress to on time graduation"],
];

const title = s => s.trim().toLowerCase()
  .replace(/(^|[\s\-'])([a-z])/g, (m, a, b) => a + b.toUpperCase())
  .replace(/\bMc([a-z])/g, (m, a) => "Mc" + a.toUpperCase());

// ---------- PDF text extraction ----------
export async function readPdf(pdfjsLib, data) {
  const doc = await pdfjsLib.getDocument({ data, verbosity: 0, isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(tc.items.filter(it => it.str && it.str.trim()).map(it => ({
      str: it.str, x: it.transform[4], y: it.transform[5], w: it.width,
      font: it.fontName, family: (tc.styles[it.fontName] || {}).fontFamily || "",
    })));
  }
  return pages;
}

function groupLines(items, tol = 2) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= tol) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  lines.forEach(l => l.items.sort((a, b) => a.x - b.x));
  return lines;
}

export function looksLikeSkyward(pages) {
  const t = pages.slice(0, 2).flat().map(i => i.str).join(" ");
  return /Information Report/.test(t) && /Family Members|Profile Information/.test(t);
}
export function looksLikeEdgenuity(pages) {
  const t = pages.slice(0, 1).flat().map(i => i.str).join(" ");
  return /Group Progress Overview/.test(t) && /% \(Time\)/.test(t);
}

// ---------- Edgenuity Group Progress Overview ----------
export function parseEdgenuity(pages) {
  const students = []; let cur = null, lastRow = null, started = false, done = false;
  for (const items of pages) {
    if (done) break;
    const longFonts = new Set(items.filter(i => i.str.trim().length > 3).map(i => i.font));
    const clean = items.filter(i => i.family !== "serif" && !(/^\d{1,2}$/.test(i.str.trim()) && !longFonts.has(i.font)));
    for (const line of groupLines(clean)) {
      const text = line.items.map(i => i.str.trim()).join(" ").trim();
      if (!text) continue;
      if (/^(Back to Home|Copyright)/.test(text) || line.items.some(i => /^Back to Home/.test(i.str))) { done = true; break; }
      const nameItem = line.items.find(i => STUDENT_NAME.test(i.str.trim()) && !i.str.includes("%"));
      if (nameItem && line.items.length <= 2 && !/Course Name/.test(text)) {
        const [last, first] = nameItem.str.split(",").map(s => s.trim());
        cur = { name_raw: nameItem.str.trim(), last: title(last), first: title(first), rows: [] };
        students.push(cur); lastRow = null; started = true; continue;
      }
      if (!started || /^Course Name/.test(text)) continue;
      const pcts = line.items.filter(i => PCT.test(i.str.trim()));
      if (pcts.length >= 5 && cur) {
        const vals = pcts.slice(-5).map(i => parseFloat(i.str));
        const name = line.items.filter(i => !PCT.test(i.str.trim())).map(i => i.str.trim()).join(" ");
        lastRow = { name, time: vals[0], count: vals[1], rg: vals[2], og: vals[3], ag: vals[4] };
        cur.rows.push(lastRow); continue;
      }
      if (lastRow) lastRow.name += " " + text;
    }
  }
  for (const s of students) {
    const att = s.rows.filter(r => /attendance/i.test(r.name));
    s.attendance = att[0] || null;
    s.courses = s.rows.filter(r => !att.includes(r));
    delete s.rows;
  }
  return students;
}

// ---------- Skyward Information Report ----------
function skywardText(pages) {
  // Rebuild the fixed-width layout: column = x / character width.
  const out = [];
  for (const items of pages) {
    const ws = items.filter(i => i.str.length > 3).map(i => i.w / i.str.length);
    const cw = ws.length ? ws.sort((a, b) => a - b)[Math.floor(ws.length / 2)] : 4.8;
    for (const line of groupLines(items, 1.5)) {
      let s = "";
      for (const it of line.items) {
        const col = Math.max(Math.round((it.x - 12) / cw), s.length ? s.length + 1 : 0);
        s = s.padEnd(col, " ") + it.str;
      }
      out.push(s);
    }
  }
  return out;
}

const HEADER = /^([A-Z][A-Z .'\-]+?)\s{3,}(.+?)\s{3,}Grade\s+(\S+)\s*$/;
const NOISE = /^\s*(1serst\S*|05\.\d\d\.\S+)/;
const RESTRICT = /no contact|protection order|restrain|custody|court order|not to be within/i;
const PHONE = /\(\d{3}\)\s*\d{3}-\d{4}/g;
const DATE_ROW = /^\s*(\d\d\/\d\d\/\d\d)\s+(\w{3})\s+(Yes|No)?\s*(.*)$/;
const TYPE_ROW = /^\s*([A-Z0-9]{1,3})\s*:\s*(.+?)\s+Days:\s*(\d+)\s+Periods:\s*(\d+)/;

export function parseSkyward(pages) {
  const lines = skywardText(pages).filter(l => !NOISE.test(l));
  const students = new Map(); let cur = null, section = null, att = null, inAlert = false;
  let sawAttendance = false;
  lines.forEach((line, i) => {
    const s = line.trim();
    const m = HEADER.exec(s);
    if (m) {
      const full = m[1].trim();
      cur = students.get(full);
      if (!cur) {
        const parts = full.split(/\s+/);
        cur = { name_raw: full, first: title(parts[0]), last: title(parts[parts.length - 1]),
          grade: m[3].replace(/^0+(?=\d)/, ""), school_email: "", home_email: "", entity: "",
          family: [], restriction: "", attendance: [] };
        students.set(full, cur);
      }
      section = null; return;
    }
    if (!cur) return;
    if (s.startsWith("Profile Information")) { section = "profile"; return; }
    if (s.startsWith("Family Members")) { section = "family"; return; }
    if (s.startsWith("Attendance Detail")) { section = "attendance"; sawAttendance = true; att = { school: "", rows: [], types: [] }; cur.attendance.push(att); return; }
    if (s.startsWith("Attendance Types") || s.startsWith("Attendance Reasons")) { section = "att_types"; return; }
    if (section === "profile") {
      const se = line.split("School Email:")[1]; if (se !== undefined) cur.school_email = (se.trim().split(/\s+/)[0] || "");
      const he = line.split("Home Email:")[1]; if (he !== undefined) { const t = he.trim().split(/\s+/)[0] || ""; cur.home_email = t.includes("@") ? t : ""; }
      const en = line.split("Entity:")[1]; if (en !== undefined) cur.entity = en.trim().split("/")[0];
      if (s.startsWith("Alert:")) inAlert = true;
      if (s.startsWith("_")) inAlert = false;
      if (inAlert && RESTRICT.test(s)) cur.restriction = "Skyward alert mentions a court order or no-contact restriction. Check the recipients before sending.";
    } else if (section === "family") {
      const nxt = (lines[i + 1] || "").trim();
      if (nxt.startsWith("Guardian Email:") && s && !s.startsWith("Family")) {
        const body = s.replace(PHONE, "").trim();
        const parts = body.split(/\s{2,}/).filter(Boolean);
        const [rel, name] = parts.length === 1 ? ["", parts[0]] : [parts[0], parts[1]];
        const email = nxt.split("Guardian Email:")[1].trim().toLowerCase();
        const nameT = title(name);
        if (nameT.toLowerCase() === `${cur.first} ${cur.last}`.toLowerCase()) return;
        if (!cur.family.some(f => f.name === nameT)) cur.family.push({ name: nameT, relationship: title(rel) || "Guardian", email });
      }
    } else if (section === "attendance") {
      const sm = /^\s*(\d{3})\/(.+)$/.exec(line);
      if (sm && !att.rows.length) { att.school = sm[1]; return; }
      const dm = DATE_ROW.exec(line);
      if (dm) att.rows.push({ date: dm[1], codes: dm[4].trim().split(/\s+/).filter(Boolean) });
    } else if (section === "att_types") {
      const tm = TYPE_ROW.exec(line);
      if (tm && att) att.types.push({ code: tm[1], desc: tm[2].trim(), days: +tm[3] });
    }
  });
  const out = [];
  for (const st of students.values()) {
    const home = st.entity || "520";
    st.home_absences = []; st.other_absences = [];
    for (const a of st.attendance) for (const r of a.rows)
      (a.school === "" || a.school === home ? st.home_absences : st.other_absences).push({ school: a.school || home, date: r.date, codes: r.codes });
    delete st.attendance;
    out.push(st);
  }
  out.hasAttendance = sawAttendance;
  return out;
}

// ---------- Rules ----------
export function letter(p) {
  for (const [cut, l] of [[93,"A"],[90,"A-"],[87,"B+"],[83,"B"],[80,"B-"],[77,"C+"],[73,"C"],[70,"C-"],[67,"D+"],[60,"D"]]) if (p >= cut) return l;
  return "F";
}

export function cleanCourse(name) {
  let n = name.trim();
  const lincoln = /^(Lincoln|LINCOLN HIGH SCHOOL)\b/.test(n);
  n = n.replace(/^(SV\s?\d\d|SV HS \d{4}|SEAVIEW ACADEMY|Seaview|LINCOLN HIGH SCHOOL|Lincoln)\s+/, "");
  n = n.replace(/^(SV\s?\d\d|SV HS \d{4})\s+/, "");
  n = n.replace(/\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}$/, "");
  n = n.replace(/:\s*(1st|2nd)\s+Semester/, "");
  n = n.replace(/\s*-?\s*(WA)?\d{4,6}$/, "");
  n = n.replace(/\s*-\s*$/, "").trim();
  return n + (lincoln ? " (Lincoln)" : "");
}

function courseRow(c) {
  if (c.og === 0 && c.time === 0)
    return { course: cleanCourse(c.name), started: false, actual: null, overall: null, letter: "—", gradeOk: null, percent: 0, goal: null, goalLabel: "Not started", completeOk: false, keep: true, src: c };
  const onPace = c.ag >= c.og - 0.05;
  const goal = onPace ? null : (c.ag > 0 ? Math.min(100, c.time * c.og / c.ag) : 100);
  // The report shows Edgenuity's ACTUAL grade (ag), not the Overall grade (og).
  return { course: cleanCourse(c.name), started: true, actual: c.ag, overall: c.og, letter: letter(c.ag), gradeOk: c.ag >= 60,
    percent: Math.round(c.time), goal, goalLabel: goal === null ? "Goal: on pace" : `Goal: ${Math.round(goal)}%`,
    completeOk: goal === null || c.time >= goal - 5, keep: true, src: c };
}

function matchSky(e, sky) {
  const f = e.first.toLowerCase();
  const c = sky.filter(s => s.last.toLowerCase() === e.last.toLowerCase() &&
    (s.first.toLowerCase().startsWith(f) || f.startsWith(s.first.toLowerCase())));
  return c.length === 1 ? c[0] : null;
}

export function combine(edg, sky) {
  const flags = [], used = new Set(), students = [];
  for (const e of edg) {
    const s = matchSky(e, sky);
    const courses = e.courses.map(courseRow);
    const attAg = e.attendance ? e.attendance.ag : null;
    const st = { key: `${e.last}, ${e.first}`, first: e.first, last: e.last, courses, edgAttendanceAg: attAg,
      name: `${e.first} ${e.last}`, grade: "", recipients: [], attendance: "unknown", absenceDates: [], noContact: false,
      otherAbsenceDays: 0, restriction: "", flags: [] };
    if (!s) st.flags.push("Not found in the Skyward report: no grade level, emails or attendance.");
    else {
      used.add(s.name_raw);
      st.name = `${s.first} ${s.last}`; st.grade = s.grade; st.restriction = s.restriction;
      st.absenceDates = [...new Set(s.home_absences.map(a => a.date))].sort();
      st.noContact = s.home_absences.some(a => a.codes.some(c => c.includes("NC")));
      st.attendance = st.absenceDates.length ? "absent" : (attAg !== null && attAg < 90 ? "post_checkins" : "ok");
      if (s.school_email) st.recipients.push({ name: `${s.first} ${s.last}`, relationship: "student", email: s.school_email, send: true });
      for (const f of s.family) {
        if (f.email) st.recipients.push({ name: f.name, relationship: f.relationship.toLowerCase(), email: f.email, send: true });
        else st.flags.push(`No email on file for ${f.name} (${f.relationship.toLowerCase()}).`);
      }
      st.otherAbsenceDays = new Set(s.other_absences.map(a => a.date)).size;
      if (s.restriction) st.flags.push(s.restriction);
      if (st.otherAbsenceDays) st.flags.push(`${st.otherAbsenceDays} day(s) absent at another school in Skyward. Not written into the comment unless you add it.`);
    }
    for (const r of courses.filter(r => !r.started)) st.flags.push(`${r.course} shows 0% and no grade (Not started). Untick it below to leave it off the report.`);
    proposeChecks(st);
    students.push(st);
  }
  for (const s of sky) if (!used.has(s.name_raw)) flags.push(`${s.first} ${s.last} is in Skyward but not in the Edgenuity export, so no report will be made.`);
  for (const e of students) if (!e.recipients.length && !e.flags.length) e.flags.push("No email recipients.");
  return { students, flags };
}

export function proposeChecks(st) {
  const started = st.courses.filter(r => r.started && r.keep);
  const behind = started.filter(r => !r.completeOk);
  const notStarted = st.courses.filter(r => !r.started && r.keep);
  const failing = started.filter(r => !r.gradeOk);
  const c = new Set();
  if (st.attendance === "absent") c.add("attendance");
  if (behind.length >= 2 || (behind.length && started.length <= 2)) c.add("time");
  if (notStarted.length || (st.grade === "12" && behind.length >= 2) || failing.length) c.add("graduation");
  st.concerns = c;
  st.satisfactory = !failing.length && !notStarted.length && behind.length <= Math.max(1, Math.floor(started.length / 3));
}

// ---------- Draft comments ----------
function toDate(s) { const [m, d, y] = s.split("/").map(Number); return new Date(Date.UTC(y < 100 ? 2000 + y : y, m - 1, d)); }
export function formatDates(strs) {
  const ds = [...new Set(strs)].map(toDate).sort((a, b) => a - b);
  if (!ds.length) return "";
  const runs = []; let cur = [ds[0]];
  for (const x of ds.slice(1)) {
    const gap = (x - cur[cur.length - 1]) / 864e5;
    if (gap === 1 || (gap === 3 && cur[cur.length - 1].getUTCDay() === 5)) cur.push(x); else { runs.push(cur); cur = [x]; }
  }
  runs.push(cur);
  const parts = runs.map(r => {
    const a = r[0], b = r[r.length - 1], ma = MONTHS[a.getUTCMonth()], mb = MONTHS[b.getUTCMonth()];
    if (+a === +b) return `${ma} ${a.getUTCDate()}`;
    if (r.length === 2 && ma === mb) return `${ma} ${a.getUTCDate()} and ${b.getUTCDate()}`;
    return ma === mb ? `${ma} ${a.getUTCDate()} to ${b.getUTCDate()}` : `${ma} ${a.getUTCDate()} to ${mb} ${b.getUTCDate()}`;
  });
  return parts.length === 1 ? parts[0] : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}
const join = a => a.length === 1 ? a[0] : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];

export function draftComment(st) {
  const first = st.first;
  const started = st.courses.filter(r => r.started && r.keep);
  const behind = started.filter(r => !r.completeOk).sort((a, b) => ((b.goal || 0) - b.percent) - ((a.goal || 0) - a.percent));
  const notStarted = st.courses.filter(r => !r.started && r.keep);
  const done = started.filter(r => r.percent >= 100);
  const strong = started.filter(r => r.actual >= 90);
  const onPace = !behind.length && !notStarted.length;
  const tail = onPace ? " and is on pace in every course" : "";
  const s = [];
  if (done.length) s.push(`Congratulations to ${first} on finishing ${join(done.map(r => r.course))}!`);
  if (strong.length) s.push(`${first} has ${strong.length === 1 ? "an A" : "A's"} in ${join(strong.slice(0, 3).map(r => r.course))}${tail}.`);
  else if (started.length && started.every(r => r.gradeOk)) s.push(`${first} is passing every course${tail}.`);
  else if (onPace) s.push(`${first} is on pace in every course.`);
  if (!onPace) {
    const bits = behind.slice(0, 2).map(r => `${r.course} is ${r.percent}% complete (goal about ${Math.round(r.goal)}%)`);
    if (bits.length) s.push(`The main concern is pace: ${join(bits)}.`);
    if (notStarted.length) s.push(`${join(notStarted.map(r => r.course))} ${notStarted.length === 1 ? "has" : "have"} not been started yet.`);
  }
  if (st.attendance === "absent") {
    const d = formatDates(st.absenceDates);
    s.push(`Our attendance records show ${first} absent${st.noContact ? " with no contact" : ""} ${d.includes(" to ") ? "from" : "on"} ${d}, so please make sure ${first} connects with me every week.`);
  } else if (st.attendance === "post_checkins") {
    s.push(`Attendance requirements are being met, but some check-ins haven't been posted in Edgenuity, so please remind ${first} to post them each week.`);
  }
  if (st.concerns.has("graduation") || behind.length >= 3 || notStarted.length) s.push(`I'd like to meet with ${first} and family to make a plan for getting back on track.`);
  else if (behind.length) s.push(`Setting aside time each school day for ${behind[0].course} will help close the gap.`);
  else s.push(`Keep up the great work, ${first}!`);
  return s.join(" ");
}

export function claudePrompt(st, teacher) {
  const data = {
    student_first_name: st.first, grade_level: st.grade,
    courses: st.courses.filter(r => r.keep).map(r => r.started
      ? { course: r.course, actual_grade: `${r.actual}% (${r.letter})`, percent_complete: r.percent, goal_percent_today: r.goal === null ? "on pace" : Math.round(r.goal), on_pace: r.completeOk }
      : { course: r.course, status: "not started" }),
    attendance: st.attendance === "absent" ? `Absent${st.noContact ? " with no contact" : ""}: ${formatDates(st.absenceDates)}`
      : st.attendance === "post_checkins" ? "Meeting attendance requirements, but needs to post attendance check-ins in Edgenuity" : "No concerns",
    satisfactory_progress: st.satisfactory, concerns: [...st.concerns],
  };
  return `You write the "Additional Comments" box of a Monthly Progress Report for an online high school (Seaview Academy). The teacher${teacher ? ` (${teacher})` : ""} sends it to the student and family.

Write 3 to 5 sentences in the teacher's first-person voice, addressed to the student and family:
- Lead with a genuine strength from the data (grades on completed work, a finished course, being on pace).
- Then the specific concern with real numbers, e.g. "Civics is 35% complete, goal about 49%".
- If attendance shows absences, name the dates. If it says check-ins need posting, say attendance requirements are met and remind them to post check-ins in Edgenuity.
- End with one concrete next step. Offer a meeting with the student and family only if things are serious.
- Plain, warm and human. No jargon, no dashes, no lists, no greeting or sign-off. Use only the student's first name, and no pronouns unless the data gives them. Never invent facts, calls, meetings or events.

Data:
${JSON.stringify(data, null, 1)}

Reply with the comment text only.`;
}

// ---------- Report PDF (pdf-lib) ----------
const W = 612, H = 792, M = 43;
function safe(t) {
  return String(t).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, m => m === "—" ? "—" : "-")
    .replace(/[^\x20-\x7E -ÿ—•]/g, "");
}
function wrap(text, font, size, width) {
  const out = [];
  for (const para of safe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const t = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(t, size) <= width) line = t; else { if (line) out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

export async function buildReport(PDFLib, st, opt) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`Monthly Progress Report - ${opt.month} - ${st.name}`); doc.setAuthor("Seaview Academy");
  const R = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold), I = await doc.embedFont(StandardFonts.HelveticaOblique);
  const hdr = await doc.embedPng(opt.headerPng);
  const black = rgb(0, 0, 0);
  let page = doc.addPage([W, H]), y = H - 29;
  const need = h => { if (y - h < 28) { page = doc.addPage([W, H]); y = H - 40; } };
  const text = (t, x, yy, f = R, s = 10.5, c = black) => page.drawText(safe(t), { x, y: yy, font: f, size: s, color: c });
  const center = (t, cx, yy, f, s) => text(t, cx - f.widthOfTextAtSize(safe(t), s) / 2, yy, f, s);
  const box = (x, yy, on) => {
    page.drawRectangle({ x, y: yy - 1, width: 8, height: 8, borderColor: black, borderWidth: 0.8 });
    if (on) { page.drawLine({ start: { x: x + 1.5, y: yy + 0.5 }, end: { x: x + 6.5, y: yy + 5.5 }, thickness: 1 }); page.drawLine({ start: { x: x + 1.5, y: yy + 5.5 }, end: { x: x + 6.5, y: yy + 0.5 }, thickness: 1 }); }
  };
  const check = (label, on) => { need(15); box(M + 14, y - 9, on); text(label, M + 28, y - 9, B, 10.5); y -= 14; };

  // Email block
  const rec = st.recipients.filter(r => r.send).map(r => `${r.name} (${r.relationship}) <${r.email}>`);
  const toLines = rec.length ? rec : ["(no email on file)"];
  const eh = 14 + toLines.length * 12 + 18;
  page.drawRectangle({ x: M, y: y - eh, width: W - 2 * M, height: eh, color: rgb(0.933, 0.953, 0.969), borderColor: rgb(0.357, 0.486, 0.6), borderWidth: 0.75 });
  text("To:", M + 6, y - 13, B, 9.5);
  toLines.forEach((l, i) => text(l, M + 64, y - 13 - i * 12, R, 9.5));
  const sy = y - 13 - toLines.length * 12 - 6;
  text("Subject:", M + 6, sy, B, 9.5); text(opt.subject, M + 64, sy, R, 9.5);
  y -= eh + 10;

  // Header + title
  const hw = 360, hh = hw * hdr.height / hdr.width;
  page.drawImage(hdr, { x: (W - hw) / 2, y: y - hh, width: hw, height: hh }); y -= hh + 18;
  center(`Monthly Progress Report - ${opt.month}`, W / 2, y, B, 14); y -= 24;
  text("Student Name: ", M, y, B); text(st.name, M + B.widthOfTextAtSize("Student Name: ", 10.5), y); y -= 14;
  text("Grade Level: ", M, y, B); text(st.grade || "", M + B.widthOfTextAtSize("Grade Level: ", 10.5), y); y -= 14;
  text("Gradebook Snapshot: ", M, y, B); text("Imagine Edgenuity Group Progress", M + B.widthOfTextAtSize("Gradebook Snapshot: ", 10.5), y);
  text("Date Taken: ", M + 332, y, B); text(opt.dateTaken || "", M + 335 + B.widthOfTextAtSize("Date Taken: ", 10.5), y); y -= 12;

  // Table
  const cols = [169, 65, 54, 76, 79, 83], xs = cols.reduce((a, w, i) => (a.push(a[i] + w), a), [M]);
  const cell = (i, t, f, s, yy) => center(t, xs[i] + cols[i] / 2, yy, f, s);
  const drawRow = (hgt, fill) => { for (let i = 0; i < 6; i++) page.drawRectangle({ x: xs[i], y: y - hgt, width: cols[i], height: hgt, borderColor: black, borderWidth: 0.75 }); };
  need(32); drawRow(30);
  text("Course", xs[0] + 6, y - 18, B, 10);
  [["Actual", "Grade"], ["Grade"], ["On Target?"], ["Percent", "Complete"], ["On Target?"]].forEach((ls, k) => ls.forEach((l, j) => cell(k + 1, l, B, 10, y - (ls.length === 1 ? 18 : 13 + j * 11))));
  y -= 30;
  for (const r of st.courses.filter(r => r.keep)) {
    const nl = wrap(r.course, B, 10, cols[0] - 12), hgt = Math.max(30, 14 + nl.length * 12);
    need(hgt); drawRow(hgt);
    const mid = y - hgt / 2;
    nl.forEach((l, j) => text(l, xs[0] + 6, mid + (nl.length - 1) * 6 - j * 12 - 3.5, B, 10));
    if (r.started) {
      cell(1, `${r.actual.toFixed(1)}%`, B, 10, mid - 3.5); cell(2, r.letter, B, 10, mid - 3.5); cell(3, r.gradeOk ? "Yes" : "No", B, 10, mid - 3.5);
      cell(4, `${r.percent}%`, B, 10, mid + 1); cell(4, r.goalLabel, B, 7, mid - 9); cell(5, r.completeOk ? "Yes" : "No", B, 10, mid - 3.5);
    } else {
      for (const k of [1, 2, 3]) cell(k, "—", B, 10, mid - 3.5);
      cell(4, "0%", B, 10, mid + 1); cell(4, "Not started", B, 7, mid - 9); cell(5, "No", B, 10, mid - 3.5);
    }
    y -= hgt;
  }
  y -= 4;
  for (const l of wrap("Actual Grade is the Edgenuity Actual Grade: the grade on completed work, lowered when the student is behind pace. Percent Complete is time-weighted; Goal is where the student should be by this date based on the course calendar. Goal: on pace means the student is on or ahead of schedule.", I, 8, W - 2 * M)) { need(10); text(l, M, y - 7, I, 8, rgb(0.27, 0.27, 0.27)); y -= 10; }
  y -= 6;
  for (const l of wrap("See attached Session Log for detailed account of time logged into Edgenuity and number of activities completed.", B, 10.5, W - 2 * M)) { need(14); text(l, M, y - 9, B); y -= 14; }
  y -= 8; need(14); text("Student is making Satisfactory Monthly progress as evidenced by gradebook snapshot:", M, y - 9, B); y -= 14;
  check("Yes", st.satisfactory); check("No", !st.satisfactory);
  y -= 8; need(14); text("There are concerns with:", M, y - 9, B); y -= 14;
  for (const [k, label] of CONCERNS) check(label, st.concerns.has(k));

  // Comments (kept together)
  y -= 8;
  const cl = wrap(st.comment || "", R, 10.5, W - 2 * M - 16), ch = cl.length * 14.5 + 14;
  need(18 + ch); text("Additional Comments:", M, y - 9, B); y -= 16;
  page.drawRectangle({ x: M, y: y - ch, width: W - 2 * M, height: ch, borderColor: black, borderWidth: 0.75 });
  cl.forEach((l, j) => text(l, M + 8, y - 16 - j * 14.5)); y -= ch + 12;

  // Shared with + signature (kept together)
  need(80);
  const lbl = "Date Monthly Progress Report was shared with:";
  text(lbl, M, y - 9, B); if (opt.dateShared) text(opt.dateShared, M + B.widthOfTextAtSize(lbl, 10.5) + 6, y - 9, R); y -= 14;
  const sent = st.recipients.filter(r => r.send);
  check("Student", sent.some(r => r.relationship === "student")); check("Family", sent.some(r => r.relationship !== "student")); y -= 22;
  if (opt.teacher) text(opt.teacher, M + 4, y + 4, R, 10.5);
  page.drawLine({ start: { x: M, y }, end: { x: M + 317, y }, thickness: 0.8 });
  page.drawLine({ start: { x: M + 382, y }, end: { x: M + 497, y }, thickness: 0.8 });
  center("Certificated Staff", M + 158, y - 10, R, 7.5); center("Date", M + 440, y - 10, R, 7.5);
  return doc.save();
}

export async function pdfText(pdfjsLib, bytes) {
  const pages = await readPdf(pdfjsLib, bytes.slice ? bytes.slice(0) : bytes);
  return pages.flat().map(i => i.str).join(" ");
}

export function verifyText(st, text) {
  const probs = [];
  for (const r of st.courses.filter(r => r.keep && r.started))
    for (const v of [`${r.actual.toFixed(1)}%`, `${r.percent}%`]) if (!text.includes(v)) probs.push(`${st.name}: ${r.course} ${v} missing`);
  if (!text.includes(st.name)) probs.push(`${st.name}: name missing`);
  return probs;
}

export function fileName(st, all, month) {
  const dup = all.filter(s => s.last === st.last).length > 1;
  return `${dup ? `${st.last}, ${st.first}` : st.last} - ${month} - MPR.pdf`;
}
