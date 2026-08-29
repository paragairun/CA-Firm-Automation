// supabase/functions/_shared/crypto.ts
//
// Encryption for the Credential Vault. This is a single shared symmetric
// key held as an Edge Function secret (CREDENTIAL_ENCRYPTION_KEY) — a real
// step up from storing plaintext, but NOT the spec's full picture (§6:
// "AES-256 ... keys managed via KMS with per-tenant key separation").
// A genuine production upgrade would move key custody to a real KMS
// (AWS KMS, GCP KMS, or Supabase Vault) with one key per firm, so a
// single leaked key doesn't expose every firm's credentials at once. See
// README for the full caveat.
//
// Generate a key with: openssl rand -base64 32
// Set it with:        supabase secrets set CREDENTIAL_ENCRYPTION_KEY=<value>

async function getKey(): Promise<CryptoKey> {
  const b64 = Deno.env.get('CREDENTIAL_ENCRYPTION_KEY');
  if (!b64) throw new Error('CREDENTIAL_ENCRYPTION_KEY is not set');
  const raw = base64Decode(b64);
  if (raw.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Envelope format: "<base64 iv>.<base64 ciphertext>" — a fresh random IV
// per field, per save, so encrypting the same value twice never produces
// the same ciphertext.
export async function encryptField(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return `${base64Encode(iv)}.${base64Encode(new Uint8Array(cipherBuf))}`;
}

export async function decryptField(envelope: string): Promise<string> {
  const key = await getKey();
  const [ivB64, dataB64] = envelope.split('.');
  if (!ivB64 || !dataB64) throw new Error('Malformed credential envelope');
  const iv = base64Decode(ivB64);
  const data = base64Decode(dataB64);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(plainBuf);
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
