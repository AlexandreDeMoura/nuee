import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Read the workspace source directly so dev, tests, and builds never
      // depend on a prebuilt shared/dist that could be stale.
      '@nuee/shared-types': fileURLToPath(
        new URL('../shared/src/index.ts', import.meta.url),
      ),
    },
  },
});
