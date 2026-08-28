-- Auth wiring: link a staff row to its Supabase Auth account automatically,
-- in both possible orders (auth user created first, or staff row created
-- first) instead of relying on any client code to set auth_user_id by hand.

-- Case 1: the auth user is created (via admin invite) after their staff
-- row already exists — the common case, since an admin creates the staff
-- row and sends the invite in one action.
create or replace function handle_new_auth_user()
returns trigger as $$
begin
  update staff
  set auth_user_id = new.id
  where lower(email) = lower(new.email)
    and auth_user_id is null;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_link_staff_on_auth_signup on auth.users;
create trigger trg_link_staff_on_auth_signup
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Case 2: a staff row is created for an email that already has an auth
-- account (rare, but possible if someone re-invites after an account
-- already exists) — link it immediately rather than leaving it stranded
-- until the person's next sign-in.
create or replace function link_staff_to_existing_auth_user()
returns trigger as $$
begin
  if new.auth_user_id is null then
    select id into new.auth_user_id
    from auth.users
    where lower(email) = lower(new.email)
    limit 1;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_link_staff_to_existing_auth on staff;
create trigger trg_link_staff_to_existing_auth
  before insert on staff
  for each row execute function link_staff_to_existing_auth_user();
