# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AtollLIS — a multi-tier Laboratory Information System (Maldives: Health Centre → Atoll Hospital → Regional Hospital). Node.js (CommonJS) + Express 4 + Prisma 5 + JWT/bcrypt. The backend also serves the entire frontend, a vanilla-JS SPA with no build step, from the same origin: `public/index.html` (markup only), `public/css/app.css`, and plain scripts in `public/js/` that share one global scope and load in the order `index.html` lists them (`core.js` constants, session, API client and helpers; then login, shell, home, collection, acceptance, processing, result-review, reports, settings, catalog; `init.js` last). Code that runs at load time may only use what earlier files define; functions called from `onclick` or later events may live in any file. A new screen goes in its own file, added to that list before `init.js`.

## Owner rules

- This system uses real hospital data and the real numeric test codes from the lab's own catalog. Never use placeholder codes or invented data.
- `.env` points at the Neon **dev branch** (`DEV_BRANCH_ID`, `br-fragrant-bonus-az7a0v6w`), a copy of production. Production's URL is kept only in Render's settings, never in `.env`. Before any database work, confirm the branch: `select current_setting('neon.branch_id', true)` must equal `DEV_BRANCH_ID` (`assertDevBranch()` in `src/utils/db-guard.js` does this; tests and scripts must call it). Never run `npm run seed`, `prisma migrate reset`, or `prisma db push`.
- Schema changes go through migration files in `prisma/migrations/` (see Commands). Stop and ask the owner if a generated migration drops or alters a column holding data.
- Deploy order: edit `schema.prisma` → `npm run migrate:new -- --name <change>` → read the generated SQL → `npm run migrate:deploy` (applies it to dev) → commit and push to GitHub → the owner runs `node scripts/migrate-production.js` (it asks for the production address, refuses dev, shows what it will apply and waits for "yes") → the owner deploys manually on Render. Database before code, so every migration must leave the previous code working (add, don't rename or drop in the same release). Claude never runs anything against production.
- Production has been on migrations since 2026-10-28 (owner ran the script; a Neon branch `before-phase-0` holds the state before that).
- Before building any feature, present a plan and wait for the owner's "yes". Flag ambiguous requirements instead of assuming.
- After editing the frontend (`public/index.html`, `public/js/`), check each file's syntax (`node --check`) and that every button or `onclick` handler exists.
- Roadmap: Settings Phase 1 (user and role management) and Phase 2 (HIS aliases, test panels, reflex rules) are done. Autoverification ("auto-accept") is postponed by the owner until the system is in live use; do not build it before then.

## Commands

```bash
npm run dev              # start API + frontend on http://localhost:4000 (same as npm start; no watcher — restart after edits)
npx prisma generate      # regenerate client after editing prisma/schema.prisma (also runs on postinstall)
npm run migrate:new -- --name <change>   # write a migration file for a schema.prisma change (does not apply it)
npm run migrate:deploy   # apply pending migrations to the database in .env (the dev branch)
npm run migrate:status   # compare prisma/migrations with the database
```

`npm test` runs everything (`node --test`, one file at a time); `npm run test:unit` runs only the pure-function tests, which need no database. The API tests in `test/api/` drive the real app with supertest against the dev branch: `test/api/fixtures.js` checks the branch with `assertDevBranch()`, creates "ZZ Test" accounts, patient and `ZZTEST-` memos, picks catalog tests from the real catalog, and deletes all of it afterwards. A change to the visibility rule, the critical-value gate or amendments should come with a test there. `npm run test:page` (needs `npm run dev` running and Chrome) logs into the real page in headless Chrome as a temporary admin, opens every screen and tab, and fails on any script error or screen that cannot load; run it after any frontend change, and add new screens to its list. There is no linter and no build step. A locally running server reads and writes the dev branch; writes there are fine, but it holds a copy of real patient data, so it stays on this machine.

Env vars (`.env`, see `.env.example`): `DATABASE_URL`, `DIRECT_URL` (same branch, no pooler; used by Prisma migration commands), `DEV_BRANCH_ID`, `JWT_SECRET`, `PORT`.

## Docs are partly stale — trust the code

- **Database is PostgreSQL (Neon)**, per `prisma/schema.prisma`. README still describes SQLite as the default. Some queries are Postgres-only (`mode: 'insensitive'` in `src/routes/his.js`).
- **Migrations started on 2026-10-26** with `prisma/migrations/0_baseline`, generated from the schema as it stood (it matched the database exactly). Everything before that was applied with `prisma db push`.
- `prisma/seed.js` holds demo data (mnemonic codes like `GLU`, `password123` accounts) that predates the real test catalog; it does not describe what is in the live database.
- README mentions `requireRegional`, order-level `accept`/`reject`/`load-analyser` routes, and facility-id-in-login. None exist any more: authorization is capability-based, accept/reject/load-analyser are per specimen in `src/routes/specimens.js`, and login is `{ username, password, actingFacilityId? }`.
- `ARCHITECTURE.md` (cluster-per-repo, Postgres RLS, subdomain tenant routing, cross-cluster referral API) and `ROADMAP.md` (three app branches, Billing/Aasandha, Inventory, QMS) are **target designs, not built**. Only `Facility.parentFacilityId` / `urlSlug` exist as groundwork, and nothing reads them.

## Architecture

`src/server.js` → `src/app.js` mounts one router per resource under `/api/*` from `src/routes/`. Each route file talks to Prisma directly via the shared client in `src/db.js` — there is no service/repository layer. `express-async-errors` is loaded, so async handlers just throw; the final handler returns a generic 500. Shared business logic lives in `src/utils/`.

### Auth and authorization

- JWT payload (`req.user`): `{ userId, name, facilityId, tier, role, tv }`, 12h expiry, no refresh. `facilityId` is the facility the user is *acting at* for this session — users can be authorized at several via `UserFacilityAccess`, and login returns `requiresFacilitySelection` when more than one applies.
- `requireAuth` also loads the account on every request: a removed or disabled (`active: false`) account, a `tokenVersion` different from the token's `tv`, or lost access to the acting facility answers 401 at once. `name` and `role` in `req.user` come from the account, not the token, so a role change applies to the next request. Bump `tokenVersion` to end every session of an account (done on a password change or reset, and on disabling).
- Account rules live in `src/utils/password.js` (mirrored in `public/js/login.js`): password at least 10 characters and not containing the username; 5 wrong passwords lock the account for 15 minutes (423; a lab manager can unlock); a password set by someone else (`mustChangePassword`, on every new account and reset) blocks everything except `POST /api/auth/change-password` (`requireAuthForPasswordChange`). That route returns a fresh token, since it bumps `tokenVersion`. The page logs out after 15 minutes idle. Only an administrator may change an administrator's account (`cannotManage()` in `routes/users.js`).
- `app.js` sends helmet headers with a CSP that allows the page's inline script and `onclick` handlers, Google Fonts and blob: (the report PDF). CORS is closed unless `ALLOWED_ORIGINS` lists an origin. `/api/auth/login` is rate-limited per address (100 per 15 minutes; generous because a hospital can share one address).
- `requireCapability('<cap>')` (`src/middleware/auth.js`) checks the **`RoleCapability` table on every request** — role→capability assignment is data, editable by an admin at runtime. `src/utils/roles.js` holds the fixed list of valid role/capability names and labels; its static `ROLE_CAPABILITIES` map is only the default (it omits `view_audit`, which the seed grants) and is still what `canGrantRole` consults.
- Two places intentionally check `req.user.role !== 'admin'` directly instead of a capability (editing role capabilities, creating mock HIS memos) so a role can't grant itself more power.
- Capabilities: `collect`, `accept`, `process`, `certify`, `manage_users`, `manage_catalog`, `manage_labs`, `view_audit`.
- `GET /api/auth/detect-facility` matches `req.ip` against `FacilityNetwork` CIDRs (`src/utils/cidr.js`, IPv4 only); `trust proxy` is on for this.

### Facility isolation (the rule that must not be broken)

Tenant isolation is enforced only in application code, per route, keyed on `req.user.facilityId`:

- The **ordering facility** sees its whole order. Any other facility sees only tests that were `referred` to it (`performingFacilityId === viewer`), and specimens carrying at least one such test.
- The `interfaced` status (result entered, not yet certified) is exposed as `visibleStatus: 'processing'` to anyone but the performing facility.
- This rule is implemented separately in `mapOrderForViewer()` (`routes/orders.js`), `visibleTestsForSpecimen()` (`routes/specimens.js`), `routes/history.js`, and `routes/reports.js` (reports: one sheet per performing lab; the ordering facility gets every sheet, a reference lab only its own — `GET /api/reports/:orderId/pdf` draws the same data with pdfkit in `src/utils/report-pdf.js`, and the Reports page opens that PDF in a new tab instead of rendering the report itself). A change to visibility has to be made in all of them.
- Mutations check ownership explicitly: collection/acceptance/referral require `order.orderingFacilityId === req.user.facilityId`; result entry and certification require `test.performingFacilityId === req.user.facilityId`.

### Order pipeline

Data model: `Order` (one per HIS/Billing memo, unique `memoNumber`) → `OrderTest` (one per test) and `Specimen` (one per physical tube). Status strings are plain `String` columns, not enums.

`OrderTest.status`: `ordered` → `deselected` | `collected` → [`awaiting_referral` → `awaiting_receipt` →] `received` → `processing` → `interfaced` → `completed`; `rejected` is an off-ramp from `collected` and can be recollected.

1. **Import** (`POST /api/orders/import`) — reads `MockHisMemo` (stand-in for the external HIS/Billing system; this app never originates memos), resolves codes through `TestAlias`, find-or-creates the `Patient`. Unresolvable codes are kept as "orphan" tests with no catalog entry, so downstream code must tolerate a missing `TestDefinition`.
2. **Collect** (`/orders/:id/collect`, `/recollect`) — creates one `Specimen` per distinct **(category, specimenType)** among selected tests. Barcode format from `generateSpecimenNumber()`: `<category letter><YY><M unpadded><DD><4-digit daily sequence>`; the letter comes from `TestCategory.letter`, the date is the Maldives date (`src/timezone.js` sets the process to `Indian/Maldives`, overridable with `APP_TIMEZONE`). The sequence comes from `nextSpecimenNumber()` (`src/utils/specimen-number.js`): one atomic `INSERT … ON CONFLICT` on the `SpecimenSequence` row for that prefix, so simultaneous collections never share a barcode and numbers are never reused. The shared `drawSpecimens()` in `routes/orders.js` does the grouping for both collect and recollect. Tests whose `minTier` outranks the facility's tier go straight to `awaiting_referral`.
3. **Refer** (`/orders/:id/refer`) — `referralTarget()` in `utils/domain.js`: atoll-level tests go to the collecting facility's `parentAtollId` (or Regional if none); regional-level tests go straight to Regional. This still keys off `Facility.tier` / `parentAtollId`, not the newer generic tree fields.
4. **Accept / reject** — per specimen, by barcode (`/api/specimens/:specimenNumber/...`). The ordering facility uses `/accept` and `/reject`; a receiving lab uses `/receive-referral` (or the whole-order `/orders/:id/receive-referral`) and `/reject-referral`, which affects only the tests referred to it and hands them back to the ordering facility as `rejected` (`referred: false`, `performingFacilityId` reset) for recollect + re-refer. Every rejection takes `{ reasonId, note }` — a `RejectionReason` id or `'other'` with a required note (`src/utils/rejection.js`) — and writes a `SpecimenRejection` row; `GET /api/specimens/rejections` is the log behind the summary table.
5. **Results** (`routes/tests.js`, addressed as `/api/tests/:orderId/:code/...`) — manual result (requires `received` or `processing`) or structured culture/sensitivity result (requires `received`); both land in `interfaced`. A result from an analyser never comes through a user session: it arrives via `/api/interface` (see Analyser interface), so the audit trail always says truthfully whether a person or an instrument entered it.
6. **Certify** — performing facility only. `evalResult()` computes the flag from sex/age-matched `ReferenceRange` plus catalog critical limits. A critical value is snapshotted to `OrderTest.criticalFlag` at result entry and cannot be certified until a `reached` `CriticalNotification` attempt is recorded (`POST /api/tests/:orderId/:code/critical-notification`). Escalation is computed on read from `enteredAt` (`src/utils/critical.js`: overdue at 30 min, Regional admin at 60 min) — `GET /api/tests/critical` is the worklist, `/critical-log` the history; the admin's cross-lab list deliberately omits value and patient. Returns `reflexSuggestions` from `ReflexRule` — never auto-ordered; `/add-reflex-test` adds an `ordered` test that then needs `/recollect`.
7. **Amend** (`POST /api/tests/:orderId/:code/amend`, `certify` at the performing lab, `completed` only) — corrects or withdraws a certified result in one step (ISO 15189:2022 7.4.1.8). The first-reported value, validator and time move to a `ResultAmendment` row and are never overwritten; `OrderTest` carries the current value (a withdrawal sets it to the text in `WITHDRAWN_TEXT`). Rules live in `src/utils/amendment.js`: when the change alters what the result means (`changesMeaning` — any flag change, any text result, any withdrawal) a notification attempt must come with the request; if nobody was reached the amendment still goes out and stays outstanding (`GET /api/tests/amendments?pending=1`, settled by `POST /api/tests/amendments/:id/notification`). A corrected value that is critical and not yet notified returns to `interfaced` and the ordinary critical-value rule holds it. Reports, history, the specimen lookup and the order list all carry the amendment so every screen and the PDF say "amended" — a change to what is shown has to be made in each. Culture results cannot be amended yet.

Reference ranges: each `ReferenceRange` has an age band with its own `ageUnit` (`D`/`M`/`Y`), both ends included, counted in completed units; the patient's age is taken on the specimen's collection date (`matchRange(test, patient, at)` in `src/utils/domain.js`, mirrored in `public/js/core.js`). When several bands fit, a sex-specific one wins, then the finer unit.


### Analyser interface

Analysers reach the app only through the bridge program in `bridge/` (a separate package with its own `package.json`, run on one always-on computer in the lab network — not part of the Render deployment). One bridge process serves every analyser listed under `instruments` in its `config.json`, speaking ASTM (CLSI LIS01-A2 link + LIS02-A2 records, TCP or serial) or HL7 v2.5.1 over MLLP to each, and calls `/api/interface/{heartbeat,query,results}` with an `X-Instrument-Key` header — no JWT; `routes/interface.js` resolves the key (stored only as a SHA-256 hash on `Instrument`) and everything it does is scoped to that instrument's facility.

- `src/utils/interface.js` holds the rules, shared by both protocols: a query returns only tests on that specimen that this facility performs, are `received`/`processing`, and have an `InstrumentTestMap` row, and moves them to `processing`; a result lands as `interfaced` (same as manual entry, so the critical-value rule applies) or is written to `InterfaceMessage` as `unmatched` (held for a person), `duplicate`, `refused` (already certified) or `logged` (QC). Units are never converted — a unit that is not the catalog's or the mapping's declared spelling is held.
- Staff side is `routes/instruments.js` (JWT): instruments and mappings need `manage_users` and are facility-scoped like wards; the log, retry and dismiss need `process`.
- `bridge/simulator.js` plays an analyser for testing. It must never be pointed at the live system with a real barcode.

### Conventions

- IDs for most tables are app-generated via `uid('<PREFIX>')` (`src/utils/id.js`), e.g. `ORD…`, `OT…`, `SPC…`, `PT…`, `LOG…`; they are not DB defaults.
- Actor names (`collectedBy`, `acceptedBy`, `validatedBy`, `referredByName`) are always taken from `req.user.name`, never from the request body.
- Every state-changing action calls `logAudit(req.user, { action, entityType, entityId, details })` (`src/utils/audit.js`), which swallows its own errors.
- List-valued columns (`TestPanel.testCodes`, `MockHisMemo.testCodes`) are JSON-encoded strings — `JSON.parse`/`stringify` at the boundary.
- `OrderTest.code` / `name` and `Specimen.category` are snapshots, not foreign keys to the catalog; renaming a catalog code means updating every referencing table (see `prisma/renumber-test-codes.js`, a one-off script, for the full list).
- Any action that writes more than once runs in `inTransaction()` (`src/utils/transaction.js`). Inside it, a state change is conditional on the state that was checked: `updateMany` with the expected status, then a count check that throws `HttpError(409, …)` (`src/utils/http-error.js`), which rolls everything back and becomes the response. A single-statement state change uses the same conditional `updateMany` without a transaction. `logAudit()` runs after the transaction commits. A unique-key clash (Prisma `P2002`) answers 409.
- Frontend conventions (`public/js/`): `render()` redraws the current view from the server; `renderCached()` redraws from the last GET answers and is what search boxes and client-side filters call, so typing never hits the server (any non-GET request empties that cache). Irreversible actions go through `confirmAction({title, body, confirmLabel})`, never `confirm()`; errors use `showToast(msg, 'error')`, which stays until dismissed. Dialogs close only by their own buttons. Patient identity on any specimen or result surface is drawn by `patientBar()`. Specimen labels use a real Code 128 barcode (`code128Modules`). The login is kept in `sessionStorage` for the tab.
- The frontend resolves its API base as `location.origin + '/api'` (falling back to `http://localhost:4000/api` when opened as a file); API changes usually need a matching edit in `public/js/`.
