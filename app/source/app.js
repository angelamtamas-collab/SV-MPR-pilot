import * as pdfjsLib from "./lib/pdf.min.js";
import * as core from "./mpr-core.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./lib/pdf.worker.min.js", import.meta.url).href;
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") n.textContent = v; else if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
};
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const state = { sky: null, edg: null, students: [], flags: [], built: null, header: null };
let downloads = null, dirty = false;

// ---------- Step 1 ----------
{
  const now = new Date(), sel = $("month");
  for (let k = -2; k <= 1; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() + k, 1), v = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    sel.append(el("option", { value: v, text: v, selected: k === 0 }));
  }
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  $("taken").value = today; $("shared").value = today;
  try { const saved = JSON.parse(localStorage.getItem("mpr-teacher") || "{}"); if (saved.name) $("tname").value = saved.name; if (saved.last) $("tlast").value = saved.last; } catch (e) {}
  for (const id of ["tname", "tlast", "month", "taken"]) $(id).addEventListener("input", step1);
  step1();
}
function step1() {
  const last = $("tlast").value.trim();
  try { localStorage.setItem("mpr-teacher", JSON.stringify({ name: $("tname").value.trim(), last })); } catch (e) {}
  $("folderPreview").textContent = last ? `Your folder will be named "MPR DV ${last} ${$("month").value}".` : "Enter your last name to continue.";
  const ok = !!last;
  mark(1, ok); enable("s2", ok); enable("s3", ok);
  refreshBuild();
}
const monthName = () => $("month").value.split(" ")[0];
const usDate = id => { const v = $(id).value; if (!v) return ""; const [y, m, d] = v.split("-"); return `${m}/${d}/${y}`; };
const takenText = () => usDate("taken");
function enable(id, on) { $(id).setAttribute("aria-disabled", on ? "false" : "true"); }
function mark(n, done) {
  const sec = $("s" + n), r = $("r" + n);
  sec.classList.toggle("done", done); r.classList.toggle("done", done);
  const firstOpen = [1, 2, 3, 4, 5].find(i => !$("s" + i).classList.contains("done"));
  for (let i = 1; i <= 5; i++) $("r" + i).classList.toggle("now", i === firstOpen);
}

// ---------- Uploads ----------
function wireDrop(dropId, pickId, fileId, handler) {
  const drop = $(dropId), input = $(fileId);
  $(pickId).addEventListener("click", () => input.click());
  input.addEventListener("change", async () => { const f = input.files[0]; if (f) await handler(f); input.value = ""; });
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) handler(f); });
}
function status(id, msg, kind) { const s = $(id); s.textContent = msg; s.className = "status" + (kind ? " " + kind : ""); }

const notPdf = f => !/\.pdf$/i.test(f.name) && f.type !== "application/pdf";
wireDrop("dropSky", "pickSky", "fileSky", async f => {
  status("statSky", "Reading " + f.name + "…");
  try {
    if (notPdf(f)) throw new Error(f.name + " is not a PDF. Save the Skyward report as a PDF and upload that.");
    const pages = await core.readPdf(pdfjsLib, new Uint8Array(await f.arrayBuffer()));
    if (!core.looksLikeSkyward(pages)) {
      if (core.looksLikeEdgenuity(pages)) throw new Error("This looks like the Edgenuity page. Upload it in step 3, and upload the Skyward report here.");
      throw new Error("This doesn't look like a Skyward Student Information report. Check the settings in the directions above.");
    }
    const sky = core.parseSkyward(pages);
    if (!sky.length) throw new Error("No students found in this report.");
    state.sky = sky;
    const emails = sky.reduce((n, s) => n + (s.school_email ? 1 : 0) + s.family.filter(f => f.email).length, 0);
    let msg = `Found ${sky.length} students and ${emails} email addresses.`;
    if (!sky.hasAttendance) { msg += " No attendance section was found: turn on Attendance Totals with a date range (step 4 of the directions), or continue and attendance will come from Edgenuity check-ins only."; status("statSky", msg, "bad"); }
    else status("statSky", msg + " Attendance found.", "ok");
    mark(2, true); combine();
  } catch (e) { state.sky = null; mark(2, false); status("statSky", e.message, "bad"); }
});
wireDrop("dropEdg", "pickEdg", "fileEdg", async f => {
  status("statEdg", "Reading " + f.name + "…");
  try {
    if (notPdf(f)) throw new Error(f.name + " is not a PDF. Print the Edgenuity page to PDF and upload that.");
    const pages = await core.readPdf(pdfjsLib, new Uint8Array(await f.arrayBuffer()));
    if (!core.looksLikeEdgenuity(pages)) {
      if (core.looksLikeSkyward(pages)) throw new Error("This looks like the Skyward report. Upload it in step 2, and upload the Edgenuity page here.");
      throw new Error("This doesn't look like the Edgenuity Group Progress Overview. Check the directions above.");
    }
    const edg = core.parseEdgenuity(pages);
    if (!edg.length) throw new Error("No students found. Make sure Records Per Page is ALL and you clicked Search before saving.");
    state.edg = edg;
    status("statEdg", `Found ${edg.length} students and ${edg.reduce((n, s) => n + s.courses.length, 0)} courses.`, "ok");
    mark(3, true); combine();
  } catch (e) { state.edg = null; mark(3, false); status("statEdg", e.message, "bad"); }
});

