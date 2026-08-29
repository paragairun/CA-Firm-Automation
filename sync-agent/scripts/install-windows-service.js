// Registers the Sync Agent as a Windows Service using node-windows, so it
// starts on boot and restarts automatically on crash (spec §8.1).
//
// This only does anything useful on Windows — node-windows itself is a
// no-op (or errors) on other platforms. Not run automatically; a human
// runs this deliberately once, after `npm run build` and `npm run pair`
// have already succeeded.
//
// Usage:
//   npm install node-windows --save-optional   (not a hard dependency —
//     most development and testing of this repo happens off Windows, so
//     it isn't in package.json's regular dependencies)
//   node scripts/install-windows-service.js install
//   node scripts/install-windows-service.js uninstall

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, '..', 'dist', 'index.js');
const action = process.argv[2];

if (action !== 'install' && action !== 'uninstall') {
  console.error('Usage: node scripts/install-windows-service.js <install|uninstall>');
  process.exit(1);
}

let Service;
try {
  // Dynamic import so this file doesn't break `npm install` / normal
  // agent operation on non-Windows machines that never installed
  // node-windows in the first place.
  ({ Service } = await import('node-windows'));
} catch {
  console.error(
    'node-windows is not installed. Run: npm install node-windows --save-optional\n' +
      '(Only meaningful on Windows — this script is a no-op elsewhere.)'
  );
  process.exit(1);
}

const svc = new Service({
  name: 'PracticeOS Sync Agent',
  description: 'Bridges an on-premise Tally Prime instance to PracticeOS.',
  script: scriptPath,
});

svc.on('install', () => {
  console.log('Service installed. Starting...');
  svc.start();
});
svc.on('start', () => console.log('Service started.'));
svc.on('uninstall', () => console.log('Service uninstalled.'));
svc.on('error', (err) => console.error('Service error:', err));

if (action === 'install') {
  svc.install();
} else {
  svc.uninstall();
}
