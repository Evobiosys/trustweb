// TrustWeb build config. Plain object, no `import { defineConfig } from 'vite'`:
// this app has no node_modules of its own and is built with apps/demo's Vite
// (it imports apps/demo's modules directly), so a bare 'vite' import would not
// resolve from here. Build and dev:
//
//   ../demo/node_modules/.bin/vite build          (from apps/trustweb/); Vite 8 now: ../crm/node_modules/.bin/vite
//   ../demo/node_modules/.bin/vite                (dev server, :5190)
//
// ABSOLUTE base, like apps/demo (see its vite.config.ts): a relative base
// 404s every asset when the page is opened without its trailing slash.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'
import { readyToGo } from './dev_preview_rules.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const crm = path.resolve(here, '../crm')

// The Web Curator (apps/crm, Svelte 5) is mounted as a tab of this app. This app has no node_modules, so the Svelte plugin
// is loaded from the Curator's own, by path. css 'injected': the component styles travel with the lazy chunk (into its shadow root).
const { svelte } = await import(pathToFileURL(path.join(crm, 'node_modules/@sveltejs/vite-plugin-svelte/src/index.js')).href)

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

// Settings > About shows "App version <git short sha>, data format v1" (wave 2, P20).
// A tree with uncommitted changes says so ("-dirty"); no git at all: "dev".
function appVersion() {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: here, encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: here, encoding: 'utf8' }).trim() !== ''
    return /^[0-9a-f]{4,40}$/.test(sha) ? sha + (dirty ? '-dirty' : '') : 'dev'
  } catch {
    return 'dev'
  }
}

// dist/release.json: the release identifier a deploy's health check compares with the commit it meant to ship.
// Outside /assets/, so the server sends it no-cache. TW_RELEASE (CI: the full commit sha) wins over git.
function releaseFile() {
  return {
    name: 'trustweb-release-file',
    generateBundle() {
      let release = process.env.TW_RELEASE ?? ''
      if (!release) {
        try { release = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here, encoding: 'utf8' }).trim() } catch { release = 'dev' }
        if (appVersion().endsWith('-dirty')) release += '-dirty'
      }
      this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify({ release, built_at: new Date().toISOString() }) + '\n' })
    },
  }
}

// Dev only (scripts/tw_dev.sh): a record file every fresh preview origin opens with, instead of the welcome screen. Never in a build.
function devRecord(command) {
  const file = process.env.TW_DEV_RECORD
  return command === 'serve' && file && !process.env.TW_STOCK ? JSON.stringify({ file: path.basename(file), text: readFileSync(file, 'utf8') }) : 'null'
}

// Dev only (scripts/tw_dev.sh, feature.json): the feature overlay text. Never in a build.
const devFeature = (command) => (command === 'serve' && process.env.TW_FEATURE ? process.env.TW_FEATURE : 'null')

const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
const CACHE = path.join(os.homedir(), '.cache/trustweb-dev')
const slug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, '-')
const approvalFile = (branch, sha) => path.join(CACHE, 'approvals', `${slug(branch)}-${sha}.txt`)

// Dev only: the build counter of this branch, up by one at every serve start (the overlay shows it as "NEW <n>").
function bumpBuildCounter(branch) {
  const file = path.join(CACHE, `build-counter-${slug(branch)}`)
  const n = (Number(existsSync(file) ? readFileSync(file, 'utf8') : 0) || 0) + 1
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(file, n + '\n')
  return n
}

// Dev only: "HH:MM" when this branch at this commit was approved in the overlay, else null.
const approvedAt = (branch, sha) => (existsSync(approvalFile(branch, sha)) ? readFileSync(approvalFile(branch, sha), 'utf8').trim().split(' ').pop() : null)

