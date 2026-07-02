import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // Also exclude any stray node_modules_* backup/leftover directories from
      // troubleshooting sessions (see .gitignore, eslint.config.js) so a
      // corrupted leftover can never crash the dev server's file watcher.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/node_modules_*', '**/node_modules_*/**'] },
      fs: { deny: ['**/node_modules_*/**'] },
    },
    build: {
      rollupOptions: {
        output: {
          // Phase 2 (Performance): split rarely-changing vendor libraries
          // into their own chunks, separate from the app's own eagerly-
          // loaded shell code. These vendor chunks stay byte-identical
          // (and therefore browser-cached) across most app deploys, since
          // dependency versions change far less often than app code.
          // Tab-level page components are already code-split automatically
          // via the React.lazy()/dynamic import() boundaries in App.tsx, so
          // they don't need to be listed here.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
              return 'vendor-react';
            }
            if (id.includes('/motion/') || id.includes('/framer-motion/')) {
              return 'vendor-motion';
            }
            if (id.includes('/recharts/') || id.includes('/d3-') || id.includes('/victory-vendor/')) {
              return 'vendor-recharts';
            }
            if (id.includes('/lucide-react/')) {
              return 'vendor-icons';
            }
            return 'vendor';
          },
        },
      },
    },
  };
});
