-- Temporary diagnostic function for tracking down the clients-insert 403.
-- Safe to leave in place (it only reveals the calling user's own staff
-- linkage, nothing about other firms), but intended to be dropped once
-- the underlying issue is found — see README if this is still here later.

create or replace function debug_client_insert_context()
returns table(
  auth_uid uuid,
  resolved_staff_role staff_role,
  resolved_firm_id uuid,
  matching_staff_rows int,
  firm_row_exists boolean
) as $$
begin
  return query
  select
    auth.uid(),
    current_staff_role(),
    current_firm_id(),
    (select count(*)::int from staff where staff.auth_user_id = auth.uid()),
    exists(select 1 from firms where firms.id = current_firm_id());
end;
$$ language plpgsql security invoker;

grant execute on function debug_client_insert_context() to authenticated;
