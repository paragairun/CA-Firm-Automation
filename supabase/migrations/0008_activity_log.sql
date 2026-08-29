-- Activity log for the Client Detail "Activity" tab. Deliberately scoped,
-- not a comprehensive audit trail: it covers filing status changes, task
-- status changes, document uploads, and reconciliation resolutions —
-- the events a CA actually wants a timeline of. It does NOT cover every
-- write to every table (credential vault access already has its own
-- logging requirement in the spec, §6, separate from this).
--
-- Rows are trigger-written only. There is no INSERT policy for
-- `authenticated`, so client code cannot write fabricated activity —
-- the trigger functions are SECURITY DEFINER specifically so they can
-- insert despite that, while everything else about them stays narrow
-- (each one logs exactly one kind of event, nothing else).

create table activity_log (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade, -- null = firm-wide event
  actor_id uuid references staff(id),
  action text not null,
  summary text not null,
  created_at timestamptz not null default now()
);
create index idx_activity_log_client on activity_log(client_id, created_at desc);
create index idx_activity_log_firm on activity_log(firm_id, created_at desc);

alter table activity_log enable row level security;

create policy activity_log_select on activity_log for select
  using (
    firm_id = current_firm_id()
    and (client_id is null or can_access_client(client_id))
  );
-- No insert/update/delete policy for `authenticated` — see header comment.

-- ============================================================
-- Trigger functions — one per event kind, each SECURITY DEFINER only to
-- write to activity_log, nothing else.
-- ============================================================

create or replace function log_filing_status_change()
returns trigger as $$
begin
  if new.status is distinct from old.status then
    insert into activity_log (firm_id, client_id, actor_id, action, summary)
    values (
      new.firm_id, new.client_id, (current_staff()).id,
      'filing_status_changed',
      format('%s (%s) moved from %s to %s', new.filing_type, new.period, old.status, new.status)
    );
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_log_filing_status_change
  after update on filings
  for each row execute function log_filing_status_change();

create or replace function log_task_status_change()
returns trigger as $$
begin
  if new.status is distinct from old.status and new.client_id is not null then
    insert into activity_log (firm_id, client_id, actor_id, action, summary)
    values (
      new.firm_id, new.client_id, (current_staff()).id,
      'task_status_changed',
      format('Task "%s" moved from %s to %s', new.title, old.status, new.status)
    );
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_log_task_status_change
  after update on tasks
  for each row execute function log_task_status_change();

create or replace function log_document_uploaded()
returns trigger as $$
begin
  insert into activity_log (firm_id, client_id, actor_id, action, summary)
  values (
    new.firm_id, new.client_id, (current_staff()).id,
    'document_uploaded',
    format('Uploaded %s (%s)', new.storage_path, new.category)
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_log_document_uploaded
  after insert on documents
  for each row execute function log_document_uploaded();

create or replace function log_reconciliation_resolution()
returns trigger as $$
begin
  if new.status is distinct from old.status and new.status in ('resolved', 'escalated') then
    insert into activity_log (firm_id, client_id, actor_id, action, summary)
    values (
      new.firm_id, new.client_id, (current_staff()).id,
      'reconciliation_' || new.status,
      format('Reconciliation record for %s (%s) marked %s', coalesce(new.invoice_number, 'unknown invoice'), new.period, new.status)
    );
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_log_reconciliation_resolution
  after update on reconciliation_records
  for each row execute function log_reconciliation_resolution();
