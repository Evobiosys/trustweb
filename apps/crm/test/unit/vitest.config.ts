// Unit tests: pure modules only (model, timeline, contacts, storage, sample),
// node environment, no Svelte compile. Run from apps/crm: npm test
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.resolve(here, '../..'),
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
  },
})
