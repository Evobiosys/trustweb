// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b community-shell: menu order, Home tiles, chat scope, switches, event-only bar, event link mode (src/ext/community-mighty/community_data.ts, bottom_bar.ts, event_link.ts). */
import {
  TILES, DEFAULT_TILES, MENU_ORDER, DASHBOARD_SOCIAL_DEFAULTS, WHATSAPP_BRIDGE_ENABLED, menuItems, homeTiles, toggleTile, setManagedTiles, isManager, startLayout, recordTileUse,
  chatOnlyCommunity, setChatOnly, connectEvents, setConnectEvents, communityEventColour, communityChatRows, chatCommunities, renameCommunity, setOwnTiles,
} from '../../src/ext/community-mighty/community_data.ts'
import { parseCommunity, mergeCommunity, NAV } from '../../src/ext/community-mighty/community_data.ts'
import { resolveBar, askFloating, EVENT_ONLY_BAR } from '../../src/bottom_bar.ts'
import { encodeEventLink, decodeEventLink } from '../../src/event_link.ts'

const ME = { events: true, feed: true, inventory: true, people: true, map: true }

describe('switches', () => {
  it('the two unbuilt features stay off', () => {
    expect(DASHBOARD_SOCIAL_DEFAULTS).toBe(false)
    expect(WHATSAPP_BRIDGE_ENABLED).toBe(false)
  })
})

describe('community menu (B33)', () => {
  it('lists Home, Spaces, Events, Docs, Chat, Ask for Support in that order, Ask last of the six', () => {
    expect(MENU_ORDER.slice(0, 8)).toEqual(['home', 'spaces', 'events', 'docs', 'resources', 'references', 'chat', 'ask'])
    expect(menuItems({}, 'iyg').slice(0, 8)).toEqual(['home', 'spaces', 'events', 'docs', 'resources', 'references', 'chat', 'ask'])
  })
  it('Timeline and Members follow as menu items; the settings can take any away', () => {
    expect(menuItems({}, 'iyg')).toEqual(['home', 'spaces', 'events', 'docs', 'resources', 'references', 'chat', 'ask', 'timeline', 'members'])
    expect(menuItems({ meta: { iyg: { kind: 'informal', organizers: [], nav: ['home', 'chat'], ask: false } } }, 'iyg')).toEqual(['home', 'chat'])
  })
  it('NAV carries the timeline', () => { expect(NAV).toContain('timeline') })
})

describe('Home tiles (B35/B36)', () => {
  const D = { meta: { iyg: { kind: 'managed', organizers: ['me'] }, book: { kind: 'informal', organizers: [] } } }
  it('has the six tiles; the default shows no timeline', () => {
    expect(TILES).toEqual(['events', 'spaces', 'docs', 'members', 'resources', 'timeline'])
    expect(DEFAULT_TILES).not.toContain('timeline')
    expect(homeTiles({}, 'iyg')).toEqual({ managed: [], own: DEFAULT_TILES })
  })
  it('toggles a tile per community and keeps it', () => {
    const a = toggleTile(D, 'book', 'timeline')
    expect(homeTiles(a, 'book').own).toContain('timeline')
    expect(homeTiles(a, 'iyg').own).toEqual(DEFAULT_TILES)
    expect(homeTiles(toggleTile(a, 'book', 'timeline'), 'book').own).not.toContain('timeline')
  })
  it('a manager sets managed tiles; they show in their own section and not twice', () => {
    expect(isManager(D, 'iyg')).toBe(true)
    expect(isManager(D, 'book')).toBe(false)
    const a = setManagedTiles(D, 'iyg', ['events', 'docs'])
    expect(homeTiles(a, 'iyg').managed).toEqual(['events', 'docs'])
    expect(homeTiles(a, 'iyg').own).toEqual(['spaces', 'members'])
    expect(setManagedTiles(D, 'book', ['events'])).toBe(D)
  })
  it('a user may not switch a managed tile off', () => {
    const a = setManagedTiles(D, 'iyg', ['events'])
    expect(homeTiles(toggleTile(a, 'iyg', 'events'), 'iyg').managed).toEqual(['events'])
  })
  it('offers another community\'s layout as the start while this one has none of its own', () => {
    const a = toggleTile(D, 'book', 'resources')
    expect(startLayout(a, 'iyg')).toEqual(homeTiles(a, 'book').own)
    expect(startLayout(a, 'book')).toBeNull()
    expect(startLayout({}, 'iyg')).toBeNull()
  })
  it('counts tile use locally (the analytics hook), unknown tiles ignored', () => {
    let d = recordTileUse({}, 'events')
    d = recordTileUse(d, 'events')
    expect(d.tileUse).toEqual({ events: 2 })
    expect(recordTileUse(d, 'bogus')).toBe(d)
  })
  it('survives parse and device merge', () => {
    const a = setManagedTiles(toggleTile(D, 'iyg', 'timeline'), 'iyg', ['docs'])
    const p = parseCommunity(JSON.parse(JSON.stringify(recordTileUse(a, 'docs'))))
    expect(homeTiles(p, 'iyg')).toEqual(homeTiles(a, 'iyg'))
    expect(mergeCommunity(recordTileUse({}, 'docs'), recordTileUse(recordTileUse({}, 'docs'), 'docs')).tileUse).toEqual({ docs: 2 })
  })
})

