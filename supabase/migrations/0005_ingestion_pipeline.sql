-- Tally ingestion pipeline: pairing codes (one-time, used to bootstrap a
-- new Sync Agent installation) and agent bearer tokens (long-lived,
-- rotatable, revocable without re-pairing). Neither table is ever read
-- directly by client code — both are service-role only, used exclusively
-- by the agent-pairing and ingestion Edge Functions.

create table tally_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  code text not null unique, -- short human-enterable code shown in the Tally Sync panel
  created_by uuid references staff(id),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_pairing_codes_lookup on tally_pairing_codes(code) where used_at is null;

alter table tally_pairing_codes enable row level security;
-- No client-facing select/insert policy: pairing codes are only ever
-- created and consumed via service-role Edge Functions. Admin/Partner see
-- the *result* (a fresh agent row) through the normal tally_sync_agents
-- policies already in place, not this table directly.

create table tally_agent_tokens (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references tally_sync_agents(id) on delete cascade,
  token_hash text not null unique, -- SHA-256 hex digest; the raw token is shown to the agent exactly once, at pairing
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index idx_agent_tokens_lookup on tally_agent_tokens(token_hash) where revoked_at is null;
create index idx_agent_tokens_agent on tally_agent_tokens(agent_id);

alter table tally_agent_tokens enable row level security;
-- Same reasoning as tally_pairing_codes: service-role only.
