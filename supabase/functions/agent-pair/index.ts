// supabase/functions/agent-pair/index.ts
//
// Called by the Sync Agent installer (not a logged-in user — this is the
// one endpoint in the pipeline authenticated by a short-lived pairing code
// instead of a bearer token, since the agent doesn't have a token yet).
//
// POST body: { code: string, machine_fingerprint?: string, agent_version?: string }
// Response:  { agent_id, client_id, token } — `token` is shown to the
// agent exactly once. Only its hash is ever persisted (see _shared/tokens.ts).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { generateToken, sha256Hex } from '../_shared/tokens.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let body: { code?: string; machine_fingerprint?: string; agent_version?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }
  if (!body.code) {
    return new Response(JSON.stringify({ error: 'code is required' }), { status: 400 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: pairing, error: pairingErr } = await adminClient
    .from('tally_pairing_codes')
    .select('id, firm_id, client_id, expires_at, used_at')
    .eq('code', body.code)
    .maybeSingle();

  if (pairingErr || !pairing) {
    return new Response(JSON.stringify({ error: 'Invalid pairing code' }), { status: 400 });
  }
  if (pairing.used_at) {
    return new Response(JSON.stringify({ error: 'Pairing code already used' }), { status: 400 });
  }
  if (new Date(pairing.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: 'Pairing code expired' }), { status: 400 });
  }

  // Mark the code used first — if anything below fails, the code is
  // already burned rather than reusable, which is the safer failure mode
  // for a one-time credential.
  const { error: consumeErr } = await adminClient
    .from('tally_pairing_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', pairing.id)
    .is('used_at', null);
  if (consumeErr) {
    return new Response(JSON.stringify({ error: 'Failed to consume pairing code' }), { status: 500 });
  }

  const installId = crypto.randomUUID();
  const { data: agent, error: agentErr } = await adminClient
    .from('tally_sync_agents')
    .insert({
      firm_id: pairing.firm_id,
      client_id: pairing.client_id,
      install_id: installId,
      machine_fingerprint: body.machine_fingerprint ?? null,
      agent_version: body.agent_version ?? null,
      status: 'online',
      last_heartbeat_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (agentErr) {
    return new Response(JSON.stringify({ error: `Failed to register agent: ${agentErr.message}` }), { status: 500 });
  }

  const rawToken = generateToken();
  const tokenHash = await sha256Hex(rawToken);

  const { error: tokenErr } = await adminClient.from('tally_agent_tokens').insert({
    agent_id: agent.id,
    token_hash: tokenHash,
  });
  if (tokenErr) {
    return new Response(JSON.stringify({ error: `Failed to issue token: ${tokenErr.message}` }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ agent_id: agent.id, client_id: pairing.client_id, token: rawToken }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
