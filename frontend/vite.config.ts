import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import { serviceWorkerPlugin } from './build/sw-plugin.ts';

const frontendDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Local PHP server (see projet.md section 4.2: PHP_CLI_SERVER_WORKERS=8 php -S localhost:8000 index.php).
const backend = 'http://localhost:8000';

// The dev proxy streams responses as they arrive (no compression, no buffering), which is
// what Server-Sent Events need (/api/v1/stream sends `Content-Type: text/event-stream`).
// Never add a compression middleware in front of these routes, and keep the timeout
// disabled so long-lived SSE / long-polling connections are not cut by the proxy.
const proxyRoute = { target: backend, changeOrigin: false, timeout: 0, proxyTimeout: 0 };

export default defineConfig({
  root: frontendDir,
  // Relative base: the app can be installed in any sub-folder of the host (base_path).
  base: './',
  publicDir: 'public',
  resolve: {
    alias: {
      // Shared translation files (also read by PHP), outside the frontend root.
      $i18n: `${repoRoot}i18n`,
    },
  },
  plugins: [svelte(), serviceWorkerPlugin({ source: 'sw/sw.ts', output: '../sw.js' })],
  build: {
    outDir: '../assets',
    emptyOutDir: true,
    // Files go directly into ../assets (no nested assets/assets folder).
    assetsDir: '',
    manifest: 'vite-manifest.json',
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: {
      // No index.html in production: the PHP shell reads vite-manifest.json (key "src/main.ts").
      input: `${frontendDir}src/main.ts`,
      output: {
        entryFileNames: '[name]-[hash].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': proxyRoute,
      '/index.php': proxyRoute,
      '/install.php': proxyRoute,
      '/update.php': proxyRoute,
    },
    fs: {
      // Allow importing ../i18n/fr.json (shared with PHP).
      allow: ['..'],
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