describe('chat scope (B8)', () => {
  it('Only people of this community is on by default and can be switched', () => {
    expect(chatOnlyCommunity({})).toBe(true)
    expect(chatOnlyCommunity(setChatOnly({}, false))).toBe(false)
    expect(chatOnlyCommunity(parseCommunity(setChatOnly({}, false)))).toBe(false)
  })
  const rows = [{ personId: 'a' }, { personId: 'b' }]
  const people = [{ id: 'a', tags: ['iyg'] }, { id: 'b', tags: [] }]
  it('filters the regular chats by the picked community, or shows all', () => {
    expect(communityChatRows(rows, people, 'iyg', true)).toEqual([{ personId: 'a' }])
    expect(communityChatRows(rows, people, 'iyg', false)).toEqual(rows)
  })
  it('lists the communities for the switcher', () => {
    expect(chatCommunities({ meta: { iyg: { kind: 'informal', organizers: [], name: 'IYG' } } }, [{ id: 'iyg', label: 'IYG', colour: '#111', community: true }]).map((c) => c.id)).toEqual(['iyg'])
  })
})

describe('connect events with a community (B33)', () => {
  const tags = [{ id: 'iyg', colour: '#aa3300', label: 'IYG', community: true }]
  it('is off until switched on; then the community events wear the community colour', () => {
    const ev = { id: 'e1', communityId: 'iyg' }
    expect(connectEvents({}, 'iyg')).toBe(false)
    expect(communityEventColour({}, tags, ev)).toBeNull()
    const d = setConnectEvents({}, 'iyg', true)
    expect(connectEvents(d, 'iyg')).toBe(true)
    expect(communityEventColour(d, tags, ev)).toBe('#aa3300')
    expect(communityEventColour(d, tags, { id: 'e2' })).toBeNull()
    expect(communityEventColour(d, tags, { id: 'e3', communityId: 'other' })).toBeNull()
  })
})

describe('event-only app variant (B5)', () => {
  it('shows Web, Ask your web and Chat, no Recorder', () => {
    expect(EVENT_ONLY_BAR).toEqual(['web', 'ask', 'chat'])
    const { ids } = resolveBar(undefined, { ...ME, eventOnly: true })
    expect(ids).toEqual(['web', 'ask', 'chat'])
    expect(ids).not.toContain('record')
  })
  it('a full app keeps its own bar', () => {
    expect(resolveBar(undefined, ME).ids).toContain('inventory')
  })
  it('Ask your web in the bar is not also floating on Web or Resources (either-or)', () => {
    expect(askFloating(['web', 'ask', 'chat'])).toBe(false)
    expect(askFloating(['web', 'chat', 'inventory'])).toBe(true)
  })
})

describe('event link mode (B5)', () => {
  const ev = { id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true }
  it('mode=event travels in the link and comes back', () => {
    const link = encodeEventLink({ ...ev, linkMode: 'event' }, 'https://app.trustweb.one', 'host')
    expect(decodeEventLink(new URL(link).hash)?.linkMode).toBe('event')
  })
  it('the default full app adds nothing to the link', () => {
    const link = encodeEventLink(ev, 'https://app.trustweb.one', 'host')
    expect(decodeEventLink(new URL(link).hash)?.linkMode).toBeUndefined()
    expect(decodeEventLink(new URL(encodeEventLink({ ...ev, linkMode: 'full' }, 'https://app.trustweb.one', 'host')).hash)?.linkMode).toBeUndefined()
  })
})

describe('community name and own tiles', () => {
  const tags = [{ id: 'iyg', colour: '#111', label: 'IYG', community: true }]
  it('renames the tag label (and a name made over MCP); empty or not allowed changes nothing', () => {
    const d = { meta: { iyg: { kind: 'informal', organizers: [], name: 'IYG' } } }
    const out = renameCommunity(d, tags, 'iyg', '  IYG Crew ')
    expect(out.tags[0].label).toBe('IYG Crew')
    expect(out.data.meta.iyg.name).toBe('IYG Crew')
    expect(renameCommunity(d, tags, 'iyg', '  ')).toBeNull()
    expect(renameCommunity({ meta: { iyg: { kind: 'managed', organizers: [] } } }, tags, 'iyg', 'X')).toBeNull()
  })
  it('setOwnTiles keeps the known ones in tile order and leaves managed ones out', () => {
    const d = setManagedTiles({ meta: { iyg: { kind: 'managed', organizers: ['me'] } } }, 'iyg', ['docs'])
    expect(homeTiles(setOwnTiles(d, 'iyg', ['timeline', 'events', 'bogus', 'docs']), 'iyg').own).toEqual(['events', 'timeline'])
  })
})

describe('settings top entry (B6)', () => {
  it('Your Profile is the first simple entry; Your AI sits further down', async () => {
    const { SETTINGS_REGISTRY } = await import('../../src/settings_registry.ts')
    const simple = SETTINGS_REGISTRY.filter((d) => d.simple).map((d) => d.id)
    expect(simple[0]).toBe('ui.profile')
    expect(SETTINGS_REGISTRY.find((d) => d.id === 'ui.profile').label).toBe('Your Profile')
    expect(simple.indexOf('ui.ai')).toBeGreaterThan(simple.indexOf('ui.bar'))
  })
})