// ---------- Step 4: review ----------
function combine() {
  if (!state.sky || !state.edg) return;
  const { students, flags } = core.combine(state.edg, state.sky);
  const auto = $("autoCom").checked, prev = new Map(state.students.map(s => [s.key, s]));
  for (const s of students) {
    const old = prev.get(s.key);
    if (old && old.commentSource === "edited") { s.comment = old.comment; s.commentSource = "edited"; }
    else { s.comment = auto ? core.draftComment(s) : ""; s.commentSource = auto ? "quick draft" : "not written"; }
  }
  dirty = true;
  state.students = students; state.flags = flags; state.built = null; $("result").hidden = true;
  enable("s4", true); enable("s5", true); renderReview(); mark(4, true); refreshBuild();
}

function renderReview() {
  const gf = $("globalFlags"); gf.replaceChildren(...state.flags.map(f => el("li", { text: f })));
  const cards = $("cards"); cards.replaceChildren(...state.students.map(card));
}

function card(st) {
  const chips = el("span", {});
  const summary = el("summary", {}, el("span", { class: "nm", text: st.name }), chips);
  const body = el("div", { class: "body" });
  const d = el("details", { class: "card" }, summary, body);
  const refreshChips = () => {
    const c = [el("span", { class: "chip", text: st.grade ? "Grade " + st.grade : "No grade" })];
    if (st.flags.length) c.push(el("span", { class: "chip warn", text: st.flags.length + (st.flags.length === 1 ? " flag" : " flags") }));
    c.push(el("span", { class: "chip" + (st.satisfactory ? " good" : ""), text: st.satisfactory ? "Satisfactory" : "Not satisfactory" }));
    c.push(el("span", { class: "chip", text: st.recipients.filter(r => r.send).length + " recipients" }));
    c.push(el("span", { class: "chip", text: "Comment: " + st.commentSource }));
    chips.replaceChildren(...c);
  };
  const build = () => {
    body.replaceChildren();
    if (st.flags.length) body.append(el("ul", { class: "flags" }, st.flags.map(f => el("li", { text: f }))));
    const regrade = () => { core.proposeChecks(st); if (st.commentSource === "quick draft") st.comment = core.draftComment(st); build(); refreshChips(); };
    const gradeCell = r => {
      if (!r.started) return el("td", { text: "—" });
      const inp = el("input", { type: "number", class: "gradein", min: "0", max: "110", step: "0.1", value: r.actual.toFixed(1), "aria-label": "Actual grade for " + r.course,
        onchange: e => { const v = parseFloat(e.target.value); if (isNaN(v) || v < 0 || v > 110) { e.target.value = r.actual.toFixed(1); return; } r.actual = Math.round(v * 10) / 10; core.applyGrade(r); regrade(); } });
      return el("td", {}, inp, r.actual !== r.edgActual ? el("div", { class: "mini", text: "Edgenuity: " + r.edgActual.toFixed(1) + "%" }) : null);
    };
    const rows = st.courses.map(r => el("tr", {},
      el("td", {}, el("input", { type: "checkbox", checked: r.keep, "aria-label": "Include " + r.course, onchange: e => { r.keep = e.target.checked; regrade(); } })),
      el("td", { text: r.course }), gradeCell(r),
      el("td", {}, r.started ? el("input", { type: "checkbox", checked: r.passFail, "aria-label": "Pass/Fail at 50% for " + r.course, onchange: e => { r.passFail = e.target.checked; core.applyGrade(r); regrade(); } }) : null),
      el("td", { text: r.letter }), el("td", { class: "mini", text: r.started ? r.overall.toFixed(1) + "%" : "—" }),
      el("td", { text: r.started ? r.percent + "%" : "0%" }), el("td", { text: r.goalLabel.replace("Goal: ", "") }),
      el("td", { text: r.started ? (r.completeOk ? "Yes" : "No") : "No" })));
    body.append(el("div", { class: "scroll" }, el("table", { class: "courses" },
      el("thead", {}, el("tr", {}, ["On report", "Course", "Actual grade", "P/F", "Grade", "Overall", "Complete", "Goal", "On target"].map(h => el("th", { text: h })))),
      el("tbody", {}, rows))),
      el("p", { class: "mini", text: "Type in the Actual grade box to add extra credit. Tick P/F to grade a course Pass/Fail (passes at 50%). Overall is shown for comparison only and is not on the report." }));
    const recips = el("div", { class: "recips" }, el("label", { class: "f", text: "Email recipients (untick anyone who must not receive it)" }),
      st.recipients.length ? st.recipients.map(r => el("label", {}, el("input", { type: "checkbox", checked: r.send, onchange: e => { r.send = e.target.checked; refreshChips(); } }),
        el("span", { text: `${r.name} (${r.relationship}) ${r.email}` }))) : el("p", { class: "mini", text: "No email on file." }));
    const att = { absent: `Absent${st.noContact ? " with no contact" : ""}: ${core.formatDates(st.absenceDates)}`, post_checkins: "Meets attendance requirements; needs to post check-ins in Edgenuity", ok: "No attendance concerns", unknown: "Unknown (not in Skyward)" }[st.attendance];
    const checks = el("div", { class: "checks" },
      el("label", { class: "f", text: "Satisfactory monthly progress" }),
      el("p", { class: "mini", text: "Proposed by district policy: Yes when passing at least half of the courses on the report (not-started courses count as not passing)." }),
      ...[["Yes", true], ["No", false]].map(([t, v]) => el("label", {}, el("input", { type: "radio", name: "sat-" + st.key, checked: st.satisfactory === v, onchange: () => { st.satisfactory = v; refreshChips(); } }), el("span", { text: t }))),
      el("label", { class: "f", text: "Concerns" }),
      ...core.CONCERNS.map(([k, t]) => el("label", {}, el("input", { type: "checkbox", checked: st.concerns.has(k), onchange: e => { e.target.checked ? st.concerns.add(k) : st.concerns.delete(k); } }), el("span", { text: t }))),
      el("p", { class: "mini", text: "Attendance: " + att }));
    body.append(el("div", { class: "two" }, recips, checks));
    const ta = el("textarea", { id: "c-" + st.key, "aria-label": "Comment for " + st.name, placeholder: "Write your comment for " + st.name + " here, or tick Auto populate comments above.", oninput: e => { st.comment = e.target.value; st.commentSource = "edited"; refreshChips(); } });
    ta.value = st.comment;
    body.append(el("label", { class: "f", for: "c-" + st.key, text: "Additional comments" }), ta,
      el("div", { class: "toolbar" },
        el("button", { type: "button", class: "ghost", onclick: () => { st.comment = core.draftComment(st); st.commentSource = "quick draft"; ta.value = st.comment; refreshChips(); } }, "Quick draft"),
        el("button", { type: "button", class: "ghost", onclick: () => previewOne(st) }, "Preview report")));
  };
  st.rerender = () => { if (d.open) build(); refreshChips(); };
  d.addEventListener("toggle", () => { if (d.open && !body.childElementCount) build(); });
  refreshChips();
  return d;
}

