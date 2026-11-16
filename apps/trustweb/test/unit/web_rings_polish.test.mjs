// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 web-rings-polish: quiet colours (rings only), second-hand people beyond the rings, events stays a bar button, small person menu, tap-the-event hint. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { DEFAULT_ORDER, STOCK_ORDER, resolveBar, arrangeRows } from '../../src/bottom_bar.ts'
import { colourLook, COLOUR_MODES, colourModeOf } from '../../src/colour_tags.ts'
import { Ring } from '../../src/model.ts'
import { SCHEMA_VERSION, migrate } from '../../src/schema_version.ts'
import { SETTINGS_REGISTRY } from '../../src/settings_registry.ts'
import { BEYOND_GAP, beyondPeople, beyondSlots, isBeyond, ringsGeometry, webSlot } from '../../src/rings_layout.ts'
import { PERSON_MENU_ROWS, beyondLabel, personMenuRows } from '../../src/person_menu.ts'
import { S } from '../../src/strings.ts'

describe('colour mode', () => {
  it('rings is the default; unknown values read as rings', () => {
    expect(COLOUR_MODES).toEqual(['rings', 'full'])
    expect(colourModeOf({})).toBe('rings')
    expect(colourModeOf({ colourMode: 'full' })).toBe('full')
    expect(colourModeOf({ colourMode: 'neon' })).toBe('rings')
  })
  it('rings: neutral fill, the colour only on the stroke; full: today\'s look', () => {
    expect(colourLook('rings', 'var(--c)')).toEqual({ fill: 'var(--person-neutral)', ink: 'var(--ink)', stroke: 'var(--c)' })
    expect(colourLook('full', 'var(--c)')).toEqual({ fill: 'var(--c)', ink: null, stroke: null })
  })
  it('the setting is a boolean in Settings > Web, stored sparsely; full colours struck through when off is the toggle\'s job', () => {
    const d = SETTINGS_REGISTRY.find((x) => x.id === 'web.colourMode')
    expect(d.section).toBe('web')
    const r = {}
    expect(d.get(r)).toBe(false)
    d.set(r, true)
    expect(r.colourMode).toBe('full')
    expect(d.get(r)).toBe(true)
    d.set(r, false)
    expect(r.colourMode).toBeUndefined()
  })
  it('migration bumps the schema and drops an unreadable colourMode', () => {
    expect(SCHEMA_VERSION).toBe(3)
    const s = { v: 1, me: { id: 'me', displayName: 'J' }, peers: [], log: [], people: [], inventory: [], meetings: [], colourMode: 'neon' }
    expect(migrate(s)).toBe(true)
    expect(s.colourMode).toBeUndefined()
    const t = { v: 1, me: { id: 'me', displayName: 'J' }, peers: [], log: [], people: [], inventory: [], meetings: [], colourMode: 'full' }
    migrate(t)
    expect(t.colourMode).toBe('full')
  })
})

describe('second-hand people sit beyond the rings', () => {
  const omar = { id: 'o', name: 'Omar', ring: Ring.None, fields: {}, via: 'l' }
  const lena = { id: 'l', name: 'Lena', ring: Ring.Close, fields: {} }
  it('a person seen through a friend is beyond, never a ring slot', () => {
    expect(isBeyond(omar)).toBe(true)
    expect(isBeyond(lena)).toBe(false)
    expect(webSlot(omar)).toBe(Ring.Unsorted)   // the ring slots are unchanged
    expect(beyondPeople([omar, lena]).map((p) => p.id)).toEqual(['o'])
  })
  it('the geometry gains one band outside the outermost ring', () => {
    const counts = { [Ring.Closest]: 1, [Ring.Close]: 1, [Ring.Friend]: 0, [Ring.Acquaintance]: 0, [Ring.Intending]: 0, [Ring.Unsorted]: 1 }
    const plain = ringsGeometry(counts)
    const withBeyond = ringsGeometry(counts, {}, 1, {}, 1)
    expect(plain.beyondRadius).toBeUndefined()
    expect(withBeyond.beyondRadius).toBeGreaterThanOrEqual(plain.extent + BEYOND_GAP)
    expect(withBeyond.extent).toBeGreaterThan(withBeyond.beyondRadius)
    expect(withBeyond.radius[Ring.Unsorted]).toBe(plain.radius[Ring.Unsorted])
  })
  it('slots spread evenly and are stable', () => {
    const a = beyondSlots([{ id: 'b' }, { id: 'a' }])
    expect(a.map((x) => x.id)).toEqual(['a', 'b'])
    expect(Math.abs(a[1].angle - a[0].angle)).toBe(180)
    expect(beyondSlots([{ id: 'b' }, { id: 'a' }])).toEqual(a)
  })
  it('label: the name, or none when either side keeps it anonymous; "via Lena" is the tooltip', () => {
    expect(beyondLabel(omar, 'Lena')).toEqual({ text: 'Omar', title: S.beyondVia('Lena') })
    expect(beyondLabel({ ...omar, anonymous: true }, 'Lena')).toEqual({ text: '', title: S.beyondVia('Lena') })
    expect(S.beyondVia('Lena')).toBe('via Lena')
  })
})

describe('Events stays its own bottom-bar button', () => {
  it('is in the default and stock rows and in the resolved row', () => {
    expect(DEFAULT_ORDER).toContain('events')
    expect(STOCK_ORDER).toContain('events')
    const f = { events: true, feed: true, inventory: true, people: true, map: true, mods: ['community'] }
    expect(resolveBar(undefined, f).ids).toContain('events')
    expect(arrangeRows(undefined, f, 6).find((r) => r.id === 'events').slot).not.toBe('off')
  })
})

describe('small person menu', () => {
  it('at most three rows: Tag, Hide, Open', () => {
    expect(PERSON_MENU_ROWS).toEqual(['tag', 'hide', 'open'])
    expect(personMenuRows({ id: 'x' }).map((r) => r.id)).toEqual(['tag', 'hide', 'open'])
    expect(personMenuRows({ id: 'x' }).length).toBeLessThanOrEqual(3)
  })
})

describe('MCP parity: person_hide', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'wrp-mcp-')), 'rec.json')
  it('hides a person in the expanse; add_tag already tags', () => {
    writeFileSync(file, JSON.stringify({ v: 1, people: [{ id: 'a', name: 'Anna', ring: 'friend', fields: {} }] }))
    const t = Object.fromEntries(recordTools({ file, write: true }).map((x) => [x.name, x]))
    expect(recordTools({ file, write: false }).map((x) => x.name)).not.toContain('person_hide')
    expect(t.person_hide.run({ person: 'a' })).toMatchObject({ id: 'a', hidden: true })
    t.person_hide.run({ person: 'Anna' })
    expect(JSON.parse(readFileSync(file, 'utf8')).expanse).toEqual(['a'])
    expect(t.add_tag).toBeDefined()
  })
})

describe('tap-the-event hint', () => {
  it('shows only while exactly one event chip is the filter', async () => {
    const { focusedEventId } = await import('../../src/web_focus.ts')
    expect(focusedEventId({ uiRings: { show: ['event:e1'] } })).toBe('e1')
    expect(focusedEventId({ uiRings: { show: ['event:e1', 'tag:x'] } })).toBeNull()
    expect(focusedEventId({})).toBeNull()
  })
})
