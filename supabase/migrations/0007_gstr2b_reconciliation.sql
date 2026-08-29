-- GSTR-2B reconciliation matching (spec §4.1).
--
-- Deliberately NOT a live GST portal integration: calling the actual GSTN
-- API requires registration as a GSP/ASP and credentials this project
-- doesn't have, and the credentials vault has no real encryption behind
-- it yet (see README) — piping real portal logins through it would be
-- worse than not building the feature. Instead, GSTR-2B data lands here
-- via a normalized staging table that any import path can populate: a
-- manual upload of the portal's export (mapped to this shape), or a real
-- GSP integration later without changing the matching logic below.

create table gstr2b_line_items (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  period text not null, -- 'YYYY-MM', matches reconciliation_records.period
  supplier_gstin text not null,
  invoice_number text not null,
  invoice_date date,
  taxable_value numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  imported_by uuid references staff(id),
  imported_at timestamptz not null default now()
);
create index idx_gstr2b_client_period on gstr2b_line_items(client_id, period);

alter table gstr2b_line_items enable row level security;

create policy gstr2b_select on gstr2b_line_items for select
  using (can_access_client(client_id));
create policy gstr2b_write on gstr2b_line_items for all
  using (can_access_client(client_id))
  with check (can_access_client(client_id));

-- firm_id auto-derives from client_id, same as every other client-scoped
-- table (migration 0003's trigger already covers any table in its list —
-- add this one to it).
create trigger trg_gstr2b_line_items_set_firm_id
  before insert on gstr2b_line_items
  for each row execute function set_firm_id_from_client();

-- ============================================================
-- Matching function
-- ============================================================
--
-- SECURITY INVOKER (the default — no SECURITY DEFINER here): runs as the
-- calling user, so it can only read/write rows that user's own RLS
-- policies already allow. It cannot be used to bypass access control for
-- a client the caller can't see.
--
-- Matching key: invoice number only, normalized (trimmed), scoped to one
-- client + period. Ideally this would match on (supplier_gstin,
-- invoice_number) as the spec describes, but tally_vouchers has no
-- supplier-GSTIN column — that lives on the ledger master, which this
-- schema doesn't yet join from voucher to ledger to portal data. Matching
-- by invoice number alone within a single client-month is a reasonable
-- approximation (duplicate invoice numbers across different suppliers in
-- the same month are uncommon) but is a real simplification, not the
-- spec's exact algorithm — see README. A full outer join on that key
-- naturally produces all four outcomes from spec §4.1 in one pass:
--   - both sides present, values agree (±₹1)  -> matched
--   - both sides present, values differ        -> mismatch
--   - only in GSTR-2B                           -> missing_in_tally
--   - only in Tally                              -> missing_in_portal
--
-- Existing 'resolved' and 'escalated' rows for the same client/period are
-- left untouched — re-running reconciliation shouldn't erase a CA's
-- completed work, only regenerate the still-open comparison.
create or replace function run_gstr2b_reconciliation(p_client_id uuid, p_period text)
returns table(matched_count int, mismatch_count int, missing_in_tally_count int, missing_in_portal_count int) as $$
declare
  v_matched int := 0;
  v_mismatch int := 0;
  v_missing_tally int := 0;
  v_missing_portal int := 0;
begin
  delete from reconciliation_records
  where client_id = p_client_id
    and period = p_period
    and type = 'gst2b_vs_tally_purchase'
    and status in ('matched', 'mismatch', 'missing_in_tally', 'missing_in_portal', 'under_review');

  with tally_rows as (
    select
      trim(v.voucher_number) as key_invoice,
      v.amount as tally_value
    from tally_vouchers v
    join tally_sync_configs sc on sc.id = v.sync_config_id
    where sc.client_id = p_client_id
      and v.voucher_type = 'purchase'
      and to_char(v.voucher_date, 'YYYY-MM') = p_period
  ),
  portal_rows as (
    select
      upper(trim(g.supplier_gstin)) as key_gstin,
      trim(g.invoice_number) as key_invoice,
      g.taxable_value + g.tax_amount as portal_value,
      g.supplier_gstin
    from gstr2b_line_items g
    where g.client_id = p_client_id
      and g.period = p_period
  ),
  -- Tally vouchers don't carry a supplier GSTIN column directly usable
  -- here without a ledger-master lookup this schema doesn't yet have, so
  -- the join key on the Tally side is invoice number only, scoped to this
  -- client+period (a client's purchase register for one month rarely has
  -- duplicate invoice numbers across different suppliers; this is a known
  -- simplification — see README).
  tally_by_invoice as (
    select key_invoice, sum(tally_value) as tally_value
    from tally_rows
    group by key_invoice
  ),
  portal_by_invoice as (
    select key_invoice, sum(portal_value) as portal_value, max(supplier_gstin) as supplier_gstin
    from portal_rows
    group by key_invoice
  ),
  joined as (
    select
      coalesce(t.key_invoice, p.key_invoice) as invoice_number,
      p.supplier_gstin,
      t.tally_value,
      p.portal_value
    from tally_by_invoice t
    full outer join portal_by_invoice p on p.key_invoice = t.key_invoice
  ),
  classified as (
    select
      invoice_number,
      supplier_gstin,
      tally_value,
      portal_value,
      case
        when tally_value is not null and portal_value is not null and abs(tally_value - portal_value) <= 1 then 'matched'
        when tally_value is not null and portal_value is not null then 'mismatch'
        when tally_value is null then 'missing_in_tally'
        else 'missing_in_portal'
      end as status
    from joined
  ),
  inserted as (
    insert into reconciliation_records (client_id, period, type, supplier_gstin, invoice_number, tally_value, portal_value, status)
    select p_client_id, p_period, 'gst2b_vs_tally_purchase', supplier_gstin, invoice_number, tally_value, portal_value, status::reconciliation_status
    from classified
    returning status
  )
  select
    count(*) filter (where status = 'matched'),
    count(*) filter (where status = 'mismatch'),
    count(*) filter (where status = 'missing_in_tally'),
    count(*) filter (where status = 'missing_in_portal')
  into v_matched, v_mismatch, v_missing_tally, v_missing_portal
  from inserted;

  return query select v_matched, v_mismatch, v_missing_tally, v_missing_portal;
end;
$$ language plpgsql security invoker;

grant execute on function run_gstr2b_reconciliation(uuid, text) to authenticated;
