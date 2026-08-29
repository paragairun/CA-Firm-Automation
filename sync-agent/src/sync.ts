import { fetchLedgers, fetchPurchaseVouchers } from './tally-client.js';
import { enqueue, listPending, markSent, markFailed } from './queue.js';
import { ingestSync, withBackoff } from './uplink.js';
import type { AgentConfig } from './types.js';

function tallyFormattedDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleString('en-US', { month: 'short' }).toLowerCase();
  return `${day}-${month}-${d.getFullYear()}`;
}

// Pulls the current month's data from Tally and queues it. Kept separate
// from uploadPending() so a Tally-side failure (company closed, Tally not
// running) never blocks retrying whatever's already queued from a
// previous successful pull.
export async function pullFromTally(config: AgentConfig): Promise<void> {
  if (!config.sync_config_id || !config.tally_company_name) {
    console.log('[sync] Company not bound in the web app yet — skipping pull.');
    return;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let ledgers, vouchers;
  try {
    ledgers = await fetchLedgers(config.tally_endpoint, config.tally_company_name);
    vouchers = await fetchPurchaseVouchers(
      config.tally_endpoint,
      config.tally_company_name,
      tallyFormattedDate(monthStart),
      tallyFormattedDate(now)
    );
  } catch (err) {
    console.error('[sync] Failed to read from Tally:', (err as Error).message);
    return; // Tally Unreachable — distinct from an upload failure, nothing to queue
  }

  enqueue(config.sync_config_id, ledgers, vouchers);
  console.log(`[sync] Pulled ${ledgers.length} ledgers, ${vouchers.length} purchase vouchers from Tally.`);
}

export async function uploadPending(config: AgentConfig): Promise<void> {
  const pending = listPending();
  if (pending.length === 0) {
    // Nothing queued — still ping the Ingestion API so the heartbeat
    // updates and the Sync Health dashboard doesn't show this agent stale.
    if (config.sync_config_id) {
      try {
        await ingestSync(config.supabase_url, config.agent_token, config.sync_config_id, [], []);
      } catch (err) {
        console.error('[sync] Heartbeat ping failed:', (err as Error).message);
      }
    }
    return;
  }

  for (const job of pending) {
    try {
      const result = await withBackoff(() =>
        ingestSync(config.supabase_url, config.agent_token, job.sync_config_id, job.ledgers, job.vouchers)
      );
      console.log(
        `[sync] Uploaded job ${job.id}: ${result.status} (${result.ledgers_written} ledgers, ${result.vouchers_written} vouchers)`
      );
      markSent(job.id);
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[sync] Job ${job.id} failed after retries:`, message);
      markFailed(job.id, message);
    }
  }
}

export async function runSyncCycle(config: AgentConfig): Promise<void> {
  await pullFromTally(config);
  await uploadPending(config);
}
