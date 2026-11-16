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

  // Wave 44 steer-event-visibility-3: a record that migrates at boot (home-dashboard schema 3) saves before eventEnv exists; every `let`
  // save() reads must sit above that first save, or the migration rolls back with a TDZ error.
  it('declares every let that save() reads above the first boot-time save()', () => {
    const firstBootSave = src.findIndex((l, i) => i > lineOf(/^let state\b/) && /^\s{0,4}(if \(.*\) )?save\(\)/.test(l))
    const saveBody = src.slice(lineOf(/^function save\(\)/), lineOf(/^function mirrorPushBundle/)).join('\n')
    const mirror = src.slice(lineOf(/^function mirrorPushBundle/), lineOf(/^function writePushBundleNow/)).join('\n')
    const reads = ['announceDue', 'autoBackup', 'superseded'].concat(/\bmirrorTimer\b/.test(mirror) ? ['mirrorTimer'] : [])
    for (const name of reads) {
      expect(new RegExp(`\\b${name}\\b`).test(saveBody + mirror)).toBe(true)
      const decl = lineOf(new RegExp(`^let ${name}\\b`))
      expect(decl, name).toBeGreaterThan(-1)
      expect(decl, name).toBeLessThan(firstBootSave)
    }
  })
})