// Dev only: POST /__tw/approve (the overlay's amber button) writes the approval note, then starts the whole check flow detached
// (O/bin/tw_approve_local.sh: tag, push task/<name>, PR, CI, slot); GET /__tw/status is that flow's progress for this branch.
function approveApi() {
  const loopback = (req) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '') && (!req.headers.origin || new URL(req.headers.origin).host === req.headers.host)
  return {
    name: 'trustweb-approve-api',
    configureServer(server) {
      const git = (...a) => execFileSync('git', a, { cwd: here, encoding: 'utf8' }).trim()
      const json = (res, o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)) }
      server.middlewares.use('/__tw/status', (req, res) => {
        if (!loopback(req)) { res.statusCode = 403; res.end(); return }
        const file = path.join(CACHE, 'approvals', slug(git('rev-parse', '--abbrev-ref', 'HEAD')) + '.json')
        json(res, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { step: 'none' })
      })
      server.middlewares.use('/__tw/approve', (req, res) => {
        if (req.method !== 'POST' || !loopback(req)) { res.statusCode = req.method !== 'POST' ? 405 : 403; res.end(); return }
        const [branch, sha] = [git('rev-parse', '--abbrev-ref', 'HEAD'), git('rev-parse', '--short', 'HEAD')]
        const at = hhmm(new Date())
        mkdirSync(path.dirname(approvalFile(branch, sha)), { recursive: true })
        writeFileSync(approvalFile(branch, sha), `approved personal preview ${branch} @ ${sha} ${at}\n`)
        spawn(path.join(process.env.TW_OPS ?? '', 'bin/tw_approve_local.sh'), [path.join(here, '../..')], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref()
        json(res, { at })
      })
    },
  }
}

// Dev only (the `preview` CLI, previews-interface.txt): TW_PREVIEW is the registry file <id>.json of this preview. Never in a build.
const previewFile = () => process.env.TW_PREVIEW ?? ''
const readPreview = () => JSON.parse(readFileSync(previewFile(), 'utf8'))
function devPreview(command) {
  try { return command === 'serve' && previewFile() ? JSON.stringify(readPreview()) : 'null' } catch { return 'null' }
}

// Dev only: GET/POST /__tw/preview* (the preview panel, src/dev_preview.ts) drive the `preview` CLI: $TW_PREVIEW_BIN, else $TW_OPS/bin/preview, else PATH.
const serverStarted = Date.now()

