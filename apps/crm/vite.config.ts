// TrustWeb CRM build config. Own toolchain (node_modules in this directory),
// unlike apps/trustweb which borrows apps/demo's Vite. fs.allow reaches the
// repo root because src/ imports apps/trustweb/src/model.ts and strings.ts.
//
//   npm run dev      dev server on 127.0.0.1:5195
//   npm run build    svelte-check, then dist/ (base /crm/ like /trustweb/)
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')

/** Dev only: ring-suggestions.json next to the dev record (README.txt), else null. */
function suggestionsText(): string | null {
  const file = process.env.TW_CRM_RECORD && path.join(path.dirname(process.env.TW_CRM_RECORD), 'ring-suggestions.json')
  return file && existsSync(file) ? readFileSync(file, 'utf8') : null
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.CRM_BASE ?? '/crm/') : '/',
  plugins: [svelte()],
  // Dev only: TW_CRM_RECORD=<AppState json> replaces the sample set (README.txt). A build gets null.
  define: {
    __TW_RECORD__: JSON.stringify(command === 'serve' && process.env.TW_CRM_RECORD ? readFileSync(process.env.TW_CRM_RECORD, 'utf8') : null),
    __TW_SUGGESTIONS__: JSON.stringify(command === 'serve' ? suggestionsText() : null),
    __TW_TANA_TOKEN__: JSON.stringify(command === 'serve' ? (process.env.TW_CRM_TANA_TOKEN ?? null) : null),
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
