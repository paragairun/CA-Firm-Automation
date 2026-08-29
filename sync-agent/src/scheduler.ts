import { loadConfig, updateConfig } from './config.js';
import { fetchAgentConfig } from './uplink.js';
import { runSyncCycle } from './sync.js';

const FREQUENCY_MS: Record<string, number> = {
  realtime: 5 * 60_000, // "realtime" here means "as fast as this polling agent reasonably can" — every 5 min
  hourly: 60 * 60_000,
  daily: 24 * 60 * 60_000,
};

async function refreshAndRun(): Promise<void> {
  let config = loadConfig();

  try {
    const remote = await fetchAgentConfig(config.supabase_url, config.agent_token);
    if (
      remote.sync_config_id !== config.sync_config_id ||
      remote.tally_company_name !== config.tally_company_name ||
      remote.sync_frequency !== config.sync_frequency
    ) {
      console.log('[scheduler] Picked up updated config from the web app.');
      config = updateConfig({
        sync_config_id: remote.sync_config_id,
        tally_company_name: remote.tally_company_name,
        sync_frequency: remote.sync_frequency,
      });
    }
  } catch (err) {
    console.error('[scheduler] Could not refresh config from the cloud (continuing with last known config):', (err as Error).message);
  }

  await runSyncCycle(config);
}

export function startScheduler(): void {
  const config = loadConfig();
  const intervalMs = FREQUENCY_MS[config.sync_frequency] ?? FREQUENCY_MS.daily;

  console.log(`[scheduler] Starting. Sync frequency: ${config.sync_frequency} (every ${Math.round(intervalMs / 60000)} min).`);

  // Run once immediately, then on the configured interval.
  refreshAndRun().catch((err) => console.error('[scheduler] Cycle failed:', err.message));
  setInterval(() => {
    refreshAndRun().catch((err) => console.error('[scheduler] Cycle failed:', err.message));
  }, intervalMs);
}
