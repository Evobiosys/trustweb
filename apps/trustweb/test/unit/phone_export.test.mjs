// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 wabridge-ingest: the phone-export JSON goes through the EXISTING plan / placement, on an invented export. */
import { Ring } from '../../src/model.ts'
import { planServices, commitPlan } from '../../src/services_import.ts'
import { placeAll } from '../../src/onboarding_place.ts'
import { isPhoneExport, phoneMessageCount, namesSource, unnamedPeople, withNames } from '../../src/phone_export.ts'

const NOW = Date.UTC(2026, 10, 4)
const H = 3_600_000
const msg = (chat, sender, fromMe, hoursAgo, text) => ({ chat, sender, from_me: fromMe, ts: NOW - hoursAgo * H, kind: 'text', has_media: false, text_len: (text ?? 'hi').length, ...(text ? { text } : {}) })

function fixture({ withText = false } = {}) {
  const messages = []
  for (let d = 0; d < 40; d++) {
    messages.push(msg('111@s.whatsapp.net', null, d % 2 === 0, d * 24 + 5))
    messages.push(msg('111@s.whatsapp.net', '111@s.whatsapp.net', false, d * 24 + 4.9))
  }
  messages.push(msg('222@s.whatsapp.net', null, true, 30)) // only I wrote to Bea
  messages.push(msg('999-1@g.us', '333@s.whatsapp.net', false, 20)) // Cem only in a group
  messages.push(msg('999-1@g.us', '111@s.whatsapp.net', false, 19))
  if (withText) messages.push(msg('222@s.whatsapp.net', '222@s.whatsapp.net', false, 29, 'Kann ich dir den Bohrer leihen?'))
  return {
    contacts: [{ jid: '111@s.whatsapp.net', name: 'Ana Test', phone: '111' }, { jid: '222@s.whatsapp.net', name: 'Bea Test', phone: '222' }, { jid: '333@s.whatsapp.net', name: 'Cem Test', phone: '333' }],
    chats: [
      { jid: '111@s.whatsapp.net', name: 'Ana Test', is_group: false, participants: [] },
      { jid: '222@s.whatsapp.net', name: 'Bea Test', is_group: false, participants: [] },
      { jid: '999-1@g.us', name: 'Choir', is_group: true, participants: ['111@s.whatsapp.net', '333@s.whatsapp.net'] },
    ],
    messages,
  }
}
const file = (o) => ({ name: 'whatsapp-phone-export.json', text: JSON.stringify(o) })
const plan = (o) => planServices({ people: [], serviceImports: [] }, [file(o)], { me: 'Me Owner', now: NOW })

describe('isPhoneExport / phoneMessageCount', () => {
  it('recognises the export and rejects other JSON and text', () => {
    expect(isPhoneExport(file(fixture()).text)).toBe(true)
    expect(isPhoneExport('{"a":1}')).toBe(false)
    expect(isPhoneExport('[12.10.26, 09:00] Mira: hi')).toBe(false)
    expect(isPhoneExport('{broken')).toBe(false)
  })
  it('counts the messages', () => expect(phoneMessageCount(file(fixture()).text)).toBe(fixture().messages.length))
})

