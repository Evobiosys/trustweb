// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 answers-45b (Jakob 2026-11-22, review-45 Q1 Q2 Q7 + new items): the demo-overlay undo, the offline toast wording, group membership
 * changes about others only from whoever admitted them, the event page's "Web: just people from this event", Closest/Close follow without
 * Allow (global + per person), the Google one-time-import line. Fake names only.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_OVERLAY_KEY, demoOverlayDismissed, dismissDemoOverlay, restoreDemoOverlay } from '../../src/demo_overlay.ts'
import { S } from '../../src/strings.ts'
import { createGroupChat } from '../../src/group_chat.ts'
import { sanitizeGroups } from '../../src/group_store.ts'
import { decodeFromQr } from '../../../demo/src/wire.ts'
import { eventPageHooks } from '../../src/a44d_event_host.ts'
import { bubbleOn } from '../../src/event_bubble.ts'
import { answer, closeFollowAuto, follow, receive, setCloseFollow, shareOf } from '../../src/settings_share.ts'
import { readSetting, writeSetting } from '../../src/settings_registry.ts'
import { allTools } from '../../../mcp/src/tools.ts'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src')
const src = (f) => readFileSync(path.join(SRC, f), 'utf8')

describe('1 demo overlay: the X stays, Settings undoes it', () => {
  const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), m } }
  it('restore brings the chip back on this device; blocked storage does not throw', () => {
    const s = store()
    const rec = { me: { id: 'a', displayName: 'J' } }
    dismissDemoOverlay(s, rec)
    expect(demoOverlayDismissed(s, rec)).toBe(true)
    restoreDemoOverlay(s)
    expect(s.m.has(DEMO_OVERLAY_KEY)).toBe(false)
    expect(demoOverlayDismissed(s, rec)).toBe(false)
    expect(() => restoreDemoOverlay({ removeItem: () => { throw new Error('blocked') } })).not.toThrow()
  })
  it('the Settings row has its label', () => {
    expect(S.w46b.demoAgain).toBe('Show the demo-content button again')
  })
})

describe('2 offline outbox: the queued toast', () => {
  it('says "Waiting for being online again" and main.ts uses it for onQueued', () => {
    expect(S.w46b.queued).toBe('Waiting for being online again')
    expect(src('main.ts')).toMatch(/onQueued: \(\) => toast\(S\.w46b\.queued\)/)
  })
})

// ---- 3: group membership changes about others ----
const NAMES = { a: 'Ana', b: 'Ben', c: 'Cleo' }
function world(links) {
  const dev = {}
  let clock = 10_000
  let seq = 0
  for (const k of Object.keys(NAMES)) {
    const others = links.filter((l) => l.includes(k)).map((l) => l.replace(k, ''))
    const state = {
      v: 1, me: { id: k, displayName: NAMES[k] }, log: [], inventory: [],
      peers: others.map((o) => ({ id: `p-${o}`, displayName: NAMES[o] })),
      people: others.map((o) => ({ id: `${k}-${o}`, name: NAMES[o], ring: 'friend', lines: [], peerId: `p-${o}` })),
    }
    dev[k] = { state }
    dev[k].chat = createGroupChat({
      state: () => state, save: () => {}, now: () => ++clock, newId: () => `${k}${++seq}`, peers: () => state.peers,
      send: async (peer, env) => { await dev[peer.id.slice(2)].chat.onEnvelope({ id: `p-${k}` }, decodeFromQr(JSON.stringify(env)).gg) },
      changed: () => {},
    })
  }
  return dev
}
const G = (d) => Object.values(d.state.chatGroups ?? {})[0]
const isOn = (d, name) => Object.values(G(d).mem).some((m) => m.name === name && m.on)

