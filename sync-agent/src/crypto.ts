// Encrypts the agent's local config (specifically agent_token) at rest.
//
// The spec (§8.2) calls for this to live in an "encrypted local store
// (DPAPI on Windows)". DPAPI is Windows-only and not reachable from
// portable Node without a native addon. This uses a cross-platform
// substitute instead: a random 32-byte key file created on first run
// with owner-only permissions (0600 on POSIX; Windows ACLs aren't fully
// enforced the same way via Node's fs.chmod, which is a real gap — see
// README). A genuine Windows-service build should swap this module for
// actual DPAPI (e.g. via a small native addon or the `dpapi-addon`
// package) without touching anything else in the agent.

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const AGENT_DIR = join(homedir(), '.practiceos-agent');
const KEY_PATH = join(AGENT_DIR, 'machine.key');

function ensureAgentDir(): void {
  if (!existsSync(AGENT_DIR)) mkdirSync(AGENT_DIR, { recursive: true });
}

function getOrCreateMachineKey(): Buffer {
  ensureAgentDir();
  if (existsSync(KEY_PATH)) {
    return readFileSync(KEY_PATH);
  }
  const key = randomBytes(32);
  writeFileSync(KEY_PATH, key);
  try {
    chmodSync(KEY_PATH, 0o600);
  } catch {
    // Best-effort on platforms where this doesn't apply cleanly (see header note).
  }
  return key;
}

export function encryptField(plaintext: string): string {
  const key = getOrCreateMachineKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptField(envelope: string): string {
  const key = getOrCreateMachineKey();
  const [ivB64, tagB64, dataB64] = envelope.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted field');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export { AGENT_DIR };
