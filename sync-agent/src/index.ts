import { isPaired } from './config.js';
import { startScheduler } from './scheduler.js';

if (!isPaired()) {
  console.error('Agent is not paired. Run `npm run pair` first.');
  process.exit(1);
}

console.log('PracticeOS Sync Agent starting...');
startScheduler();

// Keep the process alive — startScheduler's setInterval does the actual
// work. When packaged as a Windows service (see README), the service
// wrapper manages process lifecycle (start/stop/restart on crash); run
// directly with Node otherwise, e.g. under pm2 or nssm.
process.on('SIGINT', () => {
  console.log('Shutting down.');
  process.exit(0);
});
