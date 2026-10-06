// TrustWeb CRM build config. Own toolchain (node_modules in this directory),
// unlike apps/trustweb which borrows apps/demo's Vite. fs.allow reaches the
// repo root because src/ imports apps/trustweb/src/model.ts and strings.ts.
//
//   npm run dev      dev server on 127.0.0.1:5195
//   npm run build    svelte-check, then dist/ (base /crm/ like /trustweb/)
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')

export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.CRM_BASE ?? '/crm/') : '/',
  plugins: [svelte()],
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
