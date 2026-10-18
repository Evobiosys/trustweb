// TrustWeb CRM build config. Own toolchain (node_modules in this directory),
// unlike apps/trustweb which borrows apps/demo's Vite. fs.allow reaches the
// repo root because src/ imports apps/trustweb/src/model.ts and strings.ts.
//
//   npm run dev      dev server on 127.0.0.1:5195
//   npm run build    svelte-check, then dist/ (base /crm/ like /trustweb/)
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')

/** Dev only: ring-suggestions.json next to the dev record (README.txt), else null. */
function suggestionsText(): string | null {
  const file = process.env.TW_CRM_RECORD && path.join(path.dirname(process.env.TW_CRM_RECORD), 'ring-suggestions.json')
  return file && existsSync(file) ? readFileSync(file, 'utf8') : null
}

const cache = path.join(os.homedir(), '.cache', 'trustweb-dev')
const git = (...a: string[]): string => { try { return execFileSync('git', a, { cwd: here, encoding: 'utf8' }).trim() } catch { return '?' } }
const slug = (branch: string): string => branch.replace(/[^\w.-]+/g, '-')

/** Dev only: this branch's build number, +1 at every serve start (the file resets when Jakob says so). */
function nextBuild(branch: string): number {
  const file = path.join(cache, `build-counter-${slug(branch)}`)
  const n = (existsSync(file) ? Number(readFileSync(file, 'utf8')) || 0 : 0) + 1
  mkdirSync(cache, { recursive: true })
  writeFileSync(file, `${n}\n`)
  return n
}

/** Dev only: POST /__tw/approve from the overlay writes approvals/<branch>-<sha>.txt. Loopback peers and same-origin pages only. */
function approvePlugin(): Plugin {
  return {
    name: 'tw-approve',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__tw/approve', (req, res) => {
        const peer = req.socket.remoteAddress ?? ''
        const origin = req.headers.origin
        const sameOrigin = origin === undefined || origin === `http://${req.headers.host}`
        if (req.method !== 'POST' || !/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(peer) || !sameOrigin) { res.statusCode = 403; res.end(); return }
        const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
        const sha = git('rev-parse', '--short', 'HEAD')
        const at = new Date()
        mkdirSync(path.join(cache, 'approvals'), { recursive: true })
        writeFileSync(path.join(cache, 'approvals', `${slug(branch)}-${sha}.txt`), `approved personal preview\nbranch ${branch}\nsha ${sha}\nat ${at.toISOString()}\n`)
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` }))
      })
    },
  }
}

/** Dev only: where the overlay is built from (git at serve start) and whether Jakob's record is loaded. */
function devBuild(): string {
  const d = new Date()
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  return JSON.stringify({ branch, sha: git('rev-parse', '--short', 'HEAD'), time, mode: process.env.TW_CRM_RECORD ? 'personal' : 'stock', stockUrl: process.env.TW_CRM_STOCK_URL ?? '', build: nextBuild(branch) })
}

/** Dev only: the notes bridge's token (scripts/notes_bridge.mjs init) so the developer's own Curator needs no paste. */
function notesToken(): string | null {
  try {
    const file = path.join(process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? '', '.config'), 'trustweb', 'notes-bridge.json')
    return JSON.parse(readFileSync(file, 'utf8')).token ?? null
  } catch { return null }
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.CRM_BASE ?? '/crm/') : '/',
  plugins: [svelte(), approvePlugin()],
  // Dev only: TW_CRM_RECORD=<AppState json> replaces the sample set (README.txt). A build gets null.
  define: {
    __TW_RECORD__: JSON.stringify(command === 'serve' && process.env.TW_CRM_RECORD ? readFileSync(process.env.TW_CRM_RECORD, 'utf8') : null),
    __TW_SUGGESTIONS__: JSON.stringify(command === 'serve' ? suggestionsText() : null),
    __TW_FEATURE__: command === 'serve' ? JSON.stringify({ title: 'Web Curator: people, rings, sort, Tana sync', hint: '' }) : 'null',
    __TW_BUILD__: command === 'serve' ? devBuild() : 'null',
    __TW_TANA_TOKEN__: JSON.stringify(command === 'serve' ? (process.env.TW_CRM_TANA_TOKEN ?? null) : null),
    __TW_NOTES_TOKEN__: JSON.stringify(command === 'serve' ? notesToken() : null),
  },
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.CRM_PORT ?? 5195),
    strictPort: true,
    fs: { allow: [repo] },
  },
}))
