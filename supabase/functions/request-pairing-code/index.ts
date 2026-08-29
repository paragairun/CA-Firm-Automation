// supabase/functions/request-pairing-code/index.ts
//
// Called from the client: supabase.functions.invoke('request-pairing-code', { body: { client_id } })
// Returns a short code (valid 30 minutes) to type into the Sync Agent
// installer at the client's site. The agent exchanges it via agent-pair.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { generatePairingCode } from '../_shared/tokens.ts';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await callerClient.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: corsHeaders });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerStaff, error: callerErr } = await adminClient
    .from('staff')
    .select('id, firm_id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (callerErr || !callerStaff) {
    return new Response(JSON.stringify({ error: 'Caller has no staff record' }), { status: 403, headers: corsHeaders });
  }
  if (!['admin', 'partner', 'audit_manager'].includes(callerStaff.role)) {
    return new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403, headers: corsHeaders });
  }

  let body: { client_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders });
  }
  if (!body.client_id) {
    return new Response(JSON.stringify({ error: 'client_id is required' }), { status: 400, headers: corsHeaders });
  }

  // Confirm the client belongs to the caller's firm before issuing a code
  // for it — the pairing_codes table itself carries no RLS, so this check
  // is the only thing standing between a caller and pairing an agent onto
  // a client outside their firm.
  const { data: client, error: clientErr } = await adminClient
    .from('clients')
    .select('id')
    .eq('id', body.client_id)
    .eq('firm_id', callerStaff.firm_id)
    .maybeSingle();
  if (clientErr || !client) {
    return new Response(JSON.stringify({ error: 'Client not found in your firm' }), { status: 404, headers: corsHeaders });
  }

  const code = generatePairingCode();
  const { data: pairing, error: insertErr } = await adminClient
    .from('tally_pairing_codes')
    .insert({
      firm_id: callerStaff.firm_id,
      client_id: body.client_id,
      code,
      created_by: callerStaff.id,
    })
    .select('code, expires_at')
    .single();

  if (insertErr) {
    return new Response(JSON.stringify({ error: `Failed to create pairing code: ${insertErr.message}` }), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify(pairing), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
