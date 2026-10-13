---
name: lis-ux
description: UX and workflow design for AtollLIS — role-based journeys (phlebotomist, technologist, admin, clinician), task flows, information architecture, error prevention, usability heuristics and UX review. Use when planning a new feature or screen, changing a workflow, reorganising navigation, or reviewing an existing AtollLIS screen for usability.
---

# AtollLIS UX

Good LIS UX means the right person does the right task on the right sample with the fewest steps and no chance of a dangerous mistake. Use this skill to decide what a screen should do and how a workflow should flow. Use `lis-clinical-ui` and `human-touch-ui` for how it looks. Where they conflict, patient safety wins, then speed for the person doing the work, then visual polish.

## 1. Start from the user and the task, not the data model
Before designing or changing a screen, write down in 3 to 5 lines:
- **Who** uses it (role, facility level: Regional Hospital, Atoll Hospital or Health Centre).
- **What** they are trying to get done, and how often (once a day, or 200 times a shift).
- **Where** and **how**: busy bench, collection room, ward, shared PC, tablet, slow connection, gloves on, barcode scanner in hand.
- **What goes wrong today**, or what could go wrong (wrong patient, missed STAT, unacknowledged critical).
If any of this is unknown, ask the user instead of assuming.

## 2. Know each role's core journey
Optimise the high-frequency journeys first.

**Phlebotomist / collector**
Find patient → see pending orders → confirm identity (two identifiers) → print and attach labels → mark collected (with time, collector, IPD/OPD, ward) → send.
Goals: scan-first, minimal typing, label printing in one action, impossible to collect against the wrong patient.

**Lab technologist**
Receive samples (scan) → check quality and reject if needed → worklist by department or analyser → enter or review interfaced results → handle flags, delta checks and criticals → validate → release.
Goals: keyboard-driven, worklists that show only what needs action now, STAT and critical items always on top, bulk validation for normal results.

**Senior / validating technologist**
Review queue → compare with previous results → validate, amend with reason, or send back → call and document critical values.
Goals: the patient's history one glance away, a clear audit trail, amendments that are never silent.

**Admin**
Users and roles → test catalog, panels, reference ranges, reflex rules → facilities → audit and reports.
Goals: safe changes (preview what a change affects, toggle instead of delete), search everywhere, an audit of who changed what.

**Clinician / ward (if given access)**
Find patient → see latest results with flags and trends → print or share report.
Goals: read-only, fast, results grouped by date and department, critical results impossible to miss.

## 3. Information architecture
- Navigation follows the work, not the database: Collection, Reception, Worklists / Result processing, Validation, Reports, QC, Settings.
- Show each role only the sections it uses. Fewer menu items means faster work and fewer mistakes.
- Facility context (which hospital or centre you are working in) is always visible, and switching it is deliberate.
- Settings is grouped by job (Users and roles, Test catalog, Panels, Reflex rules, Rejection reasons, Facilities), with search across all of it.
- The same object always has the same name everywhere (pick "sample" or "specimen" once and keep it).

## 4. Reduce steps and cognitive load
- Count clicks and keystrokes for each core task, and remove any step that does not add safety or information.
- Default to the most common choice (current facility, today's date, routine priority, last used department), and let users change it.
- Remember filters and worklist views per user.
- Progressive disclosure: show the essentials first, with detail one click away (history, audit, comments).
- Batch actions for repetitive work (receive many samples, validate many normal results, print many labels), with a clear count and confirmation.
- Search accepts what people actually type: sample ID, patient ID, NIC/passport, or part of a name.

## 5. Prevent errors instead of reporting them
- Positive patient identification: scan or select, then confirm with two identifiers before collection or result entry.
- Constrain input: numeric fields accept only numbers and qualifiers (<, >), coded results use pick lists, dates use pickers, and units are fixed by the test.
- Catch problems at the moment of entry: an implausible value, a big delta, a duplicate order or a wrong specimen type gets an inline warning, not a message after saving.
- Make dangerous actions hard and safe actions easy: rejecting, cancelling or amending needs a reason and a confirmation that states exactly what will change. Normal saving needs none.
- Prefer undo (for a short time) over "are you sure?" for low-risk actions, and confirmations for high-risk ones.
- Never lose work: keep draft result entry if the network drops or the user is logged out, and warn before leaving a page with unsaved changes.

## 6. Feedback and system status
- Every action gets immediate feedback: saved, validated, sent to printer, or failed with the reason.
- Show sample status and where it is in the process at all times (ordered → collected → received → in progress → resulted → validated).
- Show connection and sync status (online, offline, analyser connected) where it affects the work, especially at health centres with weak connectivity.
- Turnaround time is visible: how long a sample has waited, and which ones are breaching their target.

## 7. Errors, empty states and edge cases
- Error messages say what happened, why, and what to do next, in plain words ("Sample S123 was already received at 09:42 by Aisha. Scan the next sample.").
- Empty states explain what will appear and offer the next action ("No samples waiting for haematology. New samples appear here when received.").
- Design for messy real data: very long patient names, missing date of birth, unknown sex, duplicate names, foreign patients without NIC, panels with many tests, results with long comments.
- Design for interruptions: a technologist called away mid-entry must be able to come back to exactly where they were.

## 8. Accessibility and environment
- Fully usable with keyboard and barcode scanner, with no mouse required for core tasks.
- Readable on older monitors and tablets, in bright and dim rooms; never use colour alone for meaning.
- Large enough touch targets for tablet use at the bedside or in the collection room.
- Works acceptably on slow connections: lightweight pages, no blocking spinners for background tasks.

## 9. Language and terminology
- Use the words your lab staff actually use (the IGMH test names, the lab's department names), not developer terms ("record", "entity", "null").
- Be consistent: one term for one concept across screens, reports and messages.
- Write buttons as the action ("Receive sample", "Validate 12 results", "Reject sample"), never "Submit" or "OK".
- If Dhivehi or bilingual labels are needed, plan layouts with room for longer text and right-to-left support.

## 10. When designing a new feature, produce
1. A short user/task statement (section 1).
2. The step-by-step flow for each role involved, including the unhappy paths (rejection, error, offline, permission denied).
3. The screens or states needed, including empty, loading, error and success states.
4. What can go wrong clinically and how the design prevents it.
5. Any open questions for the user. Ask them before building when the answer changes the workflow.

## 11. UX review checklist (use on any existing screen)
- Can the main task be done in the fewest reasonable steps, by keyboard and scanner?
- Is the patient's identity unmistakable, and is wrong-patient entry prevented?
- Are STAT, critical and overdue items impossible to miss?
- Does every action give clear feedback, and is unsaved work protected?
- Are errors prevented at entry rather than reported afterwards?
- Do empty, loading, error and permission-denied states all exist and help the user?
- Does the screen show only what this role needs?
- Is the terminology consistent with the rest of AtollLIS and with how the lab talks?
- Does it hold up with long names, missing data, slow networks and interruptions?
Report findings as: issue → who it affects → why it matters (safety, speed, or confusion) → suggested fix, ordered by severity.
