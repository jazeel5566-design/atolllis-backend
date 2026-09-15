# AtollLIS Roadmap — Application Structure & Major Future Modules

This is a planning document, not a changelog — nothing here has been built yet. It captures two
things discussed but deliberately deferred: restructuring the app into three access-scoped
branches, and three major future modules (Billing/Aasandha, Inventory, QMS).

## Three application branches (target design)

The app currently ships as one unified interface — every logged-in lab staff member sees the same
sidebar (Dashboard, Sample Collection, Sample Acceptance, Result Processing, Reports, Settings),
with *capabilities* (see `src/utils/roles.js`) controlling which buttons and actions are available,
but not which pages exist at all.

The target design splits this into three distinct branches, each its own access-scoped area:

### 1. Sample Collection & Reception
Fetching memos, collecting samples, referring what needs a higher tier, and accepting samples on
arrival at the lab. This is today's `collect` + `accept` capabilities, but as a dedicated area for
collection-point and reception staff — not mixed with the processing/reporting workflow.

### 2. Processing & Reporting
The analyser interface, manual result entry, validation & certification. Today's `process` +
`certify` capabilities. Scoped to technologists and pathologists — the people actually running and
signing off results.

### 3. Report Viewing
Looking up and printing a completed report. Two very different audiences share this branch:
clinical staff (doctors, nurses) who need to *see* a result, and reception staff who print a copy
for a walk-in OPD patient. Neither needs to see Sample Collection or Result Processing at all.

**The real implication:** branch 3 means issuing logins to people who are not lab staff at all —
clinicians and general reception. That's a genuine scope expansion beyond today's model, where
every account is a lab role (`phlebotomist`/`technologist`/`pathologist`/`lab_manager`/`admin`).
A `clinician` or `front_desk` role with report-read-only access (and nothing else) would need to be
added to `ROLE_CAPABILITIES`, and the login/navigation logic would route each role straight into
its one relevant branch instead of a single shared sidebar.

**Suggested approach when it's time:** this is mostly a navigation and role change, not a data
model change — the underlying API routes and permission checks already exist per-capability, so
the work is (a) new lightweight roles, (b) a landing view per branch instead of one shared shell,
(c) hiding/showing entire nav sections by role rather than just buttons within a page.

## Major future modules

### Billing, integrated with Aasandha
A real fee schedule tied to the Test Catalog (a price per test/panel), itemized billing per order,
and submission to Aasandha (Maldives' national health insurance scheme) for coverage/claims. The
integration piece depends entirely on whatever provider API or EDI format Aasandha publishes for
healthcare facilities — that's an external dependency to obtain before this phase can really start,
not something to design blind. Worth scoping the *domestic* billing piece (fee schedule, itemized
bills, patient co-pay) first, since that's buildable now, and treating the Aasandha submission
step as a distinct, later sub-phase once their integration spec is in hand.

### Inventory Management
Tracking lab consumables and reagents — stock levels, reorder thresholds, expiry dates (this
matters more than in generic inventory, since an expired reagent is a patient-safety issue, not
just a stock-out), supplier/purchase-order tracking, and usage patterns tied to actual test volume
(the Test Catalog + specimen counts already give a real basis for consumption estimates). The
barcode infrastructure already built for specimens is a natural fit for stock-item tracking too.

### QMS (Quality Management System)
Worth flagging explicitly: a separate ISO 15189:2022 Lab QMS project already exists. Before
building a QMS module inside AtollLIS from scratch, the real first question is whether this phase
should integrate with or extend that existing system, rather than duplicate it — that's a decision
to make deliberately when this phase is actually reached, not default into either direction.

## Suggested order

Billing's domestic piece (fee schedule + itemized billing) is the most self-contained and doesn't
depend on anything external — reasonable to tackle first among the three. Aasandha submission,
Inventory, and QMS all have real open dependencies (an external spec, a decision about the
existing QMS project) worth resolving before committing to a build.
