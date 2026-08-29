// supabase/functions/agent-config/index.ts
//
// Called by the Sync Agent (bearer token, not a user session) to learn
// its current sync_config_id, Tally company name, and sync frequency.
// Exists because company binding (spec §3.3 step 2 — an Admin/Partner
// maps this agent to a specific tally_sync_configs row) happens in the
// web app, server-side, after the agent has already paired locally. The
// agent has no other way to discover that assignment or notice it change.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sha256Hex } from '../_shared/tokens.ts';

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

  const { data: syncConfig, error: syncErr } = await adminClient
    .from('tally_sync_configs')
    .select('id, tally_company_name, sync_frequency, write_back_enabled')
    .eq('agent_id', tokenRow.agent_id)
    .maybeSingle();
  if (syncErr) {
    return new Response(JSON.stringify({ error: syncErr.message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({
      sync_config_id: syncConfig?.id ?? null,
      tally_company_name: syncConfig?.tally_company_name ?? null,
      sync_frequency: syncConfig?.sync_frequency ?? 'daily',
      write_back_enabled: syncConfig?.write_back_enabled ?? false,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
