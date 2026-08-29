import { supabase } from './supabaseClient';

export type PortalType = 'income_tax' | 'gst' | 'mca' | 'udyam' | 'fssai';

export interface SaveCredentialInput {
  client_id: string;
  portal_type: PortalType;
  username: string;
  password: string;
  otp_secret?: string;
}

export interface RevealedCredential {
  portal_type: PortalType;
  username: string;
  password: string;
  otp_secret: string | null;
}

export async function saveCredential(input: SaveCredentialInput): Promise<{ id: string; portal_type: string }> {
  const { data, error } = await supabase.functions.invoke('save-credential', { body: input });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

// Every call to this is logged server-side against the caller's identity
// (see reveal-credential/index.ts) — never call this speculatively or to
// pre-fetch; only in direct response to the user clicking "Reveal".
export async function revealCredential(credentialId: string): Promise<RevealedCredential> {
  const { data, error } = await supabase.functions.invoke('reveal-credential', {
    body: { credential_id: credentialId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
