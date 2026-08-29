// supabase/functions/save-credential/index.ts
//
// POST body: { client_id, portal_type, username, password, otp_secret? }
// Only Admin/Partner may call this (matches the DB's own credentials_write
// RLS policy, re-checked here explicitly since this function uses the
// service-role client and so bypasses RLS — the check has to happen in
// code, not rely on the database to enforce it for this path).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encryptField } from '../_shared/crypto.ts';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

interface SavePayload {
  client_id: string;
  portal_type: 'income_tax' | 'gst' | 'mca' | 'udyam' | 'fssai';
  username: string;
  password: string;
  otp_secret?: string;
}

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

  const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: callerStaff, error: callerErr } = await adminClient
    .from('staff')
    .select('id, firm_id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (callerErr || !callerStaff) {
    return new Response(JSON.stringify({ error: 'Caller has no staff record' }), { status: 403, headers: corsHeaders });
  }
  if (!['admin', 'partner'].includes(callerStaff.role)) {
    return new Response(JSON.stringify({ error: 'Only Admin or Partner can manage credentials' }), { status: 403, headers: corsHeaders });
  }

  let body: SavePayload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders });
  }
  if (!body.client_id || !body.portal_type || !body.username || !body.password) {
    return new Response(JSON.stringify({ error: 'client_id, portal_type, username, and password are required' }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { data: client, error: clientErr } = await adminClient
    .from('clients')
    .select('id')
    .eq('id', body.client_id)
    .eq('firm_id', callerStaff.firm_id)
    .maybeSingle();
  if (clientErr || !client) {
    return new Response(JSON.stringify({ error: 'Client not found in your firm' }), { status: 404, headers: corsHeaders });
  }

  let usernameEncrypted: string;
  let passwordEncrypted: string;
  let otpEncrypted: string | null = null;
  try {
    usernameEncrypted = await encryptField(body.username);
    passwordEncrypted = await encryptField(body.password);
    if (body.otp_secret) otpEncrypted = await encryptField(body.otp_secret);
  } catch (err) {
    return new Response(JSON.stringify({ error: `Encryption failed: ${(err as Error).message}` }), { status: 500, headers: corsHeaders });
  }

  const { data: saved, error: saveErr } = await adminClient
    .from('credentials_vault')
    .upsert(
      {
        firm_id: callerStaff.firm_id,
        client_id: body.client_id,
        portal_type: body.portal_type,
        username_encrypted: usernameEncrypted,
        password_encrypted: passwordEncrypted,
        otp_secret_encrypted: otpEncrypted,
      },
      { onConflict: 'client_id,portal_type' }
    )
    .select('id, portal_type')
    .single();

  if (saveErr) {
    return new Response(JSON.stringify({ error: `Failed to save credential: ${saveErr.message}` }), { status: 500, headers: corsHeaders });
  }

  await adminClient.from('activity_log').insert({
    firm_id: callerStaff.firm_id,
    client_id: body.client_id,
    actor_id: callerStaff.id,
    action: 'credential_saved',
    summary: `Saved ${body.portal_type} credentials`,
  });

  return new Response(JSON.stringify(saved), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
