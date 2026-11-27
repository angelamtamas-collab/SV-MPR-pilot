# How each report is filled in

| Report field | Rule | Source |
| --- | --- | --- |
| Actual Grade | Edgenuity **Actual Grade** (AG): the grade on completed work, lowered when the student is behind pace. Never the Overall Grade. | Edgenuity |
| Grade | Letter for the Actual Grade: A 93+, A- 90, B+ 87, B 83, B- 80, C+ 77, C 73, C- 70, D+ 67, D 60, F below 60 | Calculated |
| Grade On Target? | Yes when the Actual Grade is 60% or above |
| Teacher changes (web app) | The teacher can type a new Actual Grade (e.g. extra credit); the report uses it and the review screen shows the Edgenuity grade beside it. A course marked Pass/Fail shows Pass or Fail and passes at 50%. | Teacher | Calculated |
| Percent Complete | % (Time), rounded | Edgenuity |
| Goal | Where the student should be today: %Time x Overall / Actual, capped at 100%. "On pace" when Actual equals Overall | Calculated |
| Completion On Target? | Yes when on pace or within 5 points of the goal | Calculated |
| Not started | 0% complete and no grade: "Not started", On Target No (teacher decides whether to keep it) | Edgenuity |
| Grade Level | Grade listed in Skyward | Skyward |
| Recipients | Student school email + every guardian email in Skyward | Skyward |
| Subject | SV - MPR - <Month> Overviews | Fixed |

## Proposed checkboxes (the teacher confirms)
- **Satisfactory progress: Yes** when the student is passing at least half (50%) of the courses on the report, per district policy. A course passes at 60% Actual Grade, or 50% if marked Pass/Fail. Not-started courses count as not passing. Pace does not affect it.
  and no more than a third of courses (minimum 1) are behind pace.
- **Attendance check-ins**: Seaview/ALE absences in Skyward this month.
- **Time engaged**: two or more courses behind pace (or the only courses behind).
- **On-time graduation**: a course not started, a failing course, or a senior behind in two or more courses.
- **Staff communications** and **WSLP / Intervention Plan**: only when the teacher says so.

## Attendance
- Seaview/ALE absences in Skyward → attendance concern, dates named in the comment.
- Skyward clean but Edgenuity attendance course AG below 90% → meets attendance requirements;
  comment reminds the student to post check-ins in Edgenuity; box unchecked.
- Other-school absences → flagged to the teacher only.
- Reasons for excused absences are never written into reports.

## Class summary (SUMMARY <Month>.pdf, web app)
Each download folder includes one summary for the teacher (not for families):
- **Intervention plan needed:** every student not making Satisfactory progress, with passing count
  and why (courses not passing, not started, Seaview/ALE absences).
- **Watch list:** Satisfactory students who are behind pace in any course.
- **Attendance:** absence dates and students who need to post Edgenuity check-ins.
- **Notes to check:** students missing from either export and students with no email recipients.
- **All students:** one line each with Satisfactory, passing count, courses behind and attendance.

## Email list (EMAIL LIST <Month>.pdf, web app)
Each download folder also includes an email list: every student and family address ticked in the
review step, and nothing else, separated by semicolons and with no duplicates, ready to copy
and paste into BCC.