describe('3 group chat: a leave / join naming someone else counts only from whoever admitted them', () => {
  async function flat(links) {
    const dev = world(links)
    const gid = dev.a.chat.create('Flat')
    dev.b.chat.joined(gid, 'Flat', 'b-a'); dev.c.chat.joined(gid, 'Flat', 'c-a')
    await dev.a.chat.admit(gid, 'a-b'); await dev.a.chat.admit(gid, 'a-c')
    return { ...dev, gid }
  }
  it('Cleo leaves herself: Ana passes it on, Ben (who learnt of Cleo through Ana) takes it', async () => {
    const { a, b, c, gid } = await flat(['ab', 'ac'])
    expect(await c.chat.leave(gid, true)).toBe(true)
    expect(isOn(a, 'Cleo')).toBe(false)
    expect(isOn(b, 'Cleo')).toBe(false)
  })
  it('Ben names Cleo in a leave: Ana admitted Cleo, so Ana refuses it; nothing is posted', async () => {
    const { a, gid } = await flat(['ab', 'ac', 'bc'])
    const n = G(a).items.length
    expect(await a.chat.onEnvelope({ id: 'p-b' }, { g: gid, m: 'x1', k: 'leave', by: 'Cleo', ts: 1 })).toBe(false)
    expect(isOn(a, 'Cleo')).toBe(true)
    expect(G(a).items).toHaveLength(n)
  })
  it('Ben names Ana (Cleo\'s inviter, admitted by nobody on Cleo\'s device) in a leave: refused; Ana herself may', async () => {
    const { c, gid } = await flat(['ab', 'ac', 'bc'])
    expect(await c.chat.onEnvelope({ id: 'p-b' }, { g: gid, m: 'x2', k: 'leave', by: 'Ana', ts: 1 })).toBe(false)
    expect(isOn(c, 'Ana')).toBe(true)
    expect(await c.chat.onEnvelope({ id: 'p-a' }, { g: gid, m: 'x3', k: 'leave', by: 'Ana', ts: 1 })).toBe(true)
    expect(isOn(c, 'Ana')).toBe(false)
  })
  it('a member Ben introduced (a join naming Dan) can later be changed only by Ben', async () => {
    const { a, gid } = await flat(['ab', 'ac', 'bc'])
    expect(await a.chat.onEnvelope({ id: 'p-b' }, { g: gid, m: 'x4', k: 'join', by: 'Dan', ts: 1 })).toBe(true)
    expect(isOn(a, 'Dan')).toBe(true)
    expect(await a.chat.onEnvelope({ id: 'p-c' }, { g: gid, m: 'x5', k: 'leave', by: 'Dan', ts: 2 })).toBe(false)
    expect(isOn(a, 'Dan')).toBe(true)
    expect(await a.chat.onEnvelope({ id: 'p-b' }, { g: gid, m: 'x6', k: 'leave', by: 'Dan', ts: 3 })).toBe(true)
    expect(isOn(a, 'Dan')).toBe(false)
  })
  it('the admitter is kept through the sync sanitize', async () => {
    const { a, gid } = await flat(['ab', 'ac'])
    const clean = sanitizeGroups(JSON.parse(JSON.stringify(a.state.chatGroups)))
    expect(clean[gid].mem['a-c'].adm).toBe('me')
  })
})

