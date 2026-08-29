import type { LedgerRecord, VoucherRecord } from './types.js';

export interface PairResult {
  agent_id: string;
  client_id: string;
  token: string;
}

export async function pairWithCode(
  supabaseUrl: string,
  pairingCode: string,
  machineFingerprint: string,
  agentVersion: string
): Promise<PairResult> {
  const res = await fetch(`${supabaseUrl}/functions/v1/agent-pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: pairingCode, machine_fingerprint: machineFingerprint, agent_version: agentVersion }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error ?? `Pairing failed with HTTP ${res.status}`);
  }
  return data as PairResult;
}

export interface AgentConfigResponse {
  sync_config_id: string | null;
  tally_company_name: string | null;
  sync_frequency: 'realtime' | 'hourly' | 'daily';
  write_back_enabled: boolean;
}

export async function fetchAgentConfig(supabaseUrl: string, agentToken: string): Promise<AgentConfigResponse> {
  const res = await fetch(`${supabaseUrl}/functions/v1/agent-config`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error ?? `Config fetch failed with HTTP ${res.status}`);
  }
  return data as AgentConfigResponse;
}

export interface IngestResult {
  status: 'success' | 'partial_failure' | 'failed';
  ledgers_written: number;
  vouchers_written: number;
  errors: string[];
}

export async function ingestSync(
  supabaseUrl: string,
  agentToken: string,
  syncConfigId: string,
  ledgers: LedgerRecord[],
  vouchers: VoucherRecord[]
): Promise<IngestResult> {
  const res = await fetch(`${supabaseUrl}/functions/v1/ingest-tally-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${agentToken}`,
    },
    body: JSON.stringify({ sync_config_id: syncConfigId, ledgers, vouchers }),
  });
  const data = await res.json();
  if (!res.ok && res.status !== 422) {
    // 422 = partial/failed upload the server still wants to record;
    // anything else (401/403/5xx) is treated as a hard failure to retry.
    throw new Error(data.error ?? `Ingestion failed with HTTP ${res.status}`);
  }
  return data as IngestResult;
}

// Exponential backoff for the cloud uplink specifically (spec §8.3):
// 1m, 2m, 4m... capped, so a down Ingestion API doesn't get hammered.
export async function withBackoff<T>(fn: () => Promise<T>, maxAttempts = 6): Promise<T> {
  let attempt = 0;
  let delayMs = 60_000;
  const capMs = 30 * 60_000;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, capMs);
    }
  }
}
