# PracticeOS

CA/tax-firm practice management SaaS with native Tally Prime integration.
Full functional spec: see `ca-saas-platform-spec-v1.1.md` (delivered separately).

## Stack
React + TypeScript (Vite) frontend, Supabase (Postgres + Auth + Storage +
Edge Functions) backend, plus a separate Node.js/TypeScript package
(`sync-agent/`) that runs on a client's machine — see its own README.

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
- [x] GSTR-2B reconciliation matching (spec §4.1) — `gstr2b_line_items` staging table + `run_gstr2b_reconciliation()` set-based matching function, JSON import UI on the Reconciliation Detail page. NOT a live GST portal integration — see design notes below for why and what that means for the matching accuracy.
- [x] Activity tab on Client Detail — scoped `activity_log` table populated by triggers on filing/task status changes, document uploads, and reconciliation resolutions (not a full audit trail — see design notes)
- [x] Credential Vault write/reveal — `save-credential` and `reveal-credential` Edge Functions encrypt/decrypt with AES-256-GCM server-side; add form + gated, logged, auto-hiding reveal UI (spec §6, with a real caveat — see design notes)
- [x] Sync Agent (spec §8) — `sync-agent/` (separate Node.js/TypeScript package): pairing CLI, Tally XML client, local encrypted-at-rest config, file-based persistent queue with backoff, cloud uplink with heartbeat. XML request/response parsing verified against a hand-built mock Tally server (not a real instance — see `sync-agent/README.md` for exactly what that does and doesn't confirm). New `agent-config` Edge Function so the agent can pick up server-side company binding without re-pairing.

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
supabase db push          # applies migrations 0001–0016
supabase db seed          # optional: loads supabase/seed.sql for local dev
supabase functions deploy invite-staff
supabase functions deploy request-pairing-code
supabase functions deploy agent-pair
supabase functions deploy agent-config
supabase functions deploy ingest-tally-sync
supabase functions deploy save-credential
supabase functions deploy reveal-credential
supabase secrets set CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32)
supabase secrets set SITE_URL=https://<your-username>.github.io/<your-repo>/
npm run db:types          # regenerates src/lib/database.types.ts from the live schema
cp .env.example .env      # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

### Continuous deployment

`.github/workflows/deploy-supabase.yml` automates the `db push` and
`functions deploy` steps above — it runs on every push to `main` that
touches `supabase/migrations/**` or `supabase/functions/**`, or on demand
via the Actions tab. Requires two more repository secrets beyond the two
the frontend deploy workflow already needs:

- **`SUPABASE_ACCESS_TOKEN`** — a personal access token from
  [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens),
  not the anon key or service role key.
- **`SUPABASE_DB_PASSWORD`** — the Postgres database password set when
  the project was created (Dashboard → Project Settings → Database if
  you need to look it up or reset it).

The two Edge Function secrets (`CREDENTIAL_ENCRYPTION_KEY`, `SITE_URL`)
are deliberately **not** part of this workflow — see the comment in
`deploy-supabase.yml` for why. Those stay a manual, one-time
`supabase secrets set` from the block above.


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