describe('planServices on a phone export', () => {
  const p = plan(fixture())
  const by = (name) => p.rows.find((r) => r.name === name)
  it('lists one whatsapp row per person with the existing evidence summary', () => {
    expect(p.counts.whatsapp).toBe(3)
    expect(by('Ana Test')).toMatchObject({ source: 'whatsapp', out: 20, in: 61 })
    expect(by('Bea Test')).toMatchObject({ out: 1, in: 0 })
  })
  it('a person only in a group carries the group name', () => {
    expect(by('Cem Test').group).toBe('Choir')
    expect(by('Ana Test').group).toBeUndefined()
  })
  it('adds a closeness score from the interaction signals', () => {
    expect(by('Ana Test').closeness).toBeGreaterThan(by('Bea Test').closeness)
    expect(by('Ana Test').closeness).toBeGreaterThan(0.35)
  })
  it('placeAll uses the existing placement: Ana Acquaintances, Bea Intending, Cem not yet sorted', () => {
    const s = { people: [], serviceImports: [] }
    commitPlan(s, plan(fixture()), 'b1', NOW)
    expect(placeAll(s, NOW, (() => { let i = 0; return () => `id${i++}` })()).placed).toBe(3)
    const ring = (n) => s.people.find((x) => x.name === n).ring
    expect([ring('Ana Test'), ring('Bea Test'), ring('Cem Test')]).toEqual([Ring.Acquaintance, Ring.Intending, Ring.Unsorted])
  })
  it('never keeps message text on a row (I1)', () => {
    const q = plan(fixture({ withText: true }))
    expect(JSON.stringify(q.rows)).not.toContain('Bohrer leihen')
  })
})

describe('inventory guesses from an export with text', () => {
  it('become inferred peer items of the person, marked inferred, with no text kept', () => {
    const s = { people: [], serviceImports: [] }
    commitPlan(s, plan(fixture({ withText: true })), 'b1', NOW)
    placeAll(s, NOW, (() => { let i = 0; return () => `id${i++}` })())
    const bea = s.people.find((x) => x.name === 'Bea Test')
    expect(s.peerItems).toHaveLength(1)
    expect(s.peerItems[0]).toMatchObject({ kind: 'peer_item', personId: bea.id, title: 'Bohrer', inferred: true })
  })
  it('an export without text proposes nothing', () => {
    const s = { people: [], serviceImports: [] }
    commitPlan(s, plan(fixture()), 'b1', NOW)
    placeAll(s, NOW, () => 'x')
    expect(s.peerItems ?? []).toEqual([])
  })
})

describe('names source and naming a number (wabridge-ingest, contacts)', () => {
  const numbersOnly = () => {
    const f = fixture()
    f.contacts[1].name = null // Bea: number only
    f.chats[1].name = null
    return f
  }
  it('reads which name source the JSON carries', () => {
    expect(namesSource(JSON.stringify({ ...fixture(), names_source: 'phone_contacts' }))).toBe('phone_contacts')
    expect(namesSource(JSON.stringify({ ...fixture(), names_source: 'numbers_only' }))).toBe('numbers_only')
    expect(namesSource(JSON.stringify(fixture()))).toBe('numbers_only')
    expect(namesSource('[12.10.26, 09:00] Mira: hi')).toBeNull()
  })
  it('a person without a name shows the number as the placeholder, the ring guess stays', () => {
    const p = plan(numbersOnly())
    const row = p.rows.find((r) => r.name === '+222')
    expect(row).toMatchObject({ source: 'whatsapp', out: 1 })
    const s = { people: [], serviceImports: [] }
    commitPlan(s, p, 'b1', NOW)
    placeAll(s, NOW, (() => { let i = 0; return () => `id${i++}` })())
    expect(s.people.find((x) => x.name === '+222').ring).toBe(Ring.Intending)
  })
  it('lists the people with no name, by number', () => {
    expect(unnamedPeople(file(numbersOnly()).text)).toEqual([{ jid: '222@s.whatsapp.net', phone: '222' }])
    expect(unnamedPeople(file(fixture()).text)).toEqual([])
  })
  it('naming one writes the name into the JSON and the plan keeps the same ring guess', () => {
    const text = withNames(file(numbersOnly()).text, { '222@s.whatsapp.net': ' Bea Neu ' })
    expect(unnamedPeople(text)).toEqual([])
    const p = planServices({ people: [], serviceImports: [] }, [{ name: 'x.json', text }], { me: 'Me Owner', now: NOW })
    expect(p.rows.find((r) => r.name === 'Bea Neu')).toMatchObject({ out: 1, in: 0 })
    expect(withNames(file(numbersOnly()).text, { '222@s.whatsapp.net': '  ' })).toBe(file(numbersOnly()).text)
  })
})
