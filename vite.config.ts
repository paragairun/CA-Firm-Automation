import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves this repo at https://pushpaairun.github.io/CA-Firm-Automation/,
// not the domain root — Vite needs to know that to build correct asset URLs.
export default defineConfig({
  plugins: [react()],
  base: '/CA-Firm-Automation/',
});
