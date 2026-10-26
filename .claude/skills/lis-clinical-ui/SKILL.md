---
name: lis-clinical-ui
description: Clinical-grade UI rules for AtollLIS screens — sample collection, result entry, analyser processing, validation, microbiology, reports and settings. Use when building or changing any AtollLIS page, form, table, or printed report.
---

# AtollLIS clinical UI

AtollLIS is used by phlebotomists, technologists and admins across Regional Hospital → Atoll Hospital → Health Centre. Screens must be fast, unambiguous and safe. Apply these alongside the `human-touch-ui` skill; where they conflict, these win.

## Safety first
- Patient identity is always visible on any result or sample screen: name, patient ID, age/sex, IPD/OPD and ward. Keep it in a sticky header so it never scrolls away.
- Abnormal and critical values: show color AND a text flag (H, L, HH, LL, CRIT) AND an icon. Never rely on color alone.
- STAT requests stand out in every list (badge + left border), and sort above routine work by default.
- Destructive or irreversible actions (reject sample, amend a validated result, cancel a test) need a confirmation that names exactly what will change, plus a reason field.
- Show who did what and when (collected, received, resulted, validated by) on result screens and reports.
- Never show "Lorem ipsum" or fake hospital codes; use real test codes, units and reference ranges from the catalog.

## Speed for technologists
- Result entry must work entirely by keyboard: Tab/Enter moves to the next result field, Esc cancels, shortcuts for Save and Validate shown on the buttons.
- Numeric result fields: right-aligned, tabular numerals, unit shown beside the field, reference range shown on the same row.
- Barcode/sample-ID search field is autofocused on collection and reception screens.
- Keep filters persistent per user (remember last facility, department, date range, status).
- Bulk actions (validate selected, print selected) for worklists, with a count of what is selected.

## Tables and worklists
- Columns in a fixed, predictable order: Sample ID, Patient, Test, Status, Priority, Time.
- Status uses one consistent set of pill colors across the whole app (e.g. Pending, Collected, Received, In progress, Resulted, Validated, Rejected).
- Show turnaround time and highlight samples breaching TAT.
- Dense but readable: 14px table text minimum, 40px+ rows, sticky header, hover highlight.

## Microbiology
- Culture entry follows the lab's workflow: specimen → growth status → organism(s) → antibiotic panel.
- S/I/R entry as a compact segmented control per antibiotic, keyboard selectable (S, I, R keys).
- Report groups antibiotics by organism with S/I/R clearly aligned in columns.

## Printed and PDF reports
- A4, hospital/facility header, clear patient block, results table with units and reference ranges, flags in their own column.
- Black-and-white safe: flags must still read when printed without color.
- Footer with validated-by, date/time, page X of Y, and "End of report".

## Settings and admin
- Prefer enable/disable toggles over deleting master data (tests, panels, reflex rules, organisms).
- Searchable modals for long lists (tests, panels, organisms, antibiotics).
- Role-based: hide actions a role can't perform rather than showing disabled buttons with no explanation.

## Before finishing
Check the change at phone, tablet and desktop width, with keyboard only, and in print preview for any report. Confirm that critical values, STAT and patient identity are unmistakable.
