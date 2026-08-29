-- clients.firm_id couldn't be covered by 0003's trigger (that one derives
-- firm_id from a row's client_id — clients itself has no client_id to
-- derive from). This does the equivalent for clients specifically: derive
-- firm_id from the creating user's own staff row, so client code never
-- has to look it up and pass it explicitly.

create or replace function set_firm_id_from_creator()
returns trigger as $$
begin
  if new.firm_id is null then
    select firm_id into new.firm_id from staff where auth_user_id = auth.uid() limit 1;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_clients_set_firm_id
  before insert on clients
  for each row execute function set_firm_id_from_creator();
