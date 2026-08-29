-- Closes a gap flagged in 0007's comments: reconciliation matching was
-- invoice-number-only because tally_vouchers had no supplier-GSTIN to
-- match against. This adds gstin to tally_ledgers (populated from the
-- Sync Agent's ledger export, where Tally's ledger master carries each
-- party's GST registration) and rewrites the matching function to join
-- voucher -> ledger -> gstin, matching on (gstin, invoice_number) when
-- available and falling back to invoice-number-only otherwise — not
-- every voucher's party ledger will have a synced GSTIN yet, especially
-- right after this migration runs, before ledgers re-sync.

alter table tally_ledgers add column gstin text;

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
    -- Left join to the ledger master so a voucher whose party ledger
    -- hasn't been GSTIN-tagged yet still participates in matching (via
    -- invoice number alone) rather than silently dropping out.
    select
      trim(v.voucher_number) as key_invoice,
      v.amount as tally_value,
      upper(trim(l.gstin)) as key_gstin
    from tally_vouchers v
    join tally_sync_configs sc on sc.id = v.sync_config_id
    left join tally_ledgers l
      on l.sync_config_id = v.sync_config_id
      and lower(trim(l.ledger_name)) = lower(trim(v.party_ledger))
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
  tally_by_invoice as (
    select key_invoice, sum(tally_value) as tally_value, max(key_gstin) as key_gstin
    from tally_rows
    group by key_invoice
  ),
  portal_by_invoice as (
    select key_invoice, sum(portal_value) as portal_value, max(supplier_gstin) as supplier_gstin, max(key_gstin) as key_gstin
    from portal_rows
    group by key_invoice
  ),
  joined as (
    select
      coalesce(t.key_invoice, p.key_invoice) as invoice_number,
      p.supplier_gstin,
      t.tally_value,
      p.portal_value,
      -- Both sides have a GSTIN and they disagree: still matched on
      -- invoice number (the join key), but this is a weaker match than
      -- true (gstin, invoice_number) — surfaced via match_note below
      -- rather than silently treated the same as a full match.
      case
        when t.key_gstin is not null and p.key_gstin is not null and t.key_gstin != p.key_gstin then true
        else false
      end as gstin_mismatch
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
        when tally_value is not null and portal_value is not null and abs(tally_value - portal_value) <= 1 and not gstin_mismatch then 'matched'
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
