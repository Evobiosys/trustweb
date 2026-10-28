// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24b: zoom levels per tab (second press on the active tab zooms in, back zooms out) and the zoomed-out filters. */
import { ChatDirection } from '../../src/chat.ts'
import { Ring } from '../../src/model.ts'
import { ZOOM_OUT, back, connectedPeople, itemRows, press, zoomable, ZOOM_DAYS, ZOOM_MIN } from '../../src/zoom.ts'

const DAY = 86_400_000
const now = 1000 * DAY
const person = (id, o = {}) => ({ id, name: id, context: '', ring: Ring.Acquaintance, metAt: 0, lines: [], ...o })

describe('zoom levels', () => {
  it('only Membranes and Resources zoom', () => {
    expect(zoomable('web')).toBe(true)
    expect(zoomable('inventory')).toBe(true)
    expect(zoomable('chat')).toBe(false)
  })
  it('the first press only opens the tab; the second press on the active tab zooms in', () => {
    expect(press('web', 'chat')).toEqual(ZOOM_OUT)
    expect(press('web', 'web')).toEqual({ web: true, inventory: false })
    expect(press('web', 'web')).toEqual({ web: true, inventory: false })
  })
  it('a press on another tab zooms everything out; a non-zoomable tab never zooms in', () => {
    expect(press('inventory', 'web')).toEqual(ZOOM_OUT)
    expect(press('chat', 'chat')).toEqual(ZOOM_OUT)
  })
  it('back zooms out', () => {
    expect(back()).toEqual(ZOOM_OUT)
  })
})

describe('connectedPeople (Membranes zoomed out)', () => {
  const crowd = Array.from({ length: 10 }, (_, i) => person('a' + i))
  const s = (people, extra = {}) => ({ people, chats: {}, ...extra })
  it('a small web shows everyone', () => {
    const small = [person('x', { ring: Ring.Close }), person('y')]
    expect(connectedPeople(s(small), now)).toEqual(small)
    expect(ZOOM_MIN).toBe(8)
  })
  it('keeps the inner rings, recent chats and recent timeline entries; drops the rest', () => {
    const people = [
      ...crowd,
      ...Array.from({ length: 5 }, (_, i) => person('c' + i, { ring: Ring.Close })),
      person('friend', { ring: Ring.Friend }),
      person('talker', { peerId: 'q1' }),
      person('old-talker', { peerId: 'q2' }),
      person('logged', { timeline: [{ at: now - 10 * DAY }] }),
      person('old-logged', { timeline: [{ at: now - (ZOOM_DAYS + 1) * DAY }] }),
    ]
    const chats = {
      q1: { unread: 0, messages: [{ dir: ChatDirection.In, at: now - DAY }] },
      q2: { unread: 0, messages: [{ dir: ChatDirection.In, at: now - (ZOOM_DAYS + 5) * DAY }] },
    }
    const ids = connectedPeople(s(people, { chats }), now).map((p) => p.id)
    expect(ids.sort()).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'friend', 'logged', 'talker'])
  })
  it('a suggested ring is not placed: not an inner-ring member', () => {
    const people = [...crowd, person('guess', { ring: Ring.Close, ringSuggested: true })]
    expect(connectedPeople(s(people), now)).toEqual(people)
  })
  it('fewer than 8 after filtering shows everyone', () => {
    const people = [...crowd, person('close', { ring: Ring.Close })]
    expect(connectedPeople(s(people), now)).toEqual(people)
  })
})

describe('itemRows (Resources zoomed in)', () => {
  const items = [
    { id: '1', text: 'Ladder', createdAt: 1 },
    { id: '2', text: 'Apple press', createdAt: 3, context: [{ text: 'borrowed from Ben' }] },
    { id: '3', text: 'Bike pump', createdAt: 2 },
  ]
  it('newest first by default, A to Z on request', () => {
    expect(itemRows(items, '', 'new').map((i) => i.id)).toEqual(['2', '3', '1'])
    expect(itemRows(items, '', 'az').map((i) => i.id)).toEqual(['2', '3', '1'])
  })
  it('search matches the text and the notes, ignoring case', () => {
    expect(itemRows(items, 'LADD', 'new').map((i) => i.id)).toEqual(['1'])
    expect(itemRows(items, 'ben', 'new').map((i) => i.id)).toEqual(['2'])
  })
})
