import { supabase } from './supabaseClient';

// GSTR-2B data enters the app through this normalized shape — NOT the
// government portal's actual export format, which this project has no
// verified knowledge of. A real deployment needs a small adapter (script
// or Edge Function) that maps the portal's raw JSON/Excel export into
// this shape before calling importGstr2bLineItems. See README.
export interface Gstr2bLineItemInput {
  supplier_gstin: string;
  invoice_number: string;
  invoice_date?: string; // ISO date, optional
  taxable_value: number;
  tax_amount: number;
}

export interface ReconciliationRunResult {
  matched_count: number;
  mismatch_count: number;
  missing_in_tally_count: number;
  missing_in_portal_count: number;
}

function validateLineItems(items: unknown): Gstr2bLineItemInput[] {
  if (!Array.isArray(items)) {
    throw new Error('Expected a JSON array of line items.');
  }
  return items.map((raw, i) => {
    const item = raw as Partial<Gstr2bLineItemInput>;
    if (typeof item.supplier_gstin !== 'string' || !item.supplier_gstin.trim()) {
      throw new Error(`Row ${i + 1}: supplier_gstin is required.`);
    }
    if (typeof item.invoice_number !== 'string' || !item.invoice_number.trim()) {
      throw new Error(`Row ${i + 1}: invoice_number is required.`);
    }
    if (typeof item.taxable_value !== 'number') {
      throw new Error(`Row ${i + 1}: taxable_value must be a number.`);
    }
    if (typeof item.tax_amount !== 'number') {
      throw new Error(`Row ${i + 1}: tax_amount must be a number.`);
    }
    return {
      supplier_gstin: item.supplier_gstin,
      invoice_number: item.invoice_number,
      invoice_date: typeof item.invoice_date === 'string' ? item.invoice_date : undefined,
      taxable_value: item.taxable_value,
      tax_amount: item.tax_amount,
    };
  });
}

// Replaces any existing staged rows for this client+period — re-uploading
// is treated as "this supersedes the previous import," not an append.
export async function importGstr2bLineItems(
  clientId: string,
  period: string,
  rawItems: unknown,
  importedBy: string
): Promise<number> {
  const items = validateLineItems(rawItems);

  const { error: deleteErr } = await supabase
    .from('gstr2b_line_items')
    .delete()
    .eq('client_id', clientId)
    .eq('period', period);
  if (deleteErr) throw deleteErr;

  if (items.length === 0) return 0;

  const { error: insertErr, count } = await supabase.from('gstr2b_line_items').insert(
    items.map((item) => ({
      client_id: clientId,
      period,
      supplier_gstin: item.supplier_gstin,
      invoice_number: item.invoice_number,
      invoice_date: item.invoice_date ?? null,
      taxable_value: item.taxable_value,
      tax_amount: item.tax_amount,
      imported_by: importedBy,
    })),
    { count: 'exact' }
  );
  if (insertErr) throw insertErr;
  return count ?? items.length;
}

export async function runGstr2bReconciliation(clientId: string, period: string): Promise<ReconciliationRunResult> {
  const { data, error } = await supabase
    .rpc('run_gstr2b_reconciliation', { p_client_id: clientId, p_period: period })
    .single();
  if (error) throw error;
  return data as ReconciliationRunResult;
}
