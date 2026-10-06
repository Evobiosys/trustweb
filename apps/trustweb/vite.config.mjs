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
import { readFileSync } from 'node:fs'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')

// The install files (wave 1733, item 5): the web app manifest and its icons,
// kept in pwa/ and served at the app's root under fixed names, in dev and in
// the build alike. Not through publicDir: tests point TW_PUBLIC_DIR elsewhere.
// Fixed names, not hashed: the live server sends no-cache for everything
// outside /assets/, so a changed icon is picked up (only /assets/ is immutable).
// No service worker: the app had stale-cache trouble before, and Chromium's
// install prompt no longer needs one.
const PWA_DIR = path.resolve(here, 'pwa')
const PWA_FILES = {
  'manifest.json': 'application/manifest+json',
  'icons/icon-192.png': 'image/png',
  'icons/icon-512.png': 'image/png',
  'icons/icon-maskable-512.png': 'image/png',
  'icons/apple-touch-icon.png': 'image/png',
}

function pwaFiles() {
  return {
    name: 'trustweb-pwa-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = (req.url ?? '').split('?')[0].replace(/^\//, '')
        const type = Object.hasOwn(PWA_FILES, file) ? PWA_FILES[file] : null
        if (!type) { next(); return }
        res.setHeader('Content-Type', type)
        res.setHeader('Cache-Control', 'no-cache')
        res.end(readFileSync(path.join(PWA_DIR, file)))
      })
    },
    generateBundle() {
      for (const file of Object.keys(PWA_FILES)) {
        this.emitFile({ type: 'asset', fileName: file, source: readFileSync(path.join(PWA_DIR, file)) })
      }
    },
  }
}

export default ({ command }) => ({
  plugins: [pwaFiles()],
  base: command === 'build' ? (process.env.TW_BASE ?? '/trustweb/') : '/',
  // No public/ directory of its own (nothing extra is ever copied into dist/).
  // Tests point TW_PUBLIC_DIR at a scratch directory to serve demo-peer.json,
  // the demo inventory peer's card (services/trustweb-peer), next to the app.
  publicDir: process.env.TW_PUBLIC_DIR ?? false,
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(here, 'index.html'),
        solo: path.resolve(here, 'solo.html'),
        // Three demo-context entries, one build, context chosen by path
        // (solo.ts detectContext() reads location.pathname at runtime; all
        // three load the same compiled src/solo.ts, deduped by Rollup).
        // Each lives at its own directory so it lands at dist/<name>/index.html
        // and is reachable at app.idea2.site/trustweb/<name> (Caddy's
        // file_server canonical_uris 308s the bare path to the trailing
        // slash and serves that index.html -- see /wot/demo1 for the same
        // pattern already live).
        demo: path.resolve(here, 'demo/index.html'),
        emergentDemo: path.resolve(here, 'emergent-demo/index.html'),
        eaDemo: path.resolve(here, 'ea-demo/index.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.TW_PORT ?? 5190),
    fs: { allow: [repo] },
    // Dev/test proxies, all same-origin so no CORS and no Origin exception:
    //   /relay     -> a RelayServer (TW_RELAY_PROXY; see test/e2e/acceptance.mjs)
    //   /backup    -> services/trustweb-backup (TW_BACKUP_PROXY, e.g. http://127.0.0.1:8960)
    //   /talkweave -> a local TalkWeave (TW_TALKWEAVE_PROXY, e.g. http://127.0.0.1:8990),
    //                 prefix stripped and Origin dropped, so TalkWeave's own
    //                 "reject any Origin" rule for local services stays intact.
    proxy: {
      ...(process.env.TW_RELAY_PROXY
        ? { '/relay': { target: process.env.TW_RELAY_PROXY, ws: true, changeOrigin: true } }
        : {}),
      // The same server answers the hosted recordings, transcription and feedback (wave 1733 round B),
      // same-origin as on app.idea2.site, so the app sends no Origin the server would refuse.
      ...(process.env.TW_BACKUP_PROXY
        ? Object.fromEntries(['/backup', '/hosted', '/transcribe', '/feedback'].map((prefix) => [prefix, { target: process.env.TW_BACKUP_PROXY, changeOrigin: true }]))
        : {}),
      // Only the mic routes and the availability probe: TalkWeave's other
      // routes (sessions, ask) have no auth and must not be reachable here.
      ...(process.env.TW_TALKWEAVE_PROXY
        ? Object.fromEntries(['/talkweave/api/mic/', '/talkweave/api/whisper/available'].map((prefix) => [prefix, {
            target: process.env.TW_TALKWEAVE_PROXY,
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/talkweave/, ''),
            configure: (proxy) => { proxy.on('proxyReq', (req) => req.removeHeader('origin')) },
          }]))
        : {}),
    },
  },
})