describe('4 event page: "Web: just people from this event"', () => {
  const deps = (s, seen) => ({ st: () => s, save: () => seen.push('save'), tags: () => [], openSheet: () => {}, closeSheet: () => {}, toast: () => {}, groupChat: { open: () => {}, send: async () => null }, showCommunity: () => {}, chooseCommunity: () => {}, showResources: () => {}, showWeb: () => seen.push('web') })
  it('turns event mode on for the event with the bubble on (an earlier Everyone lift ends), then opens the Web', () => {
    const s = { events: [{ id: 'e1', name: 'Picnic' }], uiRings: { eventMode: 'e1', eventEveryone: true } }
    const seen = []
    eventPageHooks(deps(s, seen)).webBubble(s.events[0])
    expect(s.uiRings.eventMode).toBe('e1')
    expect(bubbleOn(s)).toBe(true)
    expect(seen).toEqual(['save', 'web'])
    const t = { events: [{ id: 'e2', name: 'Swap' }], uiRings: { eventMode: 'e1' } }
    eventPageHooks(deps(t, [])).webBubble(t.events[0])
    expect(t.uiRings.eventMode).toBe('e2')
    expect(bubbleOn(t)).toBe(true)
  })
  it('the button is styled like Event chat / Add people (chip ev-act) and labelled', () => {
    expect(S.w46b.webBubble).toBe('Web: just people from this event')
    expect(src('event_page_top_view.ts')).toMatch(/act\('data-event-web-bubble', S\.w46b\.webBubble/)
  })
})

describe('5 settings follow: Closest / Close follow without Allow, unless switched off', () => {
  const rec = (ring) => ({ me: { id: 'me', displayName: 'Me' }, people: [{ id: 'p1', name: 'Pia', ring, lines: [] }] })
  const req = { k: 'settings-share', v: 1, id: 'f1', t: 'follow', group: 'feed', on: true, at: 1 }
  let n = 0
  const id = () => `i${++n}`
  it('a Closest or Close follower is allowed at once: recorded as follower, my group queued, nothing in the inbox', () => {
    for (const ring of ['closest', 'close']) {
      const r = rec(ring)
      expect(closeFollowAuto(r, 'p1')).toBe(true)
      expect(receive(r, 'p1', req, 5, id)).toBe('allowed')
      const s = shareOf(r)
      expect(s.inbox).toHaveLength(0)
      expect(s.book).toContainEqual(expect.objectContaining({ from: 'p1', to: 'me', topic: 'feed' }))
      expect(s.outbox.at(-1)).toMatchObject({ to: 'p1', msg: { t: 'suggest', group: 'feed', follow: true } })
    }
  })
  it('a Friend still needs Allow', () => {
    const r = rec('friend')
    expect(closeFollowAuto(r, 'p1')).toBe(false)
    expect(receive(r, 'p1', req, 5, id)).toBe('inbox')
    expect(shareOf(r).book).toHaveLength(0)
  })
  it('per person off: that one asks again; the global switch off: everyone asks; both survive shareOf', () => {
    const r = rec('closest')
    setCloseFollow(r, 'p1', false)
    expect(closeFollowAuto(r, 'p1')).toBe(false)
    expect(receive(r, 'p1', req, 5, id)).toBe('inbox')
    setCloseFollow(r, 'p1', true)
    expect(closeFollowAuto(r, 'p1')).toBe(true)
    expect(readSetting(r, 'share.closeFollowAuto')).toBe(true)
    writeSetting(r, 'share.closeFollowAuto', false)
    expect(closeFollowAuto(r, 'p1')).toBe(false)
    answer(r, shareOf(r).inbox[0].id, false, 6, id)   // another write through shareOf/put keeps the switch
    expect(readSetting(r, 'share.closeFollowAuto')).toBe(false)
    setCloseFollow(r, null, true)
    expect(readSetting(r, 'share.closeFollowAuto')).toBe(true)
  })
  it('the label is Jakob\'s', () => {
    expect(S.w46b.closeFollow).toBe('Let Closest/Close follow my settings without asking')
  })
  it('MCP settings_close_follow_set switches it per person and for everyone', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'a45b-'))
    const file = path.join(dir, 'r.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me', displayName: 'Me' }, log: [], inventory: [], people: [{ id: 'p1', name: 'Pia', ring: 'close', lines: [] }] }))
    const tool = allTools({ file, write: true }).find((t) => t.name === 'settings_close_follow_set')
    expect(tool).toBeTruthy()
    expect(await tool.run({ person: 'Pia', allow: false })).toMatchObject({ person: 'p1', allow: false })
    const r1 = JSON.parse(readFileSync(file, 'utf8'))
    expect(closeFollowAuto(r1, 'p1')).toBe(false)
    expect(await tool.run({ allow: false })).toMatchObject({ everyone: true, allow: false })
    expect(readSetting(JSON.parse(readFileSync(file, 'utf8')), 'share.closeFollowAuto')).toBe(false)
  })
})

describe('6 Google contacts: one-time import wording', () => {
  it('the import sheet shows Jakob\'s line', () => {
    expect(S.w46b.googleOnce).toBe('Ideally this is a one-time import. We understand if letting go of Google takes longer, so the sync keeps your contacts in step.')
    expect(src('contacts_sync_view.ts')).toMatch(/S\.w46b\.googleOnce/)
  })
})
