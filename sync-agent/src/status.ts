// `npm run status` — prints a human-readable snapshot of this agent's
// pairing state, sync assignment, and queue backlog. This is the
// substitute for the spec's system-tray companion app (§8.1): a status
// icon and "Sync now" button need native GUI bindings (Electron/Tauri),
// which is a separate, much heavier piece of software than this Node
// agent takes on. This CLI answers the same question — "is this
// working?" — without that.

import { isPaired, loadConfig } from './config.js';
import { listPending } from './queue.js';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

if (!isPaired()) {
  console.log('Status: NOT PAIRED');
  console.log('Run `npm run pair` to get started.');
  process.exit(0);
}

const config = loadConfig();
const pending = listPending();

console.log('PracticeOS Sync Agent — status');
console.log('--------------------------------');
console.log(`Agent ID:        ${config.agent_id}`);
console.log(`Client ID:       ${config.client_id}`);
console.log(`Tally endpoint:  ${config.tally_endpoint}`);
console.log(`Tally company:   ${config.tally_company_name ?? '(not bound yet)'}`);
console.log(`Sync config ID:  ${config.sync_config_id ?? '(not bound yet — see web app)'}`);
console.log(`Sync frequency:  ${config.sync_frequency}`);
console.log(`Pending uploads: ${pending.length}`);
if (pending.length > 0) {
  const oldestJob = pending.reduce((oldest, j) => (j.created_at < oldest.created_at ? j : oldest));
  console.log(`  Oldest pending job queued: ${timeAgo(oldestJob.created_at)}`);
  const failing = pending.filter((j) => j.attempts > 0);
  if (failing.length > 0) {
    console.log(`  ${failing.length} job(s) have failed at least once — check their last_error in queue.json`);
  }
}
