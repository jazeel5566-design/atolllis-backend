# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AtollLIS — a multi-tier Laboratory Information System (Maldives: Health Centre → Atoll Hospital → Regional Hospital). Node.js (CommonJS) + Express 4 + Prisma 5 + JWT/bcrypt. The backend also serves the entire frontend, a single-file vanilla-JS SPA at `public/index.html` (~3000 lines, no build step), from the same origin.

## Owner rules

- This system uses real IGMH hospital data and real numeric IGMH test codes. Never use placeholder codes or invented data.
- `DATABASE_URL` in `.env` is the **LIVE production Neon database**. Never run `npm run seed`, `npm run setup`, `npm run prisma:migrate`, `prisma migrate dev`, or `prisma migrate reset`.
- Run `npx prisma db push` only after the owner approves it, and stop immediately if Prisma warns about data loss.
- Deploy order: make changes locally → `npm install` → `npx prisma db push` (schema changes only) → commit and push to GitHub → the owner deploys manually on Render.
- Before building any feature, present a plan and wait for the owner's "yes". Flag ambiguous requirements instead of assuming.
- After editing `public/index.html`, check syntax and that every button or `onclick` handler exists.
- Roadmap: Settings Phase 1 (user and role management) and Phase 2 (HIS aliases, test panels, reflex rules) are done. Phase 5 (structured rejection reasons, auto-accept, critical-value escalation) is paused because the meaning of "auto-accept" is not decided yet. Ask the owner before building auto-accept.

## Commands

```bash
npm run dev              # start API + frontend on http://localhost:4000 (same as npm start; no watcher — restart after edits)
npx prisma generate      # regenerate client after editing prisma/schema.prisma (also runs on postinstall)
npx prisma db push       # applies schema changes to the live DB — owner approval required (see Owner rules)
```

There are no tests, no linter, and no build step. A locally running server reads and writes the live database, so verify with read-only requests (`GET /api/health`, list endpoints) unless the owner has agreed to a write.

Env vars (`.env`, see `.env.example`): `DATABASE_URL`, `JWT_SECRET`, `PORT`.

## Docs are partly stale — trust the code

