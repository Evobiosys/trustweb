// TrustWeb build config. Plain object, no `import { defineConfig } from 'vite'`:
// this app has no node_modules of its own and is built with apps/demo's Vite
// (it imports apps/demo's modules directly), so a bare 'vite' import would not
// resolve from here. Build and dev:
//
//   ../demo/node_modules/.bin/vite build          (from apps/trustweb/)
//   ../demo/node_modules/.bin/vite                (dev server, :5190)
//
// ABSOLUTE base, like apps/demo (see its vite.config.ts): a relative base
// 404s every asset when the page is opened without its trailing slash.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')

export default ({ command }) => ({
  base: command === 'build' ? (process.env.TW_BASE ?? '/trustweb/') : '/',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(here, 'index.html'),
        solo: path.resolve(here, 'solo.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.TW_PORT ?? 5190),
    fs: { allow: [repo] },
    // Test-only: point /relay at a local RelayServer (see test/e2e/acceptance.mjs).
    proxy: process.env.TW_RELAY_PROXY
      ? { '/relay': { target: process.env.TW_RELAY_PROXY, ws: true, changeOrigin: true } }
      : undefined,
  },
})
