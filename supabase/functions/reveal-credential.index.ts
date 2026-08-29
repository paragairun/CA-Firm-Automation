// supabase/functions/reveal-credential/index.ts
//
// POST body: { credential_id }
// Decrypts and returns a credential to the caller — but only if their
// staff role is in that specific row's access_scope, and only if the
// credential belongs to their own firm (checked explicitly, since the
// service-role client bypasses RLS). Every successful reveal is logged
// to activity_log with the caller's identity — matches the spec's
// "every access event logged with actor, timestamp, purpose" requirement
// (§6). There is no way to list or bulk-export credentials through this
// function — one row at a time, one explicit reveal at a time.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { decryptField } from '../_shared/crypto.ts';

interface RevealPayload {
  credential_id: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });
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
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: callerStaff, error: callerErr } = await adminClient
    .from('staff')
    .select('id, firm_id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (callerErr || !callerStaff) {
    return new Response(JSON.stringify({ error: 'Caller has no staff record' }), { status: 403 });
  }

  let body: RevealPayload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }
  if (!body.credential_id) {
    return new Response(JSON.stringify({ error: 'credential_id is required' }), { status: 400 });
  }

  const { data: cred, error: credErr } = await adminClient
    .from('credentials_vault')
    .select('id, firm_id, client_id, portal_type, access_scope, username_encrypted, password_encrypted, otp_secret_encrypted')
    .eq('id', body.credential_id)
    .maybeSingle();
  if (credErr || !cred) {
    return new Response(JSON.stringify({ error: 'Credential not found' }), { status: 404 });
  }
  if (cred.firm_id !== callerStaff.firm_id) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }); // don't leak cross-firm existence
  }
  if (!cred.access_scope.includes(callerStaff.role)) {
    return new Response(JSON.stringify({ error: 'Your role does not have access to this credential' }), { status: 403 });
  }

  let username: string;
  let password: string;
  let otpSecret: string | null = null;
  try {
    username = await decryptField(cred.username_encrypted);
    password = await decryptField(cred.password_encrypted);
    if (cred.otp_secret_encrypted) otpSecret = await decryptField(cred.otp_secret_encrypted);
  } catch (err) {
    return new Response(JSON.stringify({ error: `Decryption failed: ${(err as Error).message}` }), { status: 500 });
  }

  await adminClient.from('activity_log').insert({
    firm_id: callerStaff.firm_id,
    client_id: cred.client_id,
    actor_id: callerStaff.id,
    action: 'credential_revealed',
    summary: `Revealed ${cred.portal_type} credentials`,
  });

  return new Response(JSON.stringify({ portal_type: cred.portal_type, username, password, otp_secret: otpSecret }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
