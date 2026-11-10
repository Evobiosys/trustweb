// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 small-ui-d: bottom row arrange model (order, move rules, promote, halo), profile in a link, review tone, community chat filter, ⋮ underline. */
import { readFileSync } from 'node:fs'
import { arrangeRows, canMoveBar, promoteBar, haloOf, toggleHalo, resolveBar, barLayout, moveBar, HALO_MAX, PHONE_MAX } from '../../src/bottom_bar.ts'
import { withProfile, profileOfLink } from '../../src/profile_link.ts'
import { approveTone } from '../../src/dev_preview_rules.ts'
import { communityChatRows } from '../../src/chat_communities.ts'

const F = { events: true, feed: true, inventory: true, people: true, map: true, mods: ['community'] }
// web chat record events inventory feed community = 7 ids; the phone row holds 6
const BAR = { order: ['web', 'chat', 'record', 'events', 'inventory', 'feed', 'mod:community'] }

describe('arrange rows', () => {
  it('row first, then the overflow, in row order; hidden ones last', () => {
    const rows = arrangeRows(BAR, F, PHONE_MAX)
    const ids = rows.map((r) => r.id)
    expect(ids.slice(0, 7)).toEqual(['web', 'chat', 'record', 'events', 'inventory', 'feed', 'mod:community'])
    expect(rows.filter((r) => r.slot === 'row')).toHaveLength(PHONE_MAX)
    expect(rows.filter((r) => r.slot === 'more').map((r) => r.id)).toEqual(['mod:community'])
    expect(rows.find((r) => r.id === 'network')?.slot).toBe('off')
  })
  it('on a wide screen nothing overflows', () => {
    expect(arrangeRows(BAR, F, 10).some((r) => r.slot === 'more')).toBe(false)
  })
})

describe('move rules', () => {
  it('the first cannot go left, the last cannot go right, the others can', () => {
    expect(canMoveBar(BAR, 'web', -1, F)).toBe(false)
    expect(canMoveBar(BAR, 'web', 1, F)).toBe(true)
    expect(canMoveBar(BAR, 'mod:community', 1, F)).toBe(false)
    expect(canMoveBar(BAR, 'mod:community', -1, F)).toBe(true)
  })
  it('an item that is not in the row cannot move; moveBar agrees', () => {
    expect(canMoveBar(BAR, 'network', 1, F)).toBe(false)
    expect(moveBar(BAR, 'web', -1, F)).toBe(BAR)
  })
})

describe('promote (an overflow item enters the row)', () => {
  it('takes the last slot of the row, the old last one goes to the top of the overflow', () => {
    const next = promoteBar(BAR, 'mod:community', F, PHONE_MAX)
    const { ids, primary } = resolveBar(next, F)
    const { shown, overflow } = barLayout(ids, primary, PHONE_MAX)
    expect(shown).toContain('mod:community')
    expect(shown.indexOf('mod:community')).toBe(shown.length - 1)
    expect(overflow).toEqual(['feed'])
  })
  it('a hidden view is shown again by it', () => {
    const bar = { ...BAR, hidden: ['feed'] }
    const next = promoteBar(bar, 'feed', F, PHONE_MAX)
    expect(next.hidden ?? []).not.toContain('feed')
    expect(barLayout(resolveBar(next, F).ids, resolveBar(next, F).primary, PHONE_MAX).shown).toContain('feed')
  })
  it('a raised button kept out of the row by the layout does not push the promoted item out again', () => {
    const bar = { ...BAR, primary: 'mod:community' }
    const { ids, primary } = resolveBar(promoteBar({ ...BAR, primary: 'web' }, 'feed', F, 5), F)
    expect(barLayout(ids, primary, 5).shown).toContain('feed')
    expect(resolveBar(bar, F).primary).toBe('mod:community')
  })
  it('record and unknown ids change nothing', () => {
    expect(promoteBar(BAR, 'record', F, PHONE_MAX)).toBe(BAR)
    expect(promoteBar(BAR, 'nope', F, PHONE_MAX)).toBe(BAR)
  })
})

describe('halo', () => {
  it('at most two items carry it; a third press drops the oldest; a press on a halo takes it off', () => {
    let bar = BAR
    bar = toggleHalo(bar, 'chat', F)
    bar = toggleHalo(bar, 'events', F)
    expect(haloOf(bar, resolveBar(bar, F).ids)).toEqual(['chat', 'events'])
    bar = toggleHalo(bar, 'feed', F)
    expect(haloOf(bar, resolveBar(bar, F).ids)).toEqual(['events', 'feed'])
    expect(HALO_MAX).toBe(2)
    bar = toggleHalo(bar, 'events', F)
    expect(haloOf(bar, resolveBar(bar, F).ids)).toEqual(['feed'])
  })
  it('only views in the row get a halo; one that left the row loses it', () => {
    expect(toggleHalo(BAR, 'network', F)).toBe(BAR)
    const bar = toggleHalo(BAR, 'feed', F)
    expect(haloOf({ ...bar, hidden: ['feed'] }, resolveBar({ ...bar, hidden: ['feed'] }, F).ids)).toEqual([])
  })
})

describe('profile in a link', () => {
  it('adds tp to the fragment, keeps what is there, reads it back', () => {
    expect(withProfile('https://app.example/c?x=1', 'iyg-support')).toBe('https://app.example/c?x=1#tp=iyg-support')
    expect(withProfile('https://app.example/c#via=SIGNAL', 'reader')).toBe('https://app.example/c#via=SIGNAL&tp=reader')
    expect(profileOfLink('#via=SIGNAL&tp=reader')).toBe('reader')
  })
  it('an unknown or missing profile reads as none; a new one replaces an old one', () => {
    expect(profileOfLink('#tp=evil')).toBeNull()
    expect(profileOfLink('')).toBeNull()
    expect(profileOfLink(new URL(withProfile(withProfile('https://a.example/#tp=reader', 'full'), 'note-taker')).hash)).toBe('note-taker')
  })
})

describe('review panel tone', () => {
  it('flips when an approve moves the focus to another row, stays when it does not', () => {
    expect(approveTone(0, 'a', 'b')).toBe(1)
    expect(approveTone(1, 'a', 'b')).toBe(0)
    expect(approveTone(1, 'a', 'a')).toBe(1)
    expect(approveTone(0, 'a', null)).toBe(0)
  })
})

describe('community chats in the chat list', () => {
  const rows = [{ personId: 'p1' }, { personId: 'p2' }, { personId: 'p3' }]
  const people = [{ id: 'p1', tags: ['iyg'] }, { id: 'p2', tags: ['family'] }, { id: 'p3' }]
  it('keeps the chats of people in a community tag', () => {
    expect(communityChatRows(rows, people, new Set(['iyg'])).map((r) => r.personId)).toEqual(['p1'])
  })
  it('no community tag: nothing matches', () => {
    expect(communityChatRows(rows, people, new Set())).toEqual([])
  })
})

describe('the ⋮ button', () => {
  it('has no underline (it is a glyph, not a text link)', () => {
    const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
    const rule = css.split('\n').find((l) => l.startsWith('.bar-more{')) ?? ''
    expect(rule).not.toBe('')
    expect(rule).not.toMatch(/text-decoration:\s*underline/)
  })
})
