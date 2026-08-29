# PracticeOS

CA/tax-firm practice management SaaS with native Tally Prime integration.
Full functional spec: see `ca-saas-platform-spec-v1.1.md` (delivered separately).

## Stack
React + TypeScript (Vite) frontend, Supabase (Postgres + Auth + Storage) backend.

## Status
- [x] Core schema (`supabase/migrations/0001_init_schema.sql`) — all entities from the spec §2
- [x] RLS policies (`supabase/migrations/0002_rls_policies.sql`) — firm-tenancy + per-client scoping for Article Assistants
- [x] `firm_id` auto-derive trigger (`supabase/migrations/0003_firm_id_trigger.sql`) — client-scoped inserts no longer need to pass `firm_id` by hand
- [x] Local dev seed data (`supabase/seed.sql`)
- [x] Typed Supabase client + data-access layer (`src/lib/`)
- [x] Dashboard page (`src/pages/Dashboard.tsx`) — compliance heatmap, Tally sync health, revenue/outstanding, upcoming deadlines, reconciliation alerts
- [x] Client List (`src/pages/ClientList.tsx`) — searchable table, links into Client Detail
- [x] Client Detail View — `ClientDetailShell` (sidebar + header) wrapping nested routes: `ClientOverview` (Tally sync panel, filings timeline, quick stats, open tasks, document summary, per spec §5.2), `ClientDocuments`, `ClientCredentials`, `ClientTallySync` (ledger explorer), `ClientFilings`, `ClientTasks` (inline status change), `ClientBilling` (invoices + time logged). Activity is the only tab still disabled.
- [x] Client-side routing (`react-router-dom`) via a shared `AppShell` — Dashboard / Clients / Team nav, unbuilt routes fall back to a "coming soon" stub instead of a dead link
- [x] Reconciliation Center (spec §7) — Summary Grid (`ReconciliationCenter.tsx`, period switcher) + Line-Item Detail (`ReconciliationDetail.tsx`, status tabs, expandable rows, resolve/escalate/create-task, bulk actions)
- [x] Auth wiring — Admin/Partner invites staff via a `Team` page → Edge Function → Supabase Auth invite email → `staff.auth_user_id` links automatically on signup (DB trigger, both directions), no manual linking step anywhere
- [x] Ingestion API — `request-pairing-code` → `agent-pair` → `ingest-tally-sync` Edge Functions (spec §3.3 steps 1–6), token-based agent auth, idempotent upserts into `tally_ledgers`/`tally_vouchers`; "Connect Tally" button on Client Detail generates a real pairing code
- [x] Document Vault storage — private `client-documents` bucket, path-based RLS (`can_access_client()` applied to the path's client_id segment via a cast-safe helper), upload/list/signed-URL-download/role-gated-delete
- [ ] Activity tab on Client Detail — no unified audit-log table exists yet; would need a new table + triggers to populate it meaningfully rather than faking one
- [ ] Sync Agent — Windows service (spec §8)
- [ ] GSTR-2B reconciliation matching logic (spec §4.1) — needs credentials vault decryption + GST portal API access

## Dashboard design

The Dashboard uses a deliberate "ledger paper" visual language rather than a
generic SaaS look — appropriate for an accounting tool used by CAs all day:

- **Palette** (`src/styles/tokens.css`): cool ledger-grey paper, deep navy
  ink, and a gold accent that does all structural/UI work (links, active
  states, the page's signature margin rule) — kept separate from red/amber/
  green, which are reserved entirely for compliance status so they stay a
  reliable, unambiguous signal.
- **Type**: Fraunces (serif, official-document character) for headers, IBM
  Plex Sans for UI text, IBM Plex Mono for every number — so columns of
  amounts and dates actually align (`font-variant-numeric: tabular-nums`).
- **Signature element**: a thin gold rule down the left margin, referencing
  ruled ledger paper directly, plus circular "stamp" badges in the
  compliance heatmap instead of plain colored dots (`StatusStamp.tsx`).
- Every card has its own loading skeleton and empty state — no card ever
  shows nothing while data is missing or still loading.

To adjust the palette or fonts, edit `src/styles/tokens.css` — every
component pulls colors and type from CSS variables, nothing is hardcoded
per-component.

## Getting started

```bash
npm install
supabase login
supabase link --project-ref <your-project-ref>
supabase db push          # applies migrations 0001–0006
supabase db seed          # optional: loads supabase/seed.sql for local dev
supabase functions deploy invite-staff
supabase functions deploy request-pairing-code
supabase functions deploy agent-pair
supabase functions deploy ingest-tally-sync
npm run db:types          # regenerates src/lib/database.types.ts from the live schema
cp .env.example .env      # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

### Auth setup

1. In the Supabase dashboard, set **Authentication → URL Configuration →
   Site URL** to your app's origin, and add `<origin>/accept-invite` to
   **Redirect URLs** — this is where the invite email's link lands people
   to set their password (`src/pages/AcceptInvite.tsx`).
2. To create the first user (before anyone exists to send an invite from
   the Team page), either use the Supabase dashboard's "Invite user" action
   directly, or call `invite-staff` once manually with a service-role
   token. Give that first person `role: 'admin'` so they can invite
   everyone else from the app.
3. `enable_signup = false` in `supabase/config.toml` blocks self-serve
   `/signup` — it does not affect `auth.admin.inviteUserByEmail`, which is
   how every account in this app gets created.

For fully local development instead of a hosted project:
```bash
supabase start            # spins up local Postgres/Auth/Studio via Docker
supabase db reset         # applies migrations + seed against the local stack
```

## Schema notes

- **Multi-tenancy**: every tenant-scoped table carries `firm_id`. RLS policies
  derive the caller's `firm_id` from `staff.auth_user_id = auth.uid()` —
  link a `staff` row to a Supabase Auth user via `auth_user_id` when
  onboarding a team member.
- **Resource-scoped RBAC**: Admin/Partner/Audit Manager see all clients in
  the firm; Article Assistants only see clients in `client_staff_assignments`.
  This is enforced in Postgres (`can_access_client()`), not just in the UI.
- **Credentials vault**: encrypted client-side or via a Postgres extension
  before write — the schema stores ciphertext columns (`*_encrypted`) plus
  a `access_scope` role allowlist per row. Wire up actual encryption
  (e.g. `pgsodium` or app-layer AES-256 with a KMS-managed key) before
  storing real portal credentials; the current migration only enforces the
  *shape*, not the encryption itself.
- **Tally write-back**: `tally_write_back_jobs.status` only ever moves to
  `confirmed` from a server-side call authenticated as the Sync Agent
  (service role), never from client code — matches the "never auto-post"
  constraint in the spec. The included `approveWriteBackJob()` helper only
  handles the human-approval step, not the post-to-Tally confirmation.
- **Reconciliation delta**: `reconciliation_records.delta` is a generated
  column (`tally_value - portal_value`), so it can't drift from the two
  source values.

- **Outstanding balance**: derived from `tally_ledgers` rows whose
  `ledger_group` matches `%debtor%`, summed per client with `dr` balances
  positive and `cr` negative. This is a heuristic on however a given Tally
  company happens to name its debtor ledger group — worth revisiting once
  real client data shows the naming patterns in practice.
- **Client Detail data loading**: `getClientDetail()` fires its six
  underlying queries with `Promise.all` rather than sequentially — each
  card on the page depends on a different table, so there's no reason to
  wait on one before starting the next.

- **Bulk resolve simplification**: the spec's §7.3 bulk "mark resolved" is
  gated on every selected row already carrying its own note. The current
  `bulkResolveReconciliationRecords()` instead takes one shared note applied
  to the whole batch — simpler to use, but loses per-row nuance. Worth
  revisiting if batches end up needing genuinely different resolution
  reasons per row.
- **Escalate**: `escalateReconciliationRecord()` just flips status to
  `escalated`; it doesn't yet create the client-portal document-request task
  the spec describes (§7.2) — that depends on the Client Portal surface,
  which isn't built.

- **Auth linkage**: `staff.auth_user_id` is set by a Postgres trigger on
  `auth.users` insert (migration 0004), not by any client code — it fires
  whichever order the two rows show up in (staff row created first via the
  Team page, or an auth account somehow existing first). Nothing in the
  app ever calls `.update({ auth_user_id })` directly.
- **invite-staff Edge Function**: the only place the service-role key is
  used. It re-derives the caller's identity and role from their own JWT
  server-side before doing anything — it never trusts a `role` or
  `firm_id` passed in the request body, so a client can't invite someone
  into a different firm or grant themselves admin by editing the request.

- **Ingestion pipeline auth**: three-step chain, each step only as
  privileged as it needs to be. `request-pairing-code` needs a logged-in
  Admin/Partner/Audit Manager (checks their staff row + firm before issuing
  a code). `agent-pair` needs only a valid, unused, unexpired pairing code
  — no user session, since the agent isn't a user. `ingest-tally-sync`
  needs the bearer token `agent-pair` returned, hashed and checked against
  `tally_agent_tokens`; the raw token is shown to the agent exactly once
  and only its SHA-256 hash is ever stored.
- **Ingestion is synchronous, not queued**: `ingest-tally-sync` upserts
  directly rather than enqueueing a background job, which is a reasonable
  simplification at the payload sizes a single Tally company produces. The
  spec's Queue Worker step (§3.3) becomes worth adding — e.g. via the
  `pgmq` Postgres extension — if sync volume grows enough to need real
  async retry/backoff; the agent-facing HTTP contract wouldn't need to
  change to add that later.
- **What's NOT built**: the actual Sync Agent binary (spec §8, a separate
  Windows-service codebase) that would call these functions, and the
  GSTR-2B-vs-Tally reconciliation matching logic itself (spec §4.1) — that
  needs GST portal API access via the (still-unencrypted) credentials
  vault, which is a materially bigger feature on its own.

- **Document Vault storage RLS**: the `client-documents` bucket has no
  per-category access split — anyone who can access the client can see
  every document category, including PAN/Aadhaar. The spec's Credential
  Vault has a stricter `access_scope` role allowlist per row (§2.4); the
  Document Vault doesn't have an equivalent yet. Worth adding if sensitive-ID
  documents need to be restricted to a narrower role than general client
  access.
- **Storage path → client_id cast**: `storage_path_client_id()` wraps the
  `::uuid` cast in an exception handler so a malformed object path can't
  break RLS evaluation for every other row in the bucket — Postgres
  doesn't guarantee policy conditions short-circuit in the order written.
- **No document versioning yet**: every upload inserts a new `documents`
  row with `version: 1` rather than incrementing an existing document's
  version — re-uploading a file with the same name creates a second
  independent row rather than a new version of the first.
- **Credential Vault tab is read-only by design, not by omission**: it
  shows which portals have credentials on file (portal type, last
  verified, which roles can see it) but has no add/edit form. Building
  one would mean either sending real secrets through the browser to a
  ciphertext column with no real encryption behind it yet, or building a
  fake form that looks secure and isn't — both worse than not having the
  form. Add it once the KMS-backed encryption from the spec (§6) actually
  exists.

## Next steps
The Activity tab is the one remaining disabled tab on Client Detail — it
needs a real audit-log table and triggers to populate it before it's
worth building, rather than a page that fakes an activity feed. Beyond
that, the two largest unbuilt pieces are the actual Sync Agent (a separate
codebase per spec §8) and the GSTR-2B reconciliation matching logic (§4.1), which
depends on decrypting and calling out to the GST portal via the credentials vault.
