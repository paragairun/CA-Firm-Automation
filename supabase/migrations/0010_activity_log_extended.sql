-- Extends the activity log (0008) with three more event kinds worth a CA
-- seeing on a client's timeline. Still deliberately scoped, not
-- comprehensive — see 0008's header comment for that reasoning, which
-- applies equally here.

create or replace function log_task_created()
returns trigger as $$
begin
  if new.client_id is not null then
    insert into activity_log (firm_id, client_id, actor_id, action, summary)
    values (new.firm_id, new.client_id, (current_staff()).id, 'task_created', format('Task created: "%s"', new.title));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_log_task_created
  after insert on tasks
  for each row execute function log_task_created();

create or replace function log_filing_created()
returns trigger as $$
begin
  insert into activity_log (firm_id, client_id, actor_id, action, summary)
  values (new.firm_id, new.client_id, (current_staff()).id, 'filing_created', format('%s (%s) added, due %s', new.filing_type, new.period, new.due_date));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_log_filing_created
  after insert on filings
  for each row execute function log_filing_created();

create or replace function log_writeback_status_change()
returns trigger as $$
begin
  if new.status is distinct from old.status then
    insert into activity_log (firm_id, client_id, actor_id, action, summary)
    values (
      new.firm_id, new.client_id, (current_staff()).id,
      'writeback_' || new.status,
      format('Tally write-back job moved from %s to %s', old.status, new.status)
    );
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_log_writeback_status_change
  after update on tally_write_back_jobs
  for each row execute function log_writeback_status_change();