- **Database is PostgreSQL (Neon)**, per `prisma/schema.prisma`. README and `.env.example` still describe SQLite as the default. Some queries are Postgres-only (`mode: 'insensitive'` in `src/routes/his.js`).
- **No `prisma/migrations/` directory exists.** The schema has been applied with `prisma db push`. `npm run setup` / `npm run prisma:migrate` run `prisma migrate dev --name init` and are forbidden by the Owner rules — switching to real migrations is a deliberate planned step (ARCHITECTURE.md build order #1), for the owner to initiate.
- `prisma/seed.js` holds demo data (mnemonic codes like `GLU`, `password123` accounts) that predates the real IGMH catalog; it does not describe what is in the live database.
- README mentions `requireRegional`, order-level `accept`/`reject`/`load-analyser` routes, and facility-id-in-login. None exist any more: authorization is capability-based, accept/reject/load-analyser are per specimen in `src/routes/specimens.js`, and login is `{ username, password, actingFacilityId? }`.
- `ARCHITECTURE.md` (cluster-per-repo, Postgres RLS, subdomain tenant routing, cross-cluster referral API) and `ROADMAP.md` (three app branches, Billing/Aasandha, Inventory, QMS) are **target designs, not built**. Only `Facility.parentFacilityId` / `urlSlug` exist as groundwork, and nothing reads them.

## Architecture

`src/server.js` → `src/app.js` mounts one router per resource under `/api/*` from `src/routes/`. Each route file talks to Prisma directly via the shared client in `src/db.js` — there is no service/repository layer. `express-async-errors` is loaded, so async handlers just throw; the final handler returns a generic 500. Shared business logic lives in `src/utils/`.

### Auth and authorization

- JWT payload (`req.user`): `{ userId, name, facilityId, tier, role }`, 12h expiry, no refresh. `facilityId` is the facility the user is *acting at* for this session — users can be authorized at several via `UserFacilityAccess`, and login returns `requiresFacilitySelection` when more than one applies.
- `requireCapability('<cap>')` (`src/middleware/auth.js`) checks the **`RoleCapability` table on every request** — role→capability assignment is data, editable by an admin at runtime. `src/utils/roles.js` holds the fixed list of valid role/capability names and labels; its static `ROLE_CAPABILITIES` map is only the default (it omits `view_audit`, which the seed grants) and is still what `canGrantRole` consults.
- Two places intentionally check `req.user.role !== 'admin'` directly instead of a capability (editing role capabilities, creating mock HIS memos) so a role can't grant itself more power.
- Capabilities: `collect`, `accept`, `process`, `certify`, `manage_users`, `manage_catalog`, `manage_labs`, `view_audit`.
- `GET /api/auth/detect-facility` matches `req.ip` against `FacilityNetwork` CIDRs (`src/utils/cidr.js`, IPv4 only); `trust proxy` is on for this.

### Facility isolation (the rule that must not be broken)

Tenant isolation is enforced only in application code, per route, keyed on `req.user.facilityId`:

- The **ordering facility** sees its whole order. Any other facility sees only tests that were `referred` to it (`performingFacilityId === viewer`), and specimens carrying at least one such test.
- The `interfaced` status (result entered, not yet certified) is exposed as `visibleStatus: 'processing'` to anyone but the performing facility.
- This rule is implemented separately in `mapOrderForViewer()` (`routes/orders.js`), `visibleTestsForSpecimen()` (`routes/specimens.js`), `routes/history.js`, and `routes/reports.js` (reports: one sheet per performing lab; the ordering facility gets every sheet, a reference lab only its own). A change to visibility has to be made in all of them.
- Mutations check ownership explicitly: collection/acceptance/referral require `order.orderingFacilityId === req.user.facilityId`; result entry and certification require `test.performingFacilityId === req.user.facilityId`.

### Order pipeline

Data model: `Order` (one per HIS/Billing memo, unique `memoNumber`) → `OrderTest` (one per test) and `Specimen` (one per physical tube). Status strings are plain `String` columns, not enums.

`OrderTest.status`: `ordered` → `deselected` | `collected` → [`awaiting_referral` → `awaiting_receipt` →] `received` → `processing` → `interfaced` → `completed`; `rejected` is an off-ramp from `collected` and can be recollected.

1. **Import** (`POST /api/orders/import`) — reads `MockHisMemo` (stand-in for the external HIS/Billing system; this app never originates memos), resolves codes through `TestAlias`, find-or-creates the `Patient`. Unresolvable codes are kept as "orphan" tests with no catalog entry, so downstream code must tolerate a missing `TestDefinition`.
2. **Collect** (`/orders/:id/collect`, `/recollect`) — creates one `Specimen` per distinct **(category, specimenType)** among selected tests. Barcode format from `generateSpecimenNumber()`: `<category letter><YY><M unpadded><DD><4-digit per-category daily sequence>`; the letter comes from `TestCategory.letter`. Tests whose `minTier` outranks the facility's tier go straight to `awaiting_referral`.
3. **Refer** (`/orders/:id/refer`) — `referralTarget()` in `utils/domain.js`: atoll-level tests go to the collecting facility's `parentAtollId` (or Regional if none); regional-level tests go straight to Regional. This still keys off `Facility.tier` / `parentAtollId`, not the newer generic tree fields.
4. **Accept / reject** — per specimen, by barcode (`/api/specimens/:specimenNumber/...`). The ordering facility uses `/accept` and `/reject`; a receiving lab uses `/receive-referral` (or the whole-order `/orders/:id/receive-referral`) and `/reject-referral`, which affects only the tests referred to it and hands them back to the ordering facility as `rejected` (`referred: false`, `performingFacilityId` reset) for recollect + re-refer. Every rejection takes `{ reasonId, note }` — a `RejectionReason` id or `'other'` with a required note (`src/utils/rejection.js`) — and writes a `SpecimenRejection` row; `GET /api/specimens/rejections` is the log behind the summary table.
5. **Results** (`routes/tests.js`, addressed as `/api/tests/:orderId/:code/...`) — analyser result (requires `processing`; 422 on unit mismatch against the catalog), manual result or structured culture/sensitivity result (require `received`); all land in `interfaced`.
6. **Certify** — performing facility only. `evalResult()` computes the flag from sex/age-matched `ReferenceRange` plus catalog critical limits. A critical value is snapshotted to `OrderTest.criticalFlag` at result entry and cannot be certified until a `reached` `CriticalNotification` attempt is recorded (`POST /api/tests/:orderId/:code/critical-notification`). Escalation is computed on read from `enteredAt` (`src/utils/critical.js`: overdue at 30 min, Regional admin at 60 min) — `GET /api/tests/critical` is the worklist, `/critical-log` the history; the admin's cross-lab list deliberately omits value and patient. Returns `reflexSuggestions` from `ReflexRule` — never auto-ordered; `/add-reflex-test` adds an `ordered` test that then needs `/recollect`.

### Conventions

- IDs for most tables are app-generated via `uid('<PREFIX>')` (`src/utils/id.js`), e.g. `ORD…`, `OT…`, `SPC…`, `PT…`, `LOG…`; they are not DB defaults.
- Actor names (`collectedBy`, `acceptedBy`, `validatedBy`, `referredByName`) are always taken from `req.user.name`, never from the request body.
- Every state-changing action calls `logAudit(req.user, { action, entityType, entityId, details })` (`src/utils/audit.js`), which swallows its own errors.
- List-valued columns (`TestPanel.testCodes`, `MockHisMemo.testCodes`) are JSON-encoded strings — `JSON.parse`/`stringify` at the boundary.
- `OrderTest.code` / `name` and `Specimen.category` are snapshots, not foreign keys to the catalog; renaming a catalog code means updating every referencing table (see `prisma/renumber-test-codes.js`, a one-off script, for the full list).
- Multi-step writes are sequential Prisma calls, not transactions.
- The frontend resolves its API base as `location.origin + '/api'` (falling back to `http://localhost:4000/api` when opened as a file); API changes usually need a matching edit in `public/index.html`.
