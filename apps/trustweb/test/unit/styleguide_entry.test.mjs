// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
describe('styleguide entry', () => {
  it('is a vite input', () => expect(read('../../vite.config.mjs')).toMatch(/styleguide:\s*path\.resolve\(here, 'styleguide(\/index)?\.html'\)/))
  it('carries the boot block', () => expect(read('../../styleguide.html')).toContain('<!-- boot:theme -->'))
  it('boot block is the same as index.html', () => {
    const block = (s) => s.slice(s.indexOf('<!-- boot:theme -->'), s.indexOf('<!-- /boot:theme -->'))
    expect(block(read('../../styleguide.html'))).toBe(block(read('../../index.html')))
  })
  it('never imports app state', () => expect(read('../../src/styleguide.ts')).not.toMatch(/from '\.\/(main|state|store|model)'/))
  it('never mentions a dev record', () => expect(read('../../src/styleguide.ts')).not.toMatch(/TW_DEV_RECORD|dev-record/))
  it('has every section the e2e and the plan name', () => {
    const html = read('../../styleguide.html')
    for (const id of ['tokens', 'type', 'shape', 'rings', 'path', 'motion', 'voice']) expect(html).toContain(`id="${id}"`)
  })
})
