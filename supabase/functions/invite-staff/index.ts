// supabase/functions/invite-staff/index.ts
//
// Deploy: supabase functions deploy invite-staff
// Called from the client as: supabase.functions.invoke('invite-staff', { body: {...} })
//
// Requires the caller to be signed in as an Admin or Partner. Never expose
// the service role key to client code — this function is the one place
// it's allowed to live, and every action it takes on the caller's behalf
// starts by re-verifying who the caller is server-side (never trusts a
// role or firm_id passed in the request body).

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface InvitePayload {
  email: string;
  name: string;
  role: 'admin' | 'partner' | 'audit_manager' | 'article_assistant';
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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Client scoped to the caller's own JWT — used only to establish who is
  // making the request via their existing RLS-scoped identity.
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

  // Service-role client — only used after the caller's identity and role
  // are confirmed below, and only for the two actions this function exists
  // to perform (create the staff row, send the invite).
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerStaff, error: callerErr } = await adminClient
    .from('staff')
    .select('id, firm_id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (callerErr || !callerStaff) {
    return new Response(JSON.stringify({ error: 'Caller has no staff record' }), { status: 403 });
  }
  if (!['admin', 'partner'].includes(callerStaff.role)) {
    return new Response(JSON.stringify({ error: 'Only Admin or Partner can invite staff' }), { status: 403 });
  }

  let payload: InvitePayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { email, name, role } = payload;
  if (!email || !name || !role) {
    return new Response(JSON.stringify({ error: 'email, name, and role are required' }), { status: 400 });
  }

  // Create (or reuse) the staff row first — the auth.users insert trigger
  // (see migration 0004) links auth_user_id automatically once the invite
  // is accepted, so this function never sets auth_user_id itself.
  const { data: staffRow, error: staffErr } = await adminClient
    .from('staff')
    .upsert(
      { firm_id: callerStaff.firm_id, email, name, role },
      { onConflict: 'firm_id,email', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (staffErr) {
    return new Response(JSON.stringify({ error: `Failed to create staff row: ${staffErr.message}` }), { status: 500 });
  }

  const { error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email);
  if (inviteErr) {
    return new Response(JSON.stringify({ error: `Staff row created, but invite email failed: ${inviteErr.message}` }), {
      status: 502,
    });
  }

  return new Response(JSON.stringify({ staff: staffRow }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
