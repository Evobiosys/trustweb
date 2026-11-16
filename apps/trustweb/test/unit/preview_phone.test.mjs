// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { readFileSync, readdirSync } from 'node:fs'
import { isPhoneShell, phoneRows, phonePress, postVerdict, PHONE_MAX_W } from '../../src/ext/preview-phone/preview_phone.ts'

const f = (key, extra = {}) => ({ key, branch: 'wave44/' + key, title: key.toUpperCase(), requires: [], checked: true, ...extra })

describe('phoneRows', () => {
  it('lists unmerged rows with where, steps, loaded state and the shown verdict', () => {
    const rows = phoneRows([
      f('a', { where: 'Home', steps: ['tap x'], verdict: 'merge' }),
      f('b', { checked: false, verdict: 'needs-work' }),
      f('c', { merged: true }),
      f('d', { checked: false, verdict: 'merge' }),
    ])
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'd'])
    expect(rows[0]).toMatchObject({ title: 'A', where: 'Home', steps: ['tap x'], loaded: true, verdict: 'merge' })
    expect(rows[1]).toMatchObject({ loaded: false, verdict: 'needs-work', where: '', steps: [] })
    expect(rows[2].verdict).toBeNull()   // a merge verdict on an unloaded row is not shown (shownVerdict)
  })
})

describe('phonePress', () => {
  it('like loads the row and approves it; the same press again clears', () => {
    const first = phonePress([f('a', { checked: false })], 'a', 'merge')
    expect(first.verdict).toBe('merge')
    expect(first.features[0]).toMatchObject({ checked: true, verdict: 'merge' })
    expect(phonePress(first.features, 'a', 'merge').verdict).toBeNull()
  })
  it('needs work unloads the row', () => {
    const r = phonePress([f('a')], 'a', 'needs-work')
    expect(r.verdict).toBe('needs-work')
    expect(r.features[0]).toMatchObject({ checked: false, verdict: 'needs-work' })
  })
})

describe('postVerdict', () => {
  it('POSTs the ops route the Mac panel uses; clear for null', async () => {
    const calls = []
    const fetchFn = async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({}) } }
    await postVerdict(fetchFn, 'a', 'merge')
    await postVerdict(fetchFn, 'a', null)
    expect(calls).toEqual([['/__tw/preview/verdict', { feature: 'a', verdict: 'merge' }], ['/__tw/preview/verdict', { feature: 'a', verdict: null }]])
  })
  it('throws the server error text on a failed write', async () => {
    await expect(postVerdict(async () => ({ ok: false, status: 500, json: async () => ({ error: 'locked' }) }), 'a', 'merge')).rejects.toThrow('locked')
  })
})

describe('isPhoneShell', () => {
  it('is the narrow shell only', () => {
    expect(isPhoneShell(360)).toBe(true)
    expect(isPhoneShell(PHONE_MAX_W)).toBe(true)
    expect(isPhoneShell(1280)).toBe(false)
  })
})

describe('never in production', () => {
  const src = (p) => readFileSync(new URL('../../src/' + p, import.meta.url), 'utf8')
  it('main.ts loads the module only behind the __TW_PREVIEW__ define (null in every build)', () => {
    const line = src('main.ts').split('\n').find((l) => l.includes('ext/preview-phone/'))
    expect(line).toMatch(/typeof __TW_PREVIEW__ !== 'undefined' && __TW_PREVIEW__/)
    expect(line).toMatch(/import\('\.\/ext\/preview-phone\/preview_phone'\)/)
  })
  it('nothing else in src imports the module', () => {
    const walk = (d) => readdirSync(new URL('../../src/' + d, import.meta.url), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(d + e.name + '/') : [d + e.name]))
    const users = walk('').filter((p) => /\.(ts|css)$/.test(p) && !p.startsWith('ext/preview-phone/') && /preview-phone\//.test(src(p)))
    expect(users).toEqual(['main.ts'])
  })
})
