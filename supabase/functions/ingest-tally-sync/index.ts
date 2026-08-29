// supabase/functions/ingest-tally-sync/index.ts
//
// Called by the Sync Agent on every scheduled/triggered sync (spec §3.3,
// steps 4–6). The agent has already done its own XML parsing locally
// (per the Sync Agent architecture in the spec, §8) — this function
// receives already-structured JSON, not raw Tally XML.
//
// Auth: Authorization: Bearer <token issued by agent-pair>
// Body: {
//   sync_config_id: string,
//   ledgers?: Array<{ ledger_name, ledger_group?, opening_balance?, closing_balance?, balance_type?, gstin? }>,
//   vouchers?: Array<{ voucher_type, voucher_number, voucher_date, amount, party_ledger?, gst_taxable_value?, gst_amount? }>
// }
//
// Idempotency: upserts key on the same unique constraints the schema
// already enforces (sync_config_id + ledger_name; sync_config_id +
// voucher_type + voucher_number + voucher_date), so a retried or
// re-delivered payload overwrites rather than duplicates — no separate
// checksum/dedupe table needed for this.
//
// This function does the upsert synchronously rather than enqueueing a
// background job. For JSON payloads at the scale a single Tally company
// produces, that's a reasonable scaffold-level simplification; the spec's
// Queue Worker step (§3.3) becomes relevant at higher volume or when true
// async retry/backoff semantics are needed — see README for the note on
// upgrading this to a real queue (e.g. pgmq) later without changing the
// agent-facing contract above.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sha256Hex } from '../_shared/tokens.ts';

interface LedgerPayload {
  ledger_name: string;
  ledger_group?: string;
  opening_balance?: number;
  closing_balance?: number;
  balance_type?: 'dr' | 'cr';
  gstin?: string;
}

interface VoucherPayload {
  voucher_type: 'sales' | 'purchase' | 'payment' | 'receipt' | 'journal';
  voucher_number: string;
  voucher_date: string;
  amount: number;
  party_ledger?: string;
  gst_taxable_value?: number;
  gst_amount?: number;
}

interface IngestBody {
  sync_config_id?: string;
  ledgers?: LedgerPayload[];
  vouchers?: VoucherPayload[];
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing bearer token' }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const tokenHash = await sha256Hex(token);
  const { data: tokenRow, error: tokenErr } = await adminClient
    .from('tally_agent_tokens')
    .select('agent_id')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (tokenErr || !tokenRow) {
    return new Response(JSON.stringify({ error: 'Invalid or revoked token' }), { status: 401 });
  }
  const agentId = tokenRow.agent_id;

  // Heartbeat: this call itself proves the agent is online, independent of
  // whether the payload below turns out to be empty or partially invalid.
  await adminClient
    .from('tally_sync_agents')
    .update({ status: 'online', last_heartbeat_at: new Date().toISOString() })
    .eq('id', agentId);

  let body: IngestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }
  if (!body.sync_config_id) {
    return new Response(JSON.stringify({ error: 'sync_config_id is required' }), { status: 400 });
  }

  const { data: syncConfig, error: syncConfigErr } = await adminClient
    .from('tally_sync_configs')
    .select('id, firm_id, agent_id')
    .eq('id', body.sync_config_id)
    .maybeSingle();

  if (syncConfigErr || !syncConfig) {
    return new Response(JSON.stringify({ error: 'Unknown sync_config_id' }), { status: 404 });
  }
  if (syncConfig.agent_id !== agentId) {
    // This agent's token is valid, but not for this sync config — refuse
    // rather than silently writing data under the wrong client/company.
    return new Response(JSON.stringify({ error: 'This agent is not paired to that sync_config_id' }), { status: 403 });
  }

  const errors: string[] = [];
  let ledgersWritten = 0;
  let vouchersWritten = 0;

  if (body.ledgers?.length) {
    const rows = body.ledgers
      .filter((l) => {
        const valid = typeof l.ledger_name === 'string' && l.ledger_name.trim().length > 0;
        if (!valid) errors.push(`Skipped ledger with missing ledger_name`);
        return valid;
      })
      .map((l) => ({
        firm_id: syncConfig.firm_id,
        sync_config_id: syncConfig.id,
        ledger_name: l.ledger_name,
        ledger_group: l.ledger_group ?? null,
        opening_balance: l.opening_balance ?? 0,
        closing_balance: l.closing_balance ?? 0,
        balance_type: l.balance_type ?? null,
        gstin: l.gstin ?? null,
        synced_at: new Date().toISOString(),
      }));

    if (rows.length) {
      const { error, count } = await adminClient
        .from('tally_ledgers')
        .upsert(rows, { onConflict: 'sync_config_id,ledger_name', count: 'exact' });
      if (error) errors.push(`Ledger upsert failed: ${error.message}`);
      else ledgersWritten = count ?? rows.length;
    }
  }

  if (body.vouchers?.length) {
    const rows = body.vouchers
      .filter((v) => {
        const valid =
          typeof v.voucher_number === 'string' &&
          v.voucher_number.trim().length > 0 &&
          typeof v.voucher_date === 'string' &&
          typeof v.amount === 'number';
        if (!valid) errors.push(`Skipped voucher with missing required fields`);
        return valid;
      })
      .map((v) => ({
        firm_id: syncConfig.firm_id,
        sync_config_id: syncConfig.id,
        voucher_type: v.voucher_type,
        voucher_number: v.voucher_number,
        voucher_date: v.voucher_date,
        amount: v.amount,
        party_ledger: v.party_ledger ?? null,
        gst_taxable_value: v.gst_taxable_value ?? null,
        gst_amount: v.gst_amount ?? null,
        synced_at: new Date().toISOString(),
      }));

    if (rows.length) {
      const { error, count } = await adminClient
        .from('tally_vouchers')
        .upsert(rows, { onConflict: 'sync_config_id,voucher_type,voucher_number,voucher_date', count: 'exact' });
      if (error) errors.push(`Voucher upsert failed: ${error.message}`);
      else vouchersWritten = count ?? rows.length;
    }
  }

  const status = errors.length === 0 ? 'success' : ledgersWritten + vouchersWritten > 0 ? 'partial_failure' : 'failed';

  await adminClient
    .from('tally_sync_configs')
    .update({ last_sync_at: new Date().toISOString(), last_sync_status: status })
    .eq('id', syncConfig.id);

  return new Response(JSON.stringify({ status, ledgers_written: ledgersWritten, vouchers_written: vouchersWritten, errors }), {
    status: errors.length && ledgersWritten + vouchersWritten === 0 ? 422 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
