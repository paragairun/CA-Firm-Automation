-- Auto-derive firm_id from client_id on insert for every client-scoped table.
-- This closes a real gap: app code that inserts via client_id shouldn't also
-- have to separately supply firm_id (and get it wrong), and this makes a
-- firm_id/client_id tenant mismatch structurally impossible rather than
-- relying on every call site to pass the right value.

create or replace function set_firm_id_from_client()
returns trigger as $$
begin
  if new.firm_id is null then
    select firm_id into new.firm_id from clients where id = new.client_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

do $$
declare
  t text;
begin
  foreach t in array array[
    'documents', 'credentials_vault', 'services', 'filings', 'tasks',
    'time_entries', 'invoices', 'tally_sync_agents', 'tally_sync_configs',
    'reconciliation_records', 'tally_write_back_jobs'
  ]
  loop
    execute format(
      'create trigger trg_%I_set_firm_id before insert on %I
       for each row execute function set_firm_id_from_client();',
      t, t
    );
  end loop;
end $$;
