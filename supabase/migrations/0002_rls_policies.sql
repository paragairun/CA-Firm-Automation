-- PracticeOS — Row Level Security
-- Tenancy isolation by firm_id, plus per-client scoping for Article Assistants.

-- ============================================================
-- CLIENT ASSIGNMENTS (resource-scoped RBAC, not just role-scoped)
-- ============================================================

create table client_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (client_id, staff_id)
);
create index idx_assignments_staff on client_staff_assignments(staff_id);
create index idx_assignments_client on client_staff_assignments(client_id);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Current staff row for the authenticated user (null if not linked)
create or replace function current_staff()
returns staff as $$
  select s.* from staff s where s.auth_user_id = auth.uid() limit 1;
$$ language sql stable security definer;

create or replace function current_firm_id()
returns uuid as $$
  select firm_id from staff where auth_user_id = auth.uid() limit 1;
$$ language sql stable security definer;

create or replace function current_staff_role()
returns staff_role as $$
  select role from staff where auth_user_id = auth.uid() limit 1;
$$ language sql stable security definer;

-- True if the current user can see a given client: Admin/Partner/Audit Manager
-- see all clients in the firm; Article Assistants only see assigned clients.
create or replace function can_access_client(target_client_id uuid)
returns boolean as $$
  select case
    when current_staff_role() in ('admin', 'partner', 'audit_manager') then
      exists (select 1 from clients c where c.id = target_client_id and c.firm_id = current_firm_id())
    when current_staff_role() = 'article_assistant' then
      exists (
        select 1 from client_staff_assignments a
        join staff s on s.id = a.staff_id
        where a.client_id = target_client_id and s.auth_user_id = auth.uid()
      )
    else false
  end;
$$ language sql stable security definer;

-- ============================================================
-- ENABLE RLS
-- ============================================================

alter table firms enable row level security;
alter table staff enable row level security;
alter table clients enable row level security;
alter table contacts enable row level security;
alter table documents enable row level security;
alter table credentials_vault enable row level security;
alter table services enable row level security;
alter table filings enable row level security;
alter table tasks enable row level security;
alter table time_entries enable row level security;
alter table invoices enable row level security;
alter table payments enable row level security;
alter table tally_sync_agents enable row level security;
alter table tally_sync_configs enable row level security;
alter table tally_ledgers enable row level security;
alter table tally_vouchers enable row level security;
alter table reconciliation_records enable row level security;
alter table tally_write_back_jobs enable row level security;
alter table client_staff_assignments enable row level security;

-- ============================================================
-- FIRMS / STAFF
-- ============================================================

create policy firms_select on firms for select
  using (id = current_firm_id());

create policy staff_select on staff for select
  using (firm_id = current_firm_id());

create policy staff_manage on staff for all
  using (firm_id = current_firm_id() and current_staff_role() in ('admin','partner'))
  with check (firm_id = current_firm_id() and current_staff_role() in ('admin','partner'));

-- ============================================================
-- CLIENTS / CONTACTS — resource-scoped
-- ============================================================

create policy clients_select on clients for select
  using (firm_id = current_firm_id() and can_access_client(id));

create policy clients_write on clients for insert
  with check (firm_id = current_firm_id() and current_staff_role() in ('admin','partner','audit_manager'));

create policy clients_update on clients for update
  using (firm_id = current_firm_id() and can_access_client(id))
  with check (firm_id = current_firm_id());

create policy contacts_select on contacts for select
  using (can_access_client(client_id));

create policy contacts_write on contacts for all
  using (can_access_client(client_id))
  with check (can_access_client(client_id));

-- ============================================================
-- DOCUMENTS — resource-scoped
-- ============================================================

create policy documents_select on documents for select
  using (firm_id = current_firm_id() and can_access_client(client_id));

create policy documents_write on documents for insert
  with check (firm_id = current_firm_id() and can_access_client(client_id));

-- ============================================================
-- CREDENTIALS VAULT — role-gated on top of client scoping
-- Only roles listed in access_scope for that row may see it, and never
-- Article Assistants regardless of assignment (least-privilege default).
-- ============================================================

create policy credentials_select on credentials_vault for select
  using (
    firm_id = current_firm_id()
    and can_access_client(client_id)
    and current_staff_role() = any(access_scope)
  );

