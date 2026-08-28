-- PracticeOS — Core Schema
-- Multi-tenant CA practice management platform with Tally Prime integration
-- All tenant-scoped tables carry firm_id for row-level security.

create extension if not exists "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

create type entity_type as enum ('individual', 'firm', 'llp', 'pvt_ltd', 'trust');
create type client_status as enum ('active', 'dormant', 'offboarded');

create type document_category as enum (
  'pan', 'aadhaar', 'bank_statement', 'financials', 'audit_report', 'other'
);

create type portal_type as enum (
  'income_tax', 'gst', 'mca', 'udyam', 'fssai'
);

create type service_type as enum (
  'gst', 'itr', 'tax_audit', 'tds', 'udyam', 'fssai', 'mca', 'shop_establishment', 'dsc_renewal'
);
create type service_frequency as enum ('monthly', 'quarterly', 'annual', 'one_time');

create type filing_type as enum (
  'gstr1', 'gstr3b', 'gstr9', 'gstr9c',
  'itr1', 'itr2', 'itr3', 'itr4', 'itr5', 'itr6', 'itr7',
  'form_3ca_3cd', 'form_3cb_3cd',
  'tds_24q', 'tds_26q',
  'udyam_registration', 'fssai_license', 'mca_annual_filing',
  'shop_establishment', 'dsc_renewal'
);
create type filing_status as enum (
  'pending', 'docs_requested', 'in_progress', 'under_review', 'filed', 'approved'
);

create type task_status as enum (
  'pending', 'docs_requested', 'in_progress', 'under_review', 'filed', 'approved'
);
create type task_priority as enum ('low', 'medium', 'high', 'urgent');
create type task_trigger_source as enum ('manual', 'deadline', 'tally_discrepancy');

create type staff_role as enum ('admin', 'partner', 'audit_manager', 'article_assistant');

create type invoice_status as enum ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void');
create type payment_method as enum ('bank_transfer', 'upi', 'cheque', 'cash', 'card', 'other');

create type sync_frequency as enum ('realtime', 'hourly', 'daily');
create type sync_status as enum ('success', 'partial_failure', 'failed', 'never_synced');
create type agent_status as enum ('online', 'offline', 'error');

create type voucher_type as enum ('sales', 'purchase', 'payment', 'receipt', 'journal');
create type balance_type as enum ('dr', 'cr');

create type reconciliation_type as enum ('gst2b_vs_tally_purchase', 'tds26q_vs_tally_tds');
create type reconciliation_status as enum ('matched', 'mismatch', 'missing_in_tally', 'missing_in_portal', 'under_review', 'resolved', 'escalated');

create type write_back_status as enum ('pending', 'approved', 'sent', 'confirmed', 'failed', 'rejected');

-- ============================================================
-- TENANCY & STAFF
-- ============================================================

create table firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  branding jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table staff (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  auth_user_id uuid unique, -- references auth.users(id), nullable until account is linked
  name text not null,
  email text not null,
  role staff_role not null default 'article_assistant',
  permissions jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (firm_id, email)
);

-- ============================================================
-- CLIENTS
-- ============================================================

create table clients (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  entity_type entity_type not null,
  legal_name text not null,
  pan text, -- app-layer encrypted before write; column stores ciphertext
  gstins text[] default '{}',
  cin_llpin text,
  status client_status not null default 'active',
  onboarded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_clients_firm on clients(firm_id);
create index idx_clients_status on clients(firm_id, status);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  role text,
  email text,
  phone text,
  portal_access boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_contacts_client on contacts(client_id);

alter table clients add column primary_contact_id uuid references contacts(id);

-- ============================================================
-- DOCUMENTS & CREDENTIALS
-- ============================================================

create table documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  category document_category not null,
  storage_path text not null, -- object store key; object itself encrypted at rest
  version int not null default 1,
  uploaded_by uuid references staff(id),
  encryption_key_ref text, -- KMS key reference, never a raw key
  audit_trail jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_documents_client on documents(client_id);

create table credentials_vault (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  portal_type portal_type not null,
  username_encrypted text not null,
  password_encrypted text not null,
  otp_secret_encrypted text,
  access_scope staff_role[] default '{admin,partner}',
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, portal_type)
);
create index idx_credentials_client on credentials_vault(client_id);

-- ============================================================
-- SERVICES & FILINGS
-- ============================================================

