// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { parseWhatsApp } from '../../src/import/whatsapp'
import { ContactSource } from '../../src/import/types'

const IOS = [
  '[10.10.24, 09:00:01] Anna: Hi Ben',
  '[10.10.24, 09:02:00] Ben: Hey there',
  '[10.10.24, 09:03:00] Ben: a line that goes on',
  'and continues here without a header',
  '[10.10.24, 09:05:00] Ben: <attached: 00001-PHOTO.jpg>',
  '[10.10.24, 09:06:00] Messages and calls are end-to-end encrypted. No one outside of this chat can read them.',
  '[11.10.24, 10:00:00] Anna: IMG-0002.jpg (file attached)',
  '[11.10.24, 10:01:00] Anna: Ok',
].join('\n')

describe('whatsapp export parser', () => {
  it('counts in and out messages per counterpart, multi-line and media included, system lines skipped', () => {
    const r = parseWhatsApp(IOS, '_chat.txt', { me: 'Ben' })
    expect(r.contacts).toHaveLength(1)
    expect(r.contacts[0].name).toBe('Anna')
    expect(r.contacts[0].source).toBe(ContactSource.WhatsApp)
    const inCount = r.evidence.filter((e) => e.dir === 'in').length
    const outCount = r.evidence.filter((e) => e.dir === 'out').length
    expect(inCount).toBe(3)
    expect(outCount).toBe(3)
  })

  it('stores no message text in any evidence row', () => {
    const r = parseWhatsApp(IOS, '_chat.txt', { me: 'Ben' })
    const json = JSON.stringify(r)
    expect(json).not.toContain('Hi Ben')
    expect(json).not.toContain('Hey there')
    expect(json).not.toContain('PHOTO')
    for (const e of r.evidence) expect(Object.keys(e).sort()).toEqual(['dir', 'id', 'kind', 'personKey', 'ref', 'source', 'ts'])
  })

  it('reads the Android layout', () => {
    const android = [
      '10/10/2024, 09:00 - Anna: Hi',
      '10/10/2024, 09:01 - Ben: Hey',
      '10/10/2024, 09:02 - Ben: Again',
    ].join('\n')
    const r = parseWhatsApp(android, '_chat.txt', { me: 'Ben' })
    expect(r.evidence.filter((e) => e.dir === 'out')).toHaveLength(2)
    expect(r.evidence.filter((e) => e.dir === 'in')).toHaveLength(1)
  })

  it('detects day-first from a day above 12, and reads the timestamp as UTC', () => {
    const r = parseWhatsApp('[25.10.24, 09:00:00] Anna: x', '_chat.txt', { me: 'Ben' })
    expect(r.dateOrder).toBe('dmy')
    expect(r.evidence[0].ts).toBe(Date.UTC(2024, 9, 25, 9, 0, 0))
  })

  it('marks an ambiguous date order and falls back to day-first', () => {
    const r = parseWhatsApp('[01.02.24, 09:00:00] Anna: x', '_chat.txt', { me: 'Ben' })
    expect(r.dateOrder).toBe('ambiguous')
    expect(r.evidence[0].ts).toBe(Date.UTC(2024, 1, 1, 9, 0, 0))
  })

  it('a group chat gives one contact per other sender and no out evidence', () => {
    const group = [
      '[10.10.24, 09:00:00] Anna: a',
      '[10.10.24, 09:01:00] Carl: b',
      '[10.10.24, 09:02:00] Ben: c',
    ].join('\n')
    const r = parseWhatsApp(group, '_chat.txt', { me: 'Ben' })
    expect(r.contacts.map((c) => c.name).sort()).toEqual(['Anna', 'Carl'])
    expect(r.evidence.filter((e) => e.dir === 'out')).toHaveLength(0)
  })
})