- **A table's own RLS policies should never call a helper that
  re-queries that same table**, if that helper might run during an
  `INSERT ... RETURNING`. This bit us for real: `clients_select`
  originally called the generic `can_access_client()` helper, which —
  for Admin/Partner/Audit Manager — re-queries `clients` itself to
  confirm a row's `firm_id`. During `INSERT ... RETURNING`, Postgres
  implicitly needs the new row to satisfy the table's `SELECT` policy,
  and a self-referential subquery against the exact table being
  inserted into isn't reliably able to see that not-yet-committed row at
  that point — even though the identical check against an
  already-committed row works perfectly fine. Symptom: every insert
  failed with a generic `42501` RLS violation, while the row could be
  proven correct by every other measure (right `firm_id`, right role,
  policy re-checked and confirmed correct). Fixed in
  `0015_fix_clients_self_reference.sql` by inlining `clients_select`/
  `clients_update`'s logic directly instead of routing through
  `can_access_client()` — no self-reference, no bug.
  `can_access_client()` itself is still correct and necessary for every
  *other* table (documents, filings, tasks, ...) that references a
  `client_id`, since those check a different, already-committed `clients`
  row, not the row being written in the current statement — the failure
  mode is specific to a table's policy referencing itself.

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
- **Every Edge Function handles CORS preflight explicitly**
  (`_shared/cors.ts`). This was a real bug, not preemptive caution: a
  browser sends an `OPTIONS` preflight before any cross-origin POST
  carrying an `Authorization` header — and that preflight never includes
  Authorization (browsers strip it by design). Without explicit
  handling, the platform's own JWT check rejected the *preflight* with
  `UNAUTHORIZED_NO_AUTH_HEADER`, and the browser never got to send the
  real, authenticated request at all. Symptom looked exactly like a
  missing deploy or a broken function, when the function itself was
  fine — the request never arrived. Every function now checks
  `handleCorsPreflight(req)` first and merges `corsHeaders` into every
  response, success or error.
- **invite-staff Edge Function**: the only place the service-role key is
  used. It re-derives the caller's identity and role from their own JWT
  server-side before doing anything — it never trusts a `role` or
  `firm_id` passed in the request body, so a client can't invite someone
  into a different firm or grant themselves admin by editing the request.
- **Invite emails redirect to `/accept-invite`, not the app root.** This
  needs an explicit `redirectTo` because Supabase Auth's default behavior
  — used automatically if someone invites a user via the Supabase
  Dashboard's own "Invite user" button instead of the app's Team page —
  redirects to the Site URL setting, which signs the person straight into
  a session at the app root *without ever routing them through a page
  that sets a password*. `invite-staff` needs a `SITE_URL` Edge Function
  secret to build the correct redirect, and fails loudly (500) rather
  than silently falling back to the Dashboard's default if that secret
  isn't set. The same reasoning is why `Login.tsx`'s password-reset flow
  passes its own explicit `redirectTo` too.

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
- **Credential Vault is write-capable, with a specific caveat.**
  `save-credential` and `reveal-credential` Edge Functions encrypt/decrypt
  with AES-256-GCM using a **single shared symmetric key** held as an Edge
  Function secret (`CREDENTIAL_ENCRYPTION_KEY`) — see
  `supabase/functions/_shared/crypto.ts`. That's a real step up from
  plaintext, but it is **not** the spec's full picture (§6: "keys managed
  via KMS with per-tenant key separation"). One key protects every firm's
  credentials on the deployment; a leaked key exposes all of them at once,
  not just one firm's. A genuine production upgrade moves key custody to
  a real KMS (AWS KMS, GCP KMS, or Supabase Vault) with one key per firm.
  Generate the current key with `openssl rand -base64 32` and set it with
  `supabase secrets set CREDENTIAL_ENCRYPTION_KEY=<value>`.
- **Reveal is gated, logged, and time-boxed.** `reveal-credential` checks
  the caller's role against that row's `access_scope`, confirms the
  credential belongs to the caller's own firm (checked explicitly — the
  service-role client bypasses RLS, so this can't rely on the database to
  enforce it), and logs every successful reveal to `activity_log`. The
  UI auto-hides a revealed credential after 30 seconds and never persists
  it beyond the component's in-memory state.

- **GSTR-2B matching is NOT a live portal integration.** Calling the real
  GSTN API requires registering as a GSP/ASP and credentials this project
  doesn't have — that's a separate, larger effort regardless of how the
  credentials vault is secured. Instead, `gstr2b_line_items` is a staging
  table any import path can populate; right now that's a manual JSON
  upload (`ReconciliationDetail.tsx`, "Import GSTR-2B") in a shape this
  project defines itself — **not** the government portal's actual export
  format. A real deployment needs an adapter that maps the portal's raw
  JSON/Excel export into this shape before upload.
