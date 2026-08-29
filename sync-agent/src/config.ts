import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_DIR, encryptField, decryptField } from './crypto.js';
import type { AgentConfig } from './types.js';

const CONFIG_PATH = join(AGENT_DIR, 'config.json');

// On disk, agent_token is stored encrypted; every other field is stored
// as-is (none of it is a secret — the endpoint, ids, and frequency are
// operationally useful to read/edit by hand if something needs fixing).
interface StoredConfig extends Omit<AgentConfig, 'agent_token'> {
  agent_token_encrypted: string;
}

export function isPaired(): boolean {
  return existsSync(CONFIG_PATH);
}

export function loadConfig(): AgentConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error('Agent is not paired yet. Run `npm run pair` first.');
  }
  const stored = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as StoredConfig;
  const { agent_token_encrypted, ...rest } = stored;
  return { ...rest, agent_token: decryptField(agent_token_encrypted) };
}

export function saveConfig(config: AgentConfig): void {
  const { agent_token, ...rest } = config;
  const stored: StoredConfig = { ...rest, agent_token_encrypted: encryptField(agent_token) };
  writeFileSync(CONFIG_PATH, JSON.stringify(stored, null, 2));
}

export function updateConfig(patch: Partial<AgentConfig>): AgentConfig {
  const current = loadConfig();
  const updated = { ...current, ...patch };
  saveConfig(updated);
  return updated;
}
