// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40: how a support ask reaches each person: in the app, on their linked messenger, by e-mail as the fallback. */
import { planDelivery, messengerOpen, emailLink, deliverySummary, deliveryText, markSent, sentVia } from '../../src/support_delivery.ts'
import { EMAIL_FIELD } from '../../src/intending_reminder.ts'
import { S } from '../../src/strings.ts'

const p = (id, extra = {}) => ({ id, name: `${id} Test`, peerId: 'peer-' + id, ring: 'closest', fields: {}, ...extra })
const DID = 'did:peer:2.Az6MkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.Vz6MkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.EzDnaeBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const sig = '+436601234567'
const people = [
  p('a', { channels: { signal: sig } }),
  p('b', { channels: { whatsapp: '+4366012345', signal: sig } }),
  p('c', { channels: { whatsapp: '+4366012345' } }),
  p('d', { channels: { consensual: `https://app.consensu.al/connect?to=${DID}` } }),
  p('e', { fields: { [EMAIL_FIELD]: 'e@example.org' } }),
  p('f', { fields: { [EMAIL_FIELD]: 'f@example.org' }, channels: { signal: sig } }),
  p('g'),
]
const ids = (l) => l.map((x) => x.personId)

describe('planDelivery', () => {
  const plan = planDelivery(people)
  it('everybody gets the in-app entry', () => expect(ids(plan.inApp)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']))
  it('a linked messenger wins over e-mail; Signal before WhatsApp before Geb', () => {
    expect(plan.groups.map((g) => [g.via, ids(g.items)])).toEqual([
      ['signal', ['a', 'b', 'f']], ['whatsapp', ['c']], ['geb', ['d']], ['email', ['e']],
    ])
  })
  it('somebody with neither stays in the app only', () => {
    expect(plan.groups.flatMap((g) => ids(g.items))).not.toContain('g')
  })
  it('the messenger pinned for a person goes first', () => {
    const q = planDelivery([p('b', { channels: { whatsapp: '+4366012345', signal: sig }, chatPin: 'whatsapp' })])
    expect(q.groups.map((g) => g.via)).toEqual(['whatsapp'])
  })
  it('empty groups are left out', () => expect(planDelivery([p('g')]).groups).toEqual([]))
  it('the e-mail group holds the address of each person', () => {
    const e = plan.groups.find((g) => g.via === 'email')
    expect(e.items[0].email).toBe('e@example.org')
  })
})

describe('deliverySummary', () => {
  it('counts per channel group in plain words', () => {
    expect(deliverySummary(planDelivery(people))).toBe('7 in the app, 3 via Signal, 1 via WhatsApp, 1 via Geb, 1 by e-mail')
  })
  it('names only the app when nobody has another way', () => expect(deliverySummary(planDelivery([p('g')]))).toBe('1 in the app'))
})

describe('messengerOpen', () => {
  const text = 'Hi & hello: need you'
  it('WhatsApp carries the text in the link', () => {
    const o = messengerOpen(people[2], 'whatsapp', text)
    expect(o.href).toBe(`https://wa.me/4366012345?text=${encodeURIComponent(text)}`)
    expect(o.copy).toBe(false)
  })
  it('Signal opens the app link, falls back to the web link, and the text is copied (Signal takes no prefilled text)', () => {
    const o = messengerOpen(people[0], 'signal', text)
    expect(o.href.startsWith('sgnl://signal.me/')).toBe(true)
    expect(o.fallback.startsWith('https://signal.me/')).toBe(true)
    expect(o.copy).toBe(true)
  })
  it('Geb opens the chat page and the text is copied', () => {
    const o = messengerOpen(people[3], 'geb', text)
    expect(o.href).toContain('/chat?with=')
    expect(o.copy).toBe(true)
  })
  it('null when the person has no such link', () => expect(messengerOpen(people[6], 'signal', text)).toBeNull())
})

describe('emailLink', () => {
  it('one mailto: everybody in BCC, subject and text encoded', () => {
    const u = emailLink(['e@example.org', 'f+x@example.org'], 'Subject, one', 'Line 1\nLine 2 & more')
    expect(u.startsWith('mailto:?bcc=e%40example.org,f%2Bx%40example.org&subject=')).toBe(true)
    expect(u).toContain(`subject=${encodeURIComponent('Subject, one')}`)
    expect(u).toContain(`body=${encodeURIComponent('Line 1\nLine 2 & more')}`)
  })
})

describe('deliveryText', () => {
  const ask = { chips: ['listen', 'call'], note: 'Hard week.', until: 0 }
  const t = deliveryText('Anna Berger', ask, 'Fri 18:00', 'https://app.example.test/')
  it('speaks plainly to the person, with chips, note and the way to answer', () => {
    expect(t).toContain('Anna')
    expect(t).not.toContain('Berger')
    expect(t).toContain('Listen')
    expect(t).toContain('A call')
    expect(t).toContain('Hard week.')
    expect(t).toContain('Fri 18:00')
    expect(t).toContain('https://app.example.test/')
  })
  it('carries no protocol or jargon', () => {
    for (const bad of ['?support=', 'BCC', 'envelope', 'protocol', 'JSON', '{']) expect(t).not.toContain(bad)
  })
  it('works without chips and note', () => {
    const u = deliveryText('Anna', { chips: [], note: '', until: 0 }, 'today', 'https://x.test/')
    expect(u).toContain('Anna')
    expect(u).not.toContain('()')
  })
  it('greets without a name for the shared e-mail', () => expect(deliveryText('', { chips: [], note: '' }, 'today', 'https://x.test/').startsWith('Hi, I could use some support.')).toBe(true))
  it('the e-mail subject is a plain line', () => expect(S.supportMailSubject).toBe('I could use some support'))
})

describe('receipt', () => {
  it('marks a person as sent via a channel with the time, once per person (latest wins)', () => {
    const ask = { id: 'x', to: ['peer-a'], here: [] }
    expect(markSent(ask, 'peer-a', 'signal', 1000)).toBe(true)
    expect(ask.via).toEqual({ 'peer-a': { via: 'signal', at: 1000 } })
    expect(markSent(ask, 'peer-a', 'signal', 2000)).toBe(true)
    expect(ask.via['peer-a'].at).toBe(2000)
  })
  it('refuses somebody the ask did not go to', () => {
    const ask = { id: 'x', to: ['peer-a'], here: [] }
    expect(markSent(ask, 'peer-z', 'signal', 1)).toBe(false)
    expect(ask.via).toBeUndefined()
  })
  it('sentVia groups the marks by channel, in the plan order', () => {
    const ask = { id: 'x', to: [], here: [], via: { a: { via: 'whatsapp', at: 5 }, b: { via: 'signal', at: 9 }, c: { via: 'signal', at: 7 } } }
    expect(sentVia(ask)).toEqual([{ via: 'signal', at: 9, peerIds: ['b', 'c'] }, { via: 'whatsapp', at: 5, peerIds: ['a'] }])
  })
})