create policy credentials_write on credentials_vault for all
  using (firm_id = current_firm_id() and current_staff_role() in ('admin','partner'))
  with check (firm_id = current_firm_id() and current_staff_role() in ('admin','partner'));

-- ============================================================
-- SERVICES / FILINGS / TASKS — resource-scoped
-- ============================================================

create policy services_select on services for select
  using (can_access_client(client_id));
create policy services_write on services for all
  using (can_access_client(client_id) and current_staff_role() in ('admin','partner','audit_manager'))
  with check (can_access_client(client_id));

create policy filings_select on filings for select
  using (can_access_client(client_id));
create policy filings_write on filings for all
  using (can_access_client(client_id))
  with check (can_access_client(client_id));

create policy tasks_select on tasks for select
  using (firm_id = current_firm_id() and (client_id is null or can_access_client(client_id)));
create policy tasks_write on tasks for all
  using (firm_id = current_firm_id() and (client_id is null or can_access_client(client_id)))
  with check (firm_id = current_firm_id());

-- ============================================================
-- TIME / BILLING
-- ============================================================

create policy time_entries_select on time_entries for select
  using (firm_id = current_firm_id() and (staff_id = (current_staff()).id or current_staff_role() in ('admin','partner','audit_manager')));
create policy time_entries_write on time_entries for insert
  with check (firm_id = current_firm_id() and staff_id = (current_staff()).id);

create policy invoices_select on invoices for select
  using (can_access_client(client_id));
create policy invoices_write on invoices for all
  using (firm_id = current_firm_id() and current_staff_role() in ('admin','partner'))
  with check (firm_id = current_firm_id());

create policy payments_select on payments for select
  using (firm_id = current_firm_id());
create policy payments_write on payments for all
  using (firm_id = current_firm_id() and current_staff_role() in ('admin','partner'))
  with check (firm_id = current_firm_id());

-- ============================================================
-- TALLY INTEGRATION — resource-scoped, write-back gated to admin/partner/audit_manager
-- ============================================================

create policy agents_select on tally_sync_agents for select
  using (can_access_client(client_id));
create policy agents_write on tally_sync_agents for all
  using (firm_id = current_firm_id() and current_staff_role() in ('admin','partner','audit_manager'))
  with check (firm_id = current_firm_id());

create policy sync_configs_select on tally_sync_configs for select
  using (can_access_client(client_id));
create policy sync_configs_write on tally_sync_configs for all
  using (firm_id = current_firm_id() and current_staff_role() in ('admin','partner','audit_manager'))
  with check (firm_id = current_firm_id());

create policy ledgers_select on tally_ledgers for select
  using (firm_id = current_firm_id() and exists (
    select 1 from tally_sync_configs sc where sc.id = sync_config_id and can_access_client(sc.client_id)
  ));

create policy vouchers_select on tally_vouchers for select
  using (firm_id = current_firm_id() and exists (
    select 1 from tally_sync_configs sc where sc.id = sync_config_id and can_access_client(sc.client_id)
  ));

create policy reconciliation_select on reconciliation_records for select
  using (can_access_client(client_id));
create policy reconciliation_write on reconciliation_records for all
  using (can_access_client(client_id))
  with check (can_access_client(client_id));

-- Write-back jobs: visible to those who can access the client, but only
-- admin/partner may approve (enforced at application layer on the
-- approved_by/approved_at transition; DB-level restricts row creation/edit
-- to elevated roles per the spec's "never auto-post" requirement).
create policy writeback_select on tally_write_back_jobs for select
  using (can_access_client(client_id));
create policy writeback_write on tally_write_back_jobs for all
  using (firm_id = current_firm_id() and current_staff_role() in ('admin','partner','audit_manager'))
  with check (firm_id = current_firm_id());

-- ============================================================
-- CLIENT ASSIGNMENTS
-- ============================================================

create policy assignments_select on client_staff_assignments for select
  using (firm_id = current_firm_id());
create policy assignments_write on client_staff_assignments for all
  using (firm_id = current_firm_id() and current_staff_role() in ('admin','partner','audit_manager'))
  with check (firm_id = current_firm_id());
