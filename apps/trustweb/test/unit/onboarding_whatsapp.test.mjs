// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { Ring } from '../../src/model.ts'
import { planServices, commitPlan } from '../../src/services_import.ts'
import { showOnboarding, placementFor, placeAll, resultOf, exportSteps, isZip } from '../../src/onboarding_place.ts'

import { parseWhatsApp } from '../../../crm/src/import/whatsapp.ts'

const NOW = Date.UTC(2026, 10, 4)
const row = (o = {}) => ({ key: 'wa:x', name: 'X', source: 'whatsapp', file: 'f', n365: 5, out: 2, in: 3, days: 4, ids: [], sig: 's', ...o })

describe('showOnboarding', () => {
  it('shows only for an empty record that was not dismissed this session', () => {
    expect(showOnboarding({ people: [] }, false)).toBe(true)
    expect(showOnboarding({ people: [] }, true)).toBe(false)
    expect(showOnboarding({ people: [{ id: 'p' }] }, false)).toBe(false)
  })
})

describe('placementFor (steering D1)', () => {
  it('both ways -> Acquaintances', () => expect(placementFor(row()).ring).toBe(Ring.Acquaintance))
  it('only out -> Intending to connect', () => expect(placementFor(row({ in: 0 })).ring).toBe(Ring.Intending))
  it('only in -> not yet sorted', () => expect(placementFor(row({ out: 0 })).ring).toBe(Ring.Unsorted))
  it('group only -> not yet sorted with a note', () => {
    const p = placementFor(row({ group: 'Family chat', out: 0 }))
    expect(p.ring).toBe(Ring.Unsorted)
    expect(p.note).toBe('seen in group Family chat')
  })
  it('both ways on >= 100 days: still Acquaintances, Close allies only suggested', () => {
    const p = placementFor(row({ days: 100 }))
    expect(p.ring).toBe(Ring.Acquaintance)
    expect(p.suggested).toBe(Ring.Close)
    expect(placementFor(row({ days: 99 })).suggested).toBeUndefined()
  })
  it('a one-way row never gets a suggestion', () => expect(placementFor(row({ in: 0, days: 300 })).suggested).toBeUndefined())
  it('nothing in the last year -> not yet sorted', () => expect(placementFor(row({ n365: 0, out: 0, in: 0 })).ring).toBe(Ring.Unsorted))
})

describe('plan: group flag and distinct days', () => {
  const day = (d, who, text = 'hi') => `[${String(d).padStart(2, '0')}.10.26, 09:00:00] ${who}: ${text}`
  const direct = { name: 'WhatsApp Chat with Mira.txt', text: [day(20, 'Mira'), day(20, 'Me Owner'), day(21, 'Mira')].join('\n') }
  const group = { name: 'WhatsApp Chat - Family chat.txt', text: [day(20, 'Gerd'), day(21, 'Gerd'), day(21, 'Mira'), day(22, 'Me Owner')].join('\n') }
  const plan = planServices({ people: [], serviceImports: [] }, [direct, group], { me: 'Me Owner', now: NOW })
  const by = (n) => plan.rows.find((r) => r.name === n)
  it('counts distinct days', () => expect(by('Mira').days).toBe(2))
  it('flags group-only people with the chat name, not people who also wrote directly', () => {
    expect(by('Gerd').group).toBe('Family chat')
    expect(by('Mira').group).toBeUndefined()
  })
  it('a person in a direct chat and in a group stays on Acquaintances (group evidence never raises a ring)', () => {
    const s = { people: [], serviceImports: [] }
    const anna = { name: 'WhatsApp Chat with Anna Both.txt', text: ['[03.10.2026, 18:20:11] Ben: Hallo Anna', '[03.10.2026, 18:25:40] Anna Both: Gut', '[05.10.2026, 09:10:00] Anna Both: Gerne'].join('\n') }
    const gr = { name: 'WhatsApp Chat with Wandergruppe.txt', text: ['[15.10.2026, 20:00:00] Ben: Wer kommt', '[15.10.2026, 20:02:00] Gerda Group: Ich', '[15.10.2026, 20:03:00] Anna Both: Ich auch'].join('\n') }
    const p = planServices(s, [anna, gr], { me: 'Ben', now: NOW })
    commitPlan(s, p, 'b2', NOW)
    placeAll(s, NOW, () => `id${Math.random()}`)
    expect(s.people.find((x) => x.name === 'Anna Both').ring).toBe(Ring.Acquaintance)
  })
  it('placeAll writes the rings and the notes, once', () => {
    const s = { people: [], serviceImports: [] }
    commitPlan(s, plan, 'b1', NOW)
    let n = 0
    const r = placeAll(s, NOW, () => `id${++n}`)
    expect(r).toEqual({ placed: 2, close: 0 })
    const ring = (name) => s.people.find((p) => p.name === name)
    expect(ring('Mira').ring).toBe(Ring.Acquaintance)
    expect(ring('Gerd').ring).toBe(Ring.Unsorted)
    expect(ring('Gerd').context).toMatch(/seen in group Family chat/)
    expect(placeAll(s, NOW, () => 'x')).toEqual({ placed: 0, close: 0 })
  })
})

describe('resultOf', () => {
  it('counts both ways, only wrote to, only in groups', () => {
    const rows = [row(), row({ key: 'b', in: 0 }), row({ key: 'c', group: 'G', out: 0 }), row({ key: 'd', out: 0 })]
    expect(resultOf(rows)).toEqual({ total: 4, both: 1, wroteOnly: 1, groupOnly: 1, chats: 1 })
  })
})

describe('export steps and zip', () => {
  it('picks the wording by platform', () => {
    expect(exportSteps('Mozilla/5.0 (Linux; Android 14)')).toBe('android')
    expect(exportSteps('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('iphone')
    expect(exportSteps('Mozilla/5.0 (Macintosh)')).toBe('desktop')
  })
  it('spots a zip by name', () => {
    expect(isZip('WhatsApp Chat.zip')).toBe(true)
    expect(isZip('_chat.txt')).toBe(false)
  })
})

describe('a chat where only I wrote', () => {
  const text = '[01.10.26, 09:00:00] Me Owner: hello?\n[02.10.26, 09:00:00] Me Owner: anyone?'
  it('takes the counterpart from the file name', () => {
    const r = parseWhatsApp(text, 'WhatsApp Chat with Oskar Oneway.txt', { me: 'Me Owner' })
    expect(r.contacts.map((c) => c.name)).toEqual(['Oskar Oneway'])
    expect(r.evidence.map((e) => e.dir)).toEqual(['out', 'out'])
    expect(r.group).toBe(false)
  })
  it('a file name without a person leaves no contact', () => {
    expect(parseWhatsApp(text, '_chat.txt', { me: 'Me Owner' }).contacts).toEqual([])
  })
})
