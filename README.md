# AtollLIS Backend

A real, runnable API for the multi-tier Laboratory Information System: memo import from HIS/Billing,
sample collection, referral, acceptance/rejection, analyser interface, validation, reporting, and
patient history — all with the same tiered facility isolation and business rules as the frontend
prototype.

**Stack:** Node.js + Express + Prisma ORM + SQLite (swap to PostgreSQL for production — see
`prisma/schema.prisma`) + JWT auth + bcrypt.

## Setup

Requires Node.js 18+.

```bash
cd backend
cp .env.example .env      # edit JWT_SECRET before deploying anywhere real
npm run setup               # installs deps, runs the first migration, seeds demo data
npm run dev                 # starts the API on http://localhost:4000
```

`npm run setup` is shorthand for `npm install && npx prisma migrate dev --name init && npm run seed`.
If you'd rather run those individually (e.g. to re-seed later), that works too — `npm run seed` can
be re-run any time against a fresh migration.

### Demo logins

Seeded by `prisma/seed.js`. Facility ID doubles as the username for every demo account:

| Facility | facilityId | username | password |
|---|---|---|---|
| National Regional Hospital Laboratory | `reg1` | `reg1` | `password123` |
| Ari Atoll Hospital | `atoll1` | `atoll1` | `password123` |
| Faafu Atoll Hospital | `atoll2` | `atoll2` | `password123` |
| Thundufushi Health Centre | `hc1` | `hc1` | `password123` |
| Maalhos Health Centre | `hc2` | `hc2` | `password123` |
| Nilandhoo Health Centre | `hc3` | `hc3` | `password123` |

Try-it memo numbers (already sitting in the mock HIS/Billing store): `HIS-2026-004821`,
`BILL-2026-071190`, `HIS-2026-004900`.

## Architecture notes

- **Memo generation is out of scope**, on purpose — see `src/routes/his.js`. It simulates the
  external HIS/Billing API being queried by memo number. In a real deployment, delete that file's
  `MockHisMemo` table and its dev-seeding route, and point `POST /api/orders/import` at the real
  HIS/Billing system's API instead of Prisma.
- **Facility-scoped visibility** is centralized in `mapOrderForViewer()` in `src/routes/orders.js`:
  a lab sees its own orders in full; a referred-in order shows only the specific referred test(s);
  and the granular `interfaced` status is shown as `processing` to anyone but the performing lab.
  History (`src/routes/history.js`) and Reports (`src/routes/reports.js`) apply the same rule.
- **Referral routing** (`referralTarget()` in `src/utils/domain.js`) sends Atoll-level tests to the
  collecting Health Centre's own parent Atoll Hospital (or straight to Regional if it has none), and
  Regional-level tests straight to Regional, skipping the Atoll tier.
- **Reference ranges & flags** (`evalResult()` in `src/utils/domain.js`) match by sex + age band,
  preferring a sex-specific range over an "Any" one, and flag Low/High/Critical against the test's
  catalog definition.
- **Auth** is a JWT carrying `{ userId, name, facilityId, tier }`. `requireRegional` middleware gates
  catalog editing and lab management to the Regional Hospital, mirroring the frontend's admin rights.

## API reference

All routes except `POST /api/auth/login` and `GET /api/auth/facilities` require
`Authorization: Bearer <token>`.

### Auth
- `GET /api/auth/facilities` — list of facilities for the login picker
- `POST /api/auth/login` `{ facilityId, username, password }` → `{ token, user }`

### Facilities (Admin — Manage Labs)
- `GET /api/facilities`
- `POST /api/facilities` *(Regional only)* `{ name, tier: 'atoll'|'health_centre', parentAtollId? }`
- `DELETE /api/facilities/:id` *(Regional only)* — re-parents any Health Centres to Regional instead of blocking

### Test Catalog
- `GET /api/catalog`
- `POST /api/catalog` *(Regional only)* `{ code, name, category, specimenType, method, units, tat, minTier, criticalLow?, criticalHigh?, comment?, refRanges: [{sex, ageMin, ageMax, low, high}] }`
- `PUT /api/catalog/:code` *(Regional only)*
- `DELETE /api/catalog/:code` *(Regional only)*

### Patients
- `GET /api/patients?query=` — search by name, hospital no., or ID no.
- `POST /api/patients` — manual registration fallback

### HIS / Billing (simulated — see architecture note above)
- `GET /api/his/memos/:memoNumber`
- `POST /api/his/memos` *(dev/demo only)* — seeds a new memo into the mock external system

### Orders (memo → sample → result pipeline)
- `GET /api/orders?stage=` — `pending_collection` | `referral_pending` | `pending_acceptance` | `rejected` | `incoming_referrals` | `analyser_queue` | `validation_queue` | `reportable`
- `GET /api/orders/:id`
- `POST /api/orders/import` `{ memoNumber }` — fetch from HIS/Billing and pull into this facility's queue
- `DELETE /api/orders/:id` — cancel an uncollected memo
- `POST /api/orders/:id/collect` `{ selectedCodes: [code,...], collectedBy }`
- `POST /api/orders/:id/refer` `{ referredByName }` — assigns & sends all `awaiting_referral` tests upward
- `POST /api/orders/:id/accept` `{ acceptedBy }`
- `POST /api/orders/:id/reject` `{ reason }`
- `POST /api/orders/:id/receive-referral` — receiving facility accepts an incoming referral
- `POST /api/orders/:id/load-analyser` — bulk-loads all `received` tests for this sample

### Per-test results
- `POST /api/tests/:orderId/:code/analyser-result` `{ value, unit }` — rejected (422) on unit mismatch
- `POST /api/tests/:orderId/:code/manual-result` `{ value }`
- `POST /api/tests/:orderId/:code/certify` `{ validatedBy }`

