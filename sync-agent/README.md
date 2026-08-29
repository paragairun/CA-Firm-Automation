# PracticeOS Sync Agent

Local Node.js agent that bridges an on-premise Tally Prime instance to
PracticeOS, per the functional spec's §8 (Sync Agent architecture) and §3
(Ingestion Pipeline). **This is a separate codebase from the web app** —
it runs on the client's machine, not deployed alongside `practiceos/`.

## What's verified vs. what isn't

Tested in this repo, with a mock Tally XML server standing in for a real
instance (none was available to test against):
- ✅ XML request building and response parsing (`tally-client.ts`) — the
  ledger/voucher mapping logic runs correctly against a hand-built mock
  response matching commonly-documented Tally export conventions.
- ✅ Local encryption at rest — the agent token is verifiably never
  written to disk in plaintext (`crypto.ts` + `config.ts`).
- ✅ The persistent job queue survives failed uploads and clears on
  success (`queue.ts`).
- ✅ TypeScript compiles clean (`npm run build`).

**Not verified — needs testing against a real Tally installation:**
- The exact XML tags Tally returns for "Trial Balance" and "Day Book"
  exports. These vary by Tally version and by whatever report definition
  is actually being exported (default reports are built for on-screen
  display, not clean machine parsing). `tally-client.ts`'s header comment
  flags exactly which functions to check first if synced data comes back
  empty or wrong. For reliable production use, the standard approach is a
  custom TDL report definition designed specifically for XML export —
  this agent currently requests Tally's default reports as a starting
  point, not a guarantee.
- Whether Tally's default HTTP gateway (port 9000) is enabled and
  reachable in your environment — it's off by default in some Tally
  Prime configurations and needs enabling in Tally's own settings.

## Known gap: company binding has no UI yet

Per spec §3.3 step 2, after an agent pairs, an Admin/Partner still needs
to bind it to a specific `tally_sync_configs` row (mapping "this agent"
to "this Tally company"). The web app doesn't have a dedicated screen for
this step yet — for now it means creating that row directly (Supabase
Studio, or a short script) with the agent's `agent_id` (printed at the
end of `npm run pair`) and the exact Tally company name. The agent polls
for this assignment every cycle via the `agent-config` Edge Function, so
once that row exists, the agent picks it up automatically — no
re-pairing needed.

## Setup

```bash
npm install
npm run build
npm run pair    # one-time: prompts for Supabase URL + pairing code (from
                 # the web app's "Connect Tally" button) + Tally endpoint
                 # + exact Tally company name
npm start        # runs the scheduler loop
```

For local development without building first: `npm run dev:pair` / `npm run dev:start` (uses `tsx`, no compile step).

## Running as a Windows service

This ships as a plain Node process — wrapping it as an actual Windows
service (so it starts on boot and restarts on crash, per spec §8.1) is
an infrastructure step on top of this code, not something this package
does itself. Two standard approaches:

- **[`node-windows`](https://www.npmjs.com/package/node-windows)** — a
  small install script that registers `dist/index.js` as a Windows
  Service. Typical usage:
  ```js
  const Service = require('node-windows').Service;
  const svc = new Service({
    name: 'PracticeOS Sync Agent',
    script: require('path').join(__dirname, 'dist', 'index.js'),
  });
  svc.on('install', () => svc.start());
  svc.install();
  ```
- **[NSSM](https://nssm.cc/)** (Non-Sucking Service Manager) — wraps any
  executable as a service without writing installer code; point it at
  your Node binary with `dist/index.js` as the argument.

Either way, the system-tray companion app described in the spec (status
icon, manual "Sync now" button) is a further native-UI layer this package
doesn't include — it would be a separate small Electron or Tauri app that
shells out to this agent's status, not something built here.

## Design notes

- **firm_id / client scoping**: the agent never sees or needs a firm_id —
  its bearer token is scoped to exactly one `client_id` at pairing time,
  and `ingest-tally-sync` re-validates that the `sync_config_id` in every
  request actually belongs to the calling agent (see the Edge Function).
- **Heartbeat**: every call to `ingest-tally-sync` — even with empty
  ledgers/vouchers — updates the agent's `last_heartbeat_at` and `status`
  server-side. `uploadPending()` calls it with empty arrays specifically
  to keep the heartbeat current when there's nothing new to sync.
- **Local queue is a JSON file, not SQLite.** The spec calls for SQLite
  specifically (§8.2); this substitutes a flat file to avoid requiring a
  native-binding build toolchain (`better-sqlite3`) just to `npm install`.
  Functionally equivalent durability at this agent's actual job volume —
  swap it if that volume ever grows enough to matter.
- **DPAPI substitute**: `crypto.ts` uses a locally-generated AES key file
  with owner-only permissions instead of Windows' actual DPAPI (spec
  §8.2), since DPAPI isn't reachable from portable Node without a native
  addon. Real Windows-service hardening should replace this module.
