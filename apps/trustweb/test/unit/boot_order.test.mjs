// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Boot order of main.ts: every module-level binding that save() reads must be declared ABOVE the first boot-time save()
// (migration, carry, peer-card repair, dev events), else a record that needs a save at boot throws
// "Cannot access 'autoBackup' before initialization" and the page stays blank (seen 2026-10-28 on the personal preview).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/main.ts'), 'utf8').split('\n')
const lineOf = (re) => src.findIndex((l) => re.test(l))

describe('main.ts boot order', () => {
  it('declares autoBackup before the first top-level boot save()', () => {
    const decl = lineOf(/^let autoBackup\b/)
    const firstBootSave = src.findIndex((l, i) => i > lineOf(/^let state\b/) && /^\s{0,4}(if \(.*\) )?save\(\)/.test(l))
    expect(decl).toBeGreaterThan(-1)
    expect(firstBootSave).toBeGreaterThan(-1)
    expect(decl).toBeLessThan(firstBootSave)
  })
})
