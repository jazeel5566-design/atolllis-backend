# AtollLIS Cluster Architecture — Target Design (not yet built)

This document is the concrete plan for turning this repo into a template that can be cloned into
fully independent "clusters" — each one its own repo, its own Neon database, its own deployment —
with **zero code changes required on any existing cluster** when a new one is created.

This is a design document, not a changelog. As of today, only the additive groundwork below has
actually been built. Everything else here is the specific plan for when it's time to build it —
detailed enough to execute against, including the parts that are easy to get subtly wrong.

## The model

```
Cluster A (repo + Neon DB, isolated)      Cluster B (repo + Neon DB, isolated)
        |                                          |
        +-------------------+   +-------------------+
                            |   |
                      Referral API (only when a referral crosses clusters)
```

A cluster is: one GitHub repo (cloned from this template, independent commit history from that
point on), one Neon project, one deployment (Render/Vercel), one domain. Inside a cluster, the
facility hierarchy (institution → atoll hospital → health centres, or whatever shape that cluster
needs) is multi-tenant data in the *same* database, isolated by Postgres Row-Level Security and
identified by subdomain.

## What's already built (additive, safe)

- `Facility.parentFacilityId` (self-relation) and `Facility.urlSlug` — a generic tree, separate
  from the existing `tier`/`parentAtollId` fields the current referral logic depends on. Nothing
  reads these two fields yet; they exist so the data shape is ready.
- Current 3 facilities populated: Regional Hospital (root, slug `regional`), Atoll Hospital (child
  of Regional, slug `atoll`), Health Centre (child of Atoll Hospital, slug `hc`).

## What's still design, not code

### 1. Row-Level Security

**The core idea:** every tenant-scoped table gets `ENABLE ROW LEVEL SECURITY` and a policy that
compares the row's `facilityId` (or an ancestor relationship) against a Postgres session variable
set per-request — so a bug in application code can no longer leak another facility's data, because
the database itself refuses the row.

**Tables that need it:** `User`, `Order`, `OrderTest`, `Specimen`, `Patient`, `AuditLog`,
`FacilityNetwork`, `UserFacilityAccess`, `Ward`. (Network-wide reference data — `TestDefinition`,
`TestCategory`, `Organism`, `Antibiotic`, `ReflexRule`, etc. — stays global, no RLS.)

**The ancestor function**, referenced in the person's own notes:

```sql
CREATE OR REPLACE FUNCTION is_facility_ancestor(ancestor_id text, facility_id text)
RETURNS boolean AS $$
  WITH RECURSIVE chain AS (
    SELECT id, "parentFacilityId" FROM "Facility" WHERE id = facility_id
    UNION ALL
    SELECT f.id, f."parentFacilityId" FROM "Facility" f
    JOIN chain c ON f.id = c."parentFacilityId"
  )
  SELECT EXISTS (SELECT 1 FROM chain WHERE id = ancestor_id);
$$ LANGUAGE sql STABLE;
```

**Example policy** (Order table — a facility sees its own orders; an ancestor facility sees orders
referred to any of its descendants):

```sql
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;

CREATE POLICY facility_isolation ON "Order"
  USING (
    "orderingFacilityId" = current_setting('app.current_facility_id', true)
    OR is_facility_ancestor(current_setting('app.current_facility_id', true), "orderingFacilityId")
  );
```

**The gotcha that matters most:** this app connects through Neon's pooled endpoint (PgBouncer,
transaction-pooling mode). `SET LOCAL` only stays scoped correctly for the lifetime of one
transaction — under transaction pooling, the physical connection can be handed to a *different*
request between transactions, so `SET LOCAL` **must** be the first statement inside an explicit
transaction that also contains the actual query, every single time:

```js
await prisma.$transaction([
  prisma.$executeRaw`SELECT set_config('app.current_facility_id', ${facilityId}, true)`,
  prisma.order.findMany({ where: { ... } }), // still keep this filter — see below
]);
```

**Do not remove the existing application-level filters when RLS goes in.** Keep both. RLS is a
second, independent layer — if a future code change ever forgets a `where: { facilityId }` clause,
RLS is what catches it; if RLS itself is ever misconfigured, the application-level filter is what
catches that. Removing the app-level checks "because RLS handles it now" turns two layers of
defense into one.

**Practical path:** wrap this in a Prisma Client Extension (`$extends`) that reads the current
request's facility ID (from request-scoped storage — `AsyncLocalStorage`, not a Prisma singleton
field, since concurrent requests would otherwise clobber each other) and automatically prepends the
`set_config` call to every query. Write it once, apply it everywhere, rather than hand-wrapping
every route.

### 2. Subdomain-based tenant routing

Middleware, run before every route: read `req.hostname`, extract the subdomain, look up
`Facility.urlSlug`, attach the matching facility to `req`. This is what makes
`atollhospital.clustera-atolllis.com` resolve to the right tenant without a facility picker.

This requires a real wildcard domain and Cloudflare DNS pointed at the deployment before it can be
tested at all — there's no way to build this correctly against a single default Render subdomain.
Build this once there's an actual domain to point at.

### 3. New-cluster runbook

This is **not** something application code can automate away — creating a new cluster always
means someone taking these actions once, outside any app:

1. Clone the template repo on GitHub (`Use this template` → new repo, independent history from here)
2. Create a new Neon project; run `prisma migrate deploy` against it (see note below on `migrate`
   vs. `db push`) — this applies the schema **and** the RLS policies/function in one step, since
   they'll live in the migration files
3. Create a new Render (or Vercel) project pointed at the new repo, with that cluster's own
   `DATABASE_URL`, `JWT_SECRET`, and any other per-cluster env vars
4. Point a wildcard domain at it via Cloudflare DNS
5. Insert the first facility row (root, no parent) and its first admin user — this is a one-time
   seed script per new cluster, not a UI, since there's no admin user yet to click anything

**One tooling change this implies:** this whole project has used `prisma db push` throughout,
which doesn't produce migration files — nothing to replay onto a fresh database. For a template
that gets cloned repeatedly, switching to `prisma migrate dev` (which generates real, versioned SQL
migration files checked into the repo) is what makes step 2 above possible at all. That switch is
worth doing deliberately, on its own, before the RLS work — not bundled into it.

### 4. Referral API (cross-cluster)

A small, separate endpoint — either its own tiny service or one route on each cluster's app — that
accepts a specific referral record (patient basics + the referred test codes, nothing else) and
creates the corresponding order on the receiving cluster. Deliberately not a shared database
connection: two clusters never see each other's data except the specific records explicitly
referred, which is exactly the isolation boundary the whole design is protecting.

## Suggested build order, when it's time

1. Switch `db push` → `prisma migrate dev` (mechanical, low-risk, unblocks everything else)
2. Write the RLS migration (function + policies) and the Prisma Client Extension that sets the
   session variable — test thoroughly against *this* cluster's data before trusting it
3. Subdomain middleware — once a real domain exists to test against
4. The cluster-creation runbook as an actual checklist/script bundle
5. Referral API — only once a second cluster genuinely exists to refer to