create table services (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  service_type service_type not null,
  frequency service_frequency not null,
  assigned_staff_id uuid references staff(id),
  fee_amount numeric(12,2),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_services_client on services(client_id);

create table filings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  service_id uuid references services(id),
  filing_type filing_type not null,
  period text not null, -- e.g. '2026-07', 'AY2026-27'
  status filing_status not null default 'pending',
  due_date date not null,
  filed_date date,
  ack_number text,
  source_data_snapshot jsonb, -- Tally figures used at filing time
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_filings_client on filings(client_id);
create index idx_filings_due on filings(firm_id, due_date) where status not in ('filed','approved');
create index idx_filings_period on filings(client_id, filing_type, period);

-- ============================================================
-- TASKS, TIME, BILLING
-- ============================================================

create table tasks (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  filing_id uuid references filings(id) on delete set null,
  title text not null,
  description text,
  status task_status not null default 'pending',
  assigned_to uuid references staff(id),
  priority task_priority not null default 'medium',
  trigger_source task_trigger_source not null default 'manual',
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_tasks_firm_status on tasks(firm_id, status);
create index idx_tasks_client on tasks(client_id);
create index idx_tasks_assignee on tasks(assigned_to, status);

create table time_entries (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  staff_id uuid not null references staff(id),
  task_id uuid references tasks(id) on delete set null,
  client_id uuid references clients(id) on delete cascade,
  minutes_logged int not null check (minutes_logged > 0),
  billable boolean not null default true,
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);
create index idx_time_entries_client on time_entries(client_id);
create index idx_time_entries_staff on time_entries(staff_id, entry_date);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  line_items jsonb not null default '[]'::jsonb,
  total numeric(12,2) not null default 0,
  status invoice_status not null default 'draft',
  issued_date date,
  due_date date,
  created_at timestamptz not null default now()
);
create index idx_invoices_client on invoices(client_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount numeric(12,2) not null,
  method payment_method not null,
  paid_at timestamptz not null default now()
);
create index idx_payments_invoice on payments(invoice_id);

-- ============================================================
-- TALLY INTEGRATION
-- ============================================================

create table tally_sync_agents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  install_id text not null unique,
  machine_fingerprint text,
  agent_version text,
  auth_cert_ref text, -- KMS/cert-store reference for mTLS identity, never raw key material
  last_heartbeat_at timestamptz,
  status agent_status not null default 'offline',
  created_at timestamptz not null default now()
);
create index idx_agents_client on tally_sync_agents(client_id);
create index idx_agents_heartbeat on tally_sync_agents(status, last_heartbeat_at);

create table tally_sync_configs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  agent_id uuid references tally_sync_agents(id) on delete set null,
  tally_company_name text not null,
  tally_endpoint text not null default 'http://localhost:9000',
  sync_frequency sync_frequency not null default 'daily',
  sync_scope jsonb not null default '{"ledgers":true,"vouchers":true,"gst":true,"financials":true}'::jsonb,
  write_back_enabled boolean not null default false,
  last_sync_at timestamptz,
  last_sync_status sync_status not null default 'never_synced',
  auth_token_ref text, -- KMS reference for agent<->cloud auth token
  created_at timestamptz not null default now(),
  unique (client_id, tally_company_name)
);
create index idx_sync_configs_client on tally_sync_configs(client_id);
create index idx_sync_configs_agent on tally_sync_configs(agent_id);

create table tally_ledgers (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  sync_config_id uuid not null references tally_sync_configs(id) on delete cascade,
  ledger_name text not null,
  ledger_group text,
  opening_balance numeric(14,2) default 0,
  closing_balance numeric(14,2) default 0,
  balance_type balance_type,
  raw_xml_ref text, -- pointer to encrypted raw payload for audit, not the payload itself
  synced_at timestamptz not null default now(),
  unique (sync_config_id, ledger_name)
);
create index idx_ledgers_sync_config on tally_ledgers(sync_config_id);

create table tally_vouchers (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  sync_config_id uuid not null references tally_sync_configs(id) on delete cascade,
  voucher_type voucher_type not null,
  voucher_number text not null,
  voucher_date date not null,
  amount numeric(14,2) not null,
  party_ledger text,
  gst_taxable_value numeric(14,2),
  gst_amount numeric(14,2),
  synced_at timestamptz not null default now(),
  unique (sync_config_id, voucher_type, voucher_number, voucher_date)
);
create index idx_vouchers_sync_config on tally_vouchers(sync_config_id);
create index idx_vouchers_type_date on tally_vouchers(sync_config_id, voucher_type, voucher_date);

create table reconciliation_records (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  period text not null,
  type reconciliation_type not null,
  supplier_gstin text,
  invoice_number text,
  tally_value numeric(14,2),
  portal_value numeric(14,2),
  delta numeric(14,2) generated always as (coalesce(tally_value,0) - coalesce(portal_value,0)) stored,
  status reconciliation_status not null default 'under_review',
  resolution_notes text,
  resolved_by uuid references staff(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_reconciliation_client_period on reconciliation_records(client_id, period);
create index idx_reconciliation_status on reconciliation_records(firm_id, status);

create table tally_write_back_jobs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  sync_config_id uuid not null references tally_sync_configs(id) on delete cascade,
  filing_id uuid references filings(id),
  voucher_payload jsonb not null, -- JV / tax provision to be posted
  status write_back_status not null default 'pending',
  approved_by uuid references staff(id),
  approved_at timestamptz,
  tally_voucher_number text, -- populated only on confirmed success from the agent
  error_detail text,
  created_at timestamptz not null default now()
);
create index idx_writeback_client on tally_write_back_jobs(client_id, status);

-- ============================================================
-- updated_at TRIGGER HELPER
-- ============================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_clients_updated_at before update on clients
  for each row execute function set_updated_at();
create trigger trg_filings_updated_at before update on filings
  for each row execute function set_updated_at();
create trigger trg_tasks_updated_at before update on tasks
  for each row execute function set_updated_at();
