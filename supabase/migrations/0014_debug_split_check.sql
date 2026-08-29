create or replace function debug_client_insert_context()
returns table(
  auth_uid uuid,
  resolved_staff_role staff_role,
  resolved_firm_id uuid,
  trigger_logic_firm_id uuid,
  firm_id_check_passes boolean,
  role_check_passes boolean,
  combined_check_passes boolean,
  matching_staff_rows int,
  firm_row_exists boolean
) as $$
declare
  v_trigger_firm_id uuid;
begin
  -- Exact same query set_firm_id_from_creator() runs, isolated here so
  -- we can compare it directly against current_firm_id() without an
  -- actual INSERT in the way.
  select firm_id into v_trigger_firm_id from staff where staff.auth_user_id = auth.uid() limit 1;

  return query
  select
    auth.uid(),
    current_staff_role(),
    current_firm_id(),
    v_trigger_firm_id,
    (v_trigger_firm_id = current_firm_id()),
    (current_staff_role() = any (array['admin'::staff_role, 'partner'::staff_role, 'audit_manager'::staff_role])),
    (v_trigger_firm_id = current_firm_id() and current_staff_role() = any (array['admin'::staff_role, 'partner'::staff_role, 'audit_manager'::staff_role])),
    (select count(*)::int from staff where staff.auth_user_id = auth.uid()),
    exists(select 1 from firms where firms.id = current_firm_id());
end;
$$ language plpgsql security invoker;

grant execute on function debug_client_insert_context() to authenticated;
