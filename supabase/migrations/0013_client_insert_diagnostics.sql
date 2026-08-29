-- Two things:
-- 1. Make the firm_id trigger fail LOUDLY with a specific message if it
--    can't resolve firm_id, instead of silently leaving it null and
--    letting RLS produce a generic, unhelpful 42501 further downstream.
-- 2. A SECURITY INVOKER test RPC that inserts a client directly — same
--    trigger, same RLS policies as the app's real insert, but bypassing
--    PostgREST's insert+RETURNING mechanics entirely. If this succeeds
--    where the app's supabase-js call fails, the problem is specific to
--    the REST layer, not the underlying policy/trigger logic.

create or replace function set_firm_id_from_creator()
returns trigger as $$
declare
  v_firm_id uuid;
begin
  if new.firm_id is null then
    select firm_id into v_firm_id from staff where auth_user_id = auth.uid() limit 1;
    if v_firm_id is null then
      raise exception 'set_firm_id_from_creator: no staff row found for auth.uid()=%', auth.uid();
    end if;
    new.firm_id := v_firm_id;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function test_create_client(p_entity_type entity_type, p_legal_name text)
returns clients as $$
declare
  v_row clients;
begin
  insert into clients (entity_type, legal_name) values (p_entity_type, p_legal_name) returning * into v_row;
  return v_row;
end;
$$ language plpgsql security invoker;

grant execute on function test_create_client(entity_type, text) to authenticated;