$("autoCom").addEventListener("change", e => {
  const on = e.target.checked;
  for (const st of state.students) {
    if (on && !st.comment.trim()) { st.comment = core.draftComment(st); st.commentSource = "quick draft"; }
    else if (!on && st.commentSource === "quick draft") { st.comment = ""; st.commentSource = "not written"; }
    st.rerender && st.rerender(); const ta = $("c-" + st.key); if (ta) ta.value = st.comment;
  }
});

// ---------- Build ----------
function refreshBuild() { $("build").disabled = !(state.students.length && $("tlast").value.trim()); }
async function headerPng() {
  if (!state.header) state.header = new Uint8Array(await (await fetch("header.png")).arrayBuffer());
  return state.header;
}
const opts = async () => ({ month: $("month").value, subject: `SV - MPR - ${monthName()} Overviews`, dateTaken: takenText(), dateShared: usDate("shared"), teacher: $("tname").value.trim(), headerPng: await headerPng() });

$("build").addEventListener("click", async () => {
  const btn = $("build"); btn.disabled = true; $("result").hidden = true;
  const o = await opts(), month = $("month").value, folder = `MPR DV ${$("tlast").value.trim()} ${month}`;
  const zip = new JSZip(), dir = zip.folder(folder), review = await PDFLib.PDFDocument.create();
  const problems = []; let i = 0;
  try {
    for (const st of state.students) {
      status("statBuild", `Building ${st.name} (${++i} of ${state.students.length})…`);
      $("bar").style.width = (100 * i / state.students.length) + "%";
      if (!st.comment.trim()) problems.push(`${st.name}: comment is empty`);
      if (!st.recipients.some(r => r.send)) problems.push(`${st.name}: no email recipients selected`);
      const bytes = await core.buildReport(PDFLib, st, o);
      problems.push(...core.verifyText(st, await core.pdfText(pdfjsLib, bytes)));
      dir.file(core.fileName(st, state.students, month), bytes);
      const src = await PDFLib.PDFDocument.load(bytes);
      (await review.copyPages(src, src.getPageIndices())).forEach(p => review.addPage(p));
    }
    const verification = `${state.students.length} reports built for ${month}\n` + (problems.length ? problems.join("\n") : "Every grade and percentage matched the uploaded data.") +
      (state.flags.length ? "\n\nNotes:\n" + state.flags.join("\n") : "");
    dir.file(`VERIFICATION ${month}.txt`, verification);
    state.built = { zip: await zip.generateAsync({ type: "blob" }), review: new Blob([await review.save()], { type: "application/pdf" }), folder };
    $("resultText").textContent = problems.length ? `${state.students.length} reports built. Check these first: ${problems.join("; ")}` : `${state.students.length} reports built. Every grade and percentage matched your data.`;
    $("result").hidden = false; status("statBuild", "", ""); mark(5, true);
    $("dlNote").textContent = "";
  } catch (e) { status("statBuild", "Something went wrong while building: " + e.message, "bad"); }
  btn.disabled = false;
});
async function save(filename, blob) {
  if (!downloads) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); $("dlNote").textContent = "Downloaded " + filename + ". Check your Downloads folder."; dirty = false; return; }
  try { await downloads.save({ filename, data: blob }); $("dlNote").textContent = "Saved " + filename + "."; dirty = false; }
  catch (e) { $("dlNote").textContent = e.code === "declined" ? "Download cancelled." : e.code === "rate_limited" ? "Another download is in progress; try again in a moment." : "Couldn't download here (" + (e.code || "error") + "). Try Google Chrome on a computer."; }
}
$("dlZip").addEventListener("click", () => state.built && save(state.built.folder + ".zip", state.built.zip));
$("dlReview").addEventListener("click", () => state.built && save(state.built.folder + " - REVIEW.pdf", state.built.review));

// ---------- Preview ----------
async function previewOne(st) {
  const dlg = $("preview"); $("pvTitle").textContent = st.name; $("pvBody").replaceChildren(el("p", { class: "mini", text: "Drawing preview…", style: "padding:14px" }));
  dlg.showModal();
  try {
  const bytes = await core.buildReport(PDFLib, st, await opts());
  const doc = await pdfjsLib.getDocument({ data: bytes, verbosity: 0 }).promise;
  const canvases = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p), vp = page.getViewport({ scale: 1.6 });
    const c = el("canvas", { width: vp.width, height: vp.height });
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise; canvases.push(c);
  }
  $("pvBody").replaceChildren(...canvases);
  } catch (e) { $("pvBody").replaceChildren(el("p", { class: "status bad", text: "Couldn't draw this preview: " + e.message, style: "padding:14px" })); }
}
$("pvClose").addEventListener("click", () => $("preview").close());

// ---------- Capabilities ----------
window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
(async () => {
  if (!window.claude || !window.claude.use) return;
  try { downloads = await window.claude.use("downloads"); } catch (e) { downloads = null; }
})();