### Reports & History
- `GET /api/reports/:orderId` — 403 unless requested by the ordering facility
- `GET /api/history?query=` — facility-scoped patient history search

## Deployment

The backend now serves the frontend itself (`public/index.html`) at the same origin as the API —
this is the recommended setup: one deployment, one URL, no CORS configuration needed. The frontend
auto-detects this and points its API calls at its own origin (`location.origin + '/api'`); it only
falls back to `http://localhost:4000/api` when opened directly as a local file.

### 1. Switch to PostgreSQL

SQLite is fine for local dev but isn't suitable for most hosting platforms (no persistent disk, no
concurrent writers). Before your first production deploy:

1. In `prisma/schema.prisma`, change `provider = "sqlite"` to `provider = "postgresql"`.
2. Get a Postgres database (your host's managed Postgres, or any provider) and its connection string.
3. Delete the `prisma/migrations/` folder if you generated it against SQLite — SQLite and Postgres
   migrations aren't interchangeable, so you need a fresh `migrate dev` run against Postgres.
4. Locally, set `DATABASE_URL` in `.env` to that Postgres connection string and run:
   ```bash
   npx prisma migrate dev --name init
   ```
   This creates `prisma/migrations/` with Postgres-flavored SQL. **Commit that folder to git** —
   it's what `migrate deploy` applies on the server.

### 2. Pick a host

Any platform that runs a persistent Node process works. A few reasonable options:

- **Railway** or **Render** — easiest path: connect the git repo, add a managed Postgres plugin,
  set env vars, deploy. Both auto-detect `npm start` and support a `postinstall` hook (already set
  up in `package.json` to run `prisma generate`).
- **Fly.io** — similar, deploy via `fly launch` + `fly postgres create`.
- **A plain VPS** — clone the repo, `npm ci`, run migrations, then run the process under `pm2` or a
  systemd service behind nginx (for TLS termination and a domain).

### 3. Environment variables on the host

Set these in whatever the platform's environment/secrets panel is:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Postgres connection string |
| `JWT_SECRET` | A long random string — **not** the placeholder in `.env.example` |
| `PORT` | Usually set automatically by the platform; the app reads it if provided |

### 4. Deploy, migrate, seed

Most platforms run `npm install` (triggering `postinstall` → `prisma generate`) then `npm start`
automatically on every deploy. You still need to apply migrations and seed data yourself the first
time — either via the platform's one-off command runner / shell, or a deploy hook:

```bash
npm run migrate:deploy   # applies committed migrations — safe to re-run, only applies what's new
npm run seed              # only run this once, against a fresh database
```

`npm run seed` is **not idempotent** — running it twice will fail on unique-constraint conflicts
(it always tries to create the same facility/user/test IDs). Re-seeding a database that already has
this data isn't something you want to do anyway; treat it as first-boot only.

### 5. Verify

- `GET https://your-app-url/api/health` should return `{"ok":true,...}`
- Visiting `https://your-app-url/` should load the login screen and list the seeded facilities
- Log in with a seeded account (e.g. `hc1` / `hc1` / `password123`) and confirm you can fetch one
  of the seeded try-it memo numbers

### 6. Before calling it production-ready

None of these are done yet — see "What's deliberately not here yet" above, plus:

- **Change or remove the seeded demo passwords.** `password123` for every account is fine for a
  demo, not for anything real.
- **Remove or protect `POST /api/his/memos`** (`src/routes/his.js`) — it's a dev-only utility for
  seeding fake memos into the mock external system and has no auth on it at all.
- **Rotate `JWT_SECRET`** to something generated for this deployment specifically.
- **Add rate limiting** (e.g. `express-rate-limit`) at minimum on `/api/auth/login`.
- **Set up database backups** — check what your Postgres host provides by default.
- Consider narrowing `cors()` to a specific origin if you ever split frontend and backend hosting
  again — right now it allows any origin, which is fine only because they share one origin.

## What's deliberately not here yet

- No refresh tokens (12h JWT expiry only) or rate limiting.
- No file storage — labels/reports are structured JSON; rendering them as PDF/print output stays a
  frontend concern.
- No automated tests. Given how much of the business logic sits in `src/utils/domain.js`, that's the
  first thing worth unit-testing if this goes further.

## Future direction: local per-facility deployment (not started)

Right now AtollLIS is one backend and one shared cloud database — every facility is always online
and talking to the same server. That's the right call for where the project is today, but it means
a Health Centre with poor or intermittent internet has no way to work when the connection drops.

A real next step, if that becomes a priority, is an **offline-first / edge deployment** model: each
facility (or at least each Health Centre) runs its own small local server holding its own patients
and in-progress orders, syncing up to a central hub whenever connectivity allows. This is a
legitimate, well-established pattern for exactly this kind of geography — it's how systems like
DHIS2 and OpenMRS handle remote health facilities with unreliable connectivity.

This is **not a small feature** — it's a different architecture, and would need real design work
before implementation, specifically:

- **Conflict resolution** — if the same patient is registered independently at two facilities
  before they've synced, which record wins, and how is that reconciled?
- **A sync protocol** — what syncs, how often, in which direction, and what happens if connectivity
  drops mid-sync?
- **Physical infrastructure** — an actual local server or small machine running at each facility,
  and someone responsible for maintaining it.
- **Referral routing** — the current referral system relies on the *same* order being visible to
  both the sending and receiving facility in real time; that gets significantly harder once
  facilities aren't sharing one live database.

Nothing about the current codebase blocks this later — patient/data access already goes through
backend routes rather than being scattered across raw queries — but it would be a genuine
rearchitecture project, not an incremental Settings change.
