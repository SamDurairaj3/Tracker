import { defineConfig } from 'vite';

// Original Worker config is retained in archive/d1/vite.config.ts.
// Fail before loading Cloudflare/Sites plugins or touching their local state.
export default defineConfig(() => {
  throw new Error(
    'Tracker now requires Node.js and PostgreSQL. Use pnpm dev/build/start. ' +
    'The preserved Cloudflare/Sites configuration cannot host this database layer.',
  );
});