// The waiting page: self-contained (no module imports), so it needs nothing from vite while vite restarts. Polls /__tw/preview and goes to `to`
// once readyToGo (three 200s in a row from a server started after `since`).
function waitPage(id) {
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>restarting</title>
<style>body{margin:0;min-height:100vh;display:grid;place-content:center;gap:10px;text-align:center;background:#241b2e;color:#fff;font:15px system-ui}
b{font:700 18px ui-monospace,monospace;color:#4fd7a0}i{width:22px;height:22px;margin:auto;border:3px solid #4fd7a0;border-right-color:transparent;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
button{font:600 14px system-ui;border:0;border-radius:6px;padding:8px 14px;background:#4fd7a0;color:#241b2e}</style>
<b id=id></b><i id=spin></i><div id=msg></div>
<script>
const readyToGo = ${readyToGo.toString()}
const q = new URLSearchParams(location.search), since = Number(q.get('since')) || 0, t0 = Date.now()
const to = /^\\/(?!\\/)/.test(q.get('to') ?? '') ? q.get('to') : '/'
document.getElementById('id').textContent = ${JSON.stringify(id).replace(/</g, '\\u003c')}
const msg = document.getElementById('msg'), answers = []
async function poll() {
  const s = Math.floor((Date.now() - t0) / 1000)
  if (s >= 120) {
    document.getElementById('spin').remove()
    msg.textContent = 'server did not come back '
    const b = msg.appendChild(document.createElement('button')); b.textContent = 'Retry'; b.onclick = () => location.reload()
    return
  }
  msg.textContent = 'server restarting... ' + s + ' s'
  try {
    const r = await fetch('/__tw/preview', { cache: 'no-store' })
    answers.push({ status: r.status, serverStarted: r.ok ? (await r.json()).serverStarted : undefined })
  } catch { answers.push({ status: 0 }) }
  if (readyToGo(answers, since)) { location.replace(to); return }
  setTimeout(poll, 500)
}
poll()
</script>`
}

function previewApi() {
  const loopback = (req) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '') && (!req.headers.origin || new URL(req.headers.origin).host === req.headers.host)
  const bin = () => process.env.TW_PREVIEW_BIN ?? (process.env.TW_OPS ? path.join(process.env.TW_OPS, 'bin/preview') : 'preview')
  const body = (req) => new Promise((resolve) => {
    let text = ''
    req.on('data', (c) => { text += c })
    req.on('end', () => { try { resolve(JSON.parse(text)) } catch { resolve(null) } })
  })
  return {
    name: 'trustweb-preview-api',
    configureServer(server) {
      if (!previewFile()) return
      const json = (res, o, code = 200) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)) }
      const run = (args) => {
        try {
          execFileSync(bin(), [readPreview().id, ...args], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] })
          return null
        } catch (e) { return String(e.stderr || e.message).trim().slice(-600) }
      }
      server.middlewares.use('/__tw/wait', (req, res) => {
        if (!loopback(req)) { res.statusCode = 403; res.end(); return }
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(waitPage(readPreview().id))
      })
      server.middlewares.use('/__tw/preview', async (req, res) => {
        if (!loopback(req)) { res.statusCode = 403; res.end(); return }
        const sub = (req.url ?? '/').split('?')[0]
        if (req.method === 'GET' && sub === '/') { json(res, { ...readPreview(), serverStarted }); return }
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        if (sub === '/pr' || sub === '/test') {
          spawn(bin(), [readPreview().id, sub.slice(1)], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref()
          json(res, { started: true })
          return
        }
        const b = await body(req)
        let args = null
        if (sub === '/' && typeof b?.feature === 'string' && typeof b.checked === 'boolean' && readPreview().features.some((f) => f.key === b.feature)) args = ['toggle', b.feature, b.checked ? 'on' : 'off']
        const keys = readPreview().features.map((f) => f.key)
        if (sub === '/' && b?.set && keys.length === Object.keys(b.set).length && keys.every((k) => typeof b.set[k] === 'boolean')) args = ['set', keys.map((k) => `${k}=${b.set[k] ? 'on' : 'off'}`).join(',')]
        if (sub === '/mode' && (b?.mode === 'personal' || b?.mode === 'stock')) args = ['mode', b.mode]
        if (!args) { json(res, { error: 'bad request' }, 400); return }
        const error = run(args)
        if (error !== null) json(res, { error }, 500)
        else json(res, readPreview())
      })
    },
  }
}

// Dev only: where the overlay is built from (git at serve start), personal or stock, and the stock twin's URL.
function devBuild(command) {
  if (command !== 'serve') return 'null'
  const git = (...a) => { try { return execFileSync('git', a, { cwd: here, encoding: 'utf8' }).trim() } catch { return '?' } }
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  const sha = git('rev-parse', '--short', 'HEAD')
  return JSON.stringify({ branch, sha, time: hhmm(new Date()), n: bumpBuildCounter(branch), approved: approvedAt(branch, sha), mode: process.env.TW_STOCK ? 'stock' : 'personal', stockUrl: process.env.TW_STOCK_URL ?? '' })
}

// Dev only: ring-suggestions.json next to the dev record (the Curator's sort cards), else null.
function devSuggestions(command) {
  const file = process.env.TW_DEV_RECORD && !process.env.TW_STOCK && path.join(path.dirname(process.env.TW_DEV_RECORD), 'ring-suggestions.json')
  return command === 'serve' && file && existsSync(file) ? readFileSync(file, 'utf8') : null
}

export default ({ command }) => ({
  resolve: { alias: { '@web-curator': path.join(crm, 'src/embed.ts') } },
  // Svelte lives in apps/crm/node_modules: pre-bundled it would be a second runtime next to the one the Curator's own modules import.
  optimizeDeps: { exclude: ['svelte'] },
  define: {
    // The Curator's build-time hooks (apps/crm/vite.config.ts): its record is this app's (src/curator.ts), so no record file of its own.
    __TW_RECORD__: 'null',
    __TW_SUGGESTIONS__: JSON.stringify(devSuggestions(command)),
    __TW_TANA_TOKEN__: JSON.stringify(command === 'serve' ? (process.env.TW_CRM_TANA_TOKEN ?? null) : null), __APP_VERSION__: JSON.stringify(appVersion()), __TW_DEV_RECORD__: devRecord(command), __TW_FEATURE__: devFeature(command), __TW_PREVIEW__: devPreview(command), __TW_BUILD__: devBuild(command) },
  plugins: [svelte({ configFile: false, compilerOptions: { css: 'injected' } }), pwaFiles(), releaseFile(), ...(command === 'serve' ? [approveApi(), previewApi()] : [])],
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
