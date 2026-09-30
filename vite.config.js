import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Stamped into the bundle at build time. Makes "is the new version actually
// live?" a question you can answer in two seconds instead of guessing from
// bundle hashes.
const BUILD_ID = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __APP_VERSION__: JSON.stringify('v21'),
  },
});
