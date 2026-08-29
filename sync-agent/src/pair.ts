// One-time setup: `npm run pair` (or `npm run dev:pair` from source).
// Prompts for the pairing code shown in the web app's "Connect Tally"
// button (Client Detail → Overview) and exchanges it for a permanent
// bearer token via the agent-pair Edge Function.
//
// After this, an Admin/Partner/Audit Manager still needs to bind this
// agent to a specific tally_sync_configs row in the web app (spec §3.3
// step 2, "Company binding") — there's no dedicated UI for that step yet
// (see README), so for now it means creating that row directly (Supabase
// Studio or a short script) with this pairing's agent_id and the exact
// Tally company name. Until that's done, the agent runs but has nothing
// to sync (see sync.ts's "Company not bound yet" skip).

import { createInterface } from 'node:readline/promises';
import { hostname, platform, arch } from 'node:os';
import { createHash } from 'node:crypto';
import { pairWithCode } from './uplink.js';
import { saveConfig, isPaired } from './config.js';

const AGENT_VERSION = '0.1.0';

function machineFingerprint(): string {
  return createHash('sha256').update(`${hostname()}-${platform()}-${arch()}`).digest('hex').slice(0, 16);
}

async function main() {
  if (isPaired()) {
    console.log('This machine is already paired. Delete ~/.practiceos-agent/config.json to re-pair.');
    process.exit(0);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const supabaseUrl = (await rl.question('Supabase project URL (e.g. https://xxxx.supabase.co): ')).trim();
  const pairingCode = (await rl.question('Pairing code (from the web app\'s "Connect Tally" button): ')).trim();
  const tallyEndpoint = (await rl.question('Tally endpoint [http://localhost:9000]: ')).trim() || 'http://localhost:9000';
  const tallyCompanyName = (await rl.question('Exact Tally company name (as shown in Tally): ')).trim();
  rl.close();

  console.log('Pairing...');
  const result = await pairWithCode(supabaseUrl, pairingCode, machineFingerprint(), AGENT_VERSION);

  saveConfig({
    supabase_url: supabaseUrl,
    supabase_anon_key: '', // not needed by the agent — it authenticates with its own bearer token, not the anon key
    agent_id: result.agent_id,
    client_id: result.client_id,
    agent_token: result.token,
    tally_endpoint: tallyEndpoint,
    tally_company_name: tallyCompanyName || null,
    sync_config_id: null, // set once an Admin binds this agent to a sync config in the web app
    sync_frequency: 'daily',
  });

  console.log(`Paired. Agent ID: ${result.agent_id}`);
  console.log('Next: have an Admin/Partner bind this agent to a Tally sync config in the web app, then run `npm start`.');
}

main().catch((err) => {
  console.error('Pairing failed:', err.message);
  process.exit(1);
});