- **Matching now uses GSTIN when it's available, invoice number always.**
  `tally_ledgers.gstin` (added in `0009_gstin_matching.sql`) is populated
  from the Sync Agent's ledger export and joined from voucher → ledger by
  party name. When both sides have a GSTIN and they disagree, that pair
  is downgraded from `matched` to `mismatch` even if the amounts agree —
  a real discrepancy, not just a rounding difference. When a voucher's
  party ledger hasn't been GSTIN-tagged yet (e.g. right after this
  migration runs, before ledgers re-sync), it still matches on invoice
  number alone rather than being excluded. This is closer to the spec's
  algorithm than the original invoice-number-only version, but still not
  a strict (GSTIN, invoice_number) join — see the migration's comments.
- **Re-running reconciliation preserves resolved/escalated rows.** The
  matching function only deletes and regenerates rows still in an open
  state (`matched`/`mismatch`/`missing_in_tally`/`missing_in_portal`/
  `under_review`) for that client+period — a CA's completed resolution
  work isn't wiped out by a re-import.

- **Activity log now covers seven event kinds**, not four: the original
  filing/task status changes, document uploads, and reconciliation
  resolutions, plus (as of `0010_activity_log_extended.sql`) task
  creation, filing creation, and Tally write-back job status changes.
  Credential save/reveal events are logged separately, directly by their
  Edge Functions. Still deliberately scoped, not a comprehensive audit
  trail of every write to every table — that line hasn't moved, only how
  much sits on the "covered" side of it.

- **Sync Agent is a separate Node.js package (`sync-agent/`), not part of
  the web app's build or deploy.** Its request-building and response-
  parsing logic (`tally-client.ts`) was verified against a hand-built mock
  Tally server in this repo, confirming the code itself runs correctly —
  it was **not** verified against a real Tally Prime installation, since
  none was available. The file's header comment flags exactly which
  assumptions (XML tag names, balance-sign convention, and now the GSTIN
  tag name too) are most likely to need adjustment once it's run against
  actual Tally output. Two gaps from the first pass are now closed: the
  Client Detail Tally Sync tab has a real "bind this agent to a Tally
  company" form (`ClientTallySync.tsx`) instead of requiring a manual DB
  row, and `sync-agent/scripts/install-windows-service.js` actually
  registers the agent as a Windows service via `node-windows` instead of
  only describing the steps in prose. A status CLI (`npm run status`)
  substitutes for the spec's system-tray companion app, which needs
  native GUI bindings this package doesn't take on.

## Current state
Every component named in the original spec now has a working
implementation somewhere in this repo, including the two structural gaps
(company-binding UI, Windows-service registration) called out after the
first full pass. What's left is a smaller, more specific set of caveats
than before — worth reading before treating any of them as
production-ready as-is:

- **Not attempted, and said so rather than faked**: per-firm KMS key
  separation for the Credential Vault. This needs real cloud KMS
  infrastructure (AWS KMS, GCP KMS, or Supabase Vault) to implement
  meaningfully — building "KMS integration" code with no actual KMS to
  test it against would just be more unverified code carrying a security
  claim, the exact pattern this project has tried to avoid throughout.
  The single-shared-key approach in place is a real improvement over
  plaintext and is clearly labeled as short of the spec's target.
- GSTR-2B's manual-JSON-import staging step in place of a real GSP/portal
  integration — matching itself now uses GSTIN when available (see
  above), but the data still arrives by hand, not from a live API.
- The Sync Agent's Tally XML parsing, unverified against a real instance
  — the single biggest remaining unknown, since it's the one piece
  nothing in this environment could actually test end-to-end.
- The Activity log's intentionally scoped (not comprehensive) coverage.

None of these are silent gaps — each is flagged in code comments and in
this README at the point where it matters, so picking any one up next
means reading one paragraph, not re-deriving what was simplified and why.

