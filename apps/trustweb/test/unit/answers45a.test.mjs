// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** answers-45a (review-45 recommended defaults Q3, Q5, Q8, Q9, Q10): one block per answer. Fake names only. */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { follow, receive, parseWire, applyValues, loosens, shareOf, GROUP_SETTINGS } from '../../src/settings_share.ts'
import { readSetting, settingById } from '../../src/settings_registry.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { encodeEventLink } from '../../src/event_link.ts'
import { setEventAccess } from '../../src/community_event_access.ts'
import { eventChatUnread } from '../../src/event_group_chat.ts'
import { createActions } from '../../src/actions.ts'
import { installEventsRefetch } from '../../src/events_refetch_actions.ts'
import { allTools } from '../../../mcp/src/tools.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(here, '../../src')
const P = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 0, lines: [], ...over })

describe('Q3 settings follow: auto-apply never loosens privacy', () => {
  const rec = () => ({ v: 1, people: [P('ben', 'Ben')] })
  const upd = (id, values) => parseWire({ k: 'settings-share', v: 1, id, t: 'suggest', group: 'privacy', values, at: 2, follow: true })
  it('loosens: every privacy setting knows its tighter and looser side', () => {
    expect(loosens('trust.only', true, false)).toBe(true)
    expect(loosens('trust.only', false, true)).toBe(false)
    expect(loosens('profile.discoverable', false, true)).toBe(true)
    expect(loosens('profile.discoverable', true, false)).toBe(false)
    expect(loosens('hosting.friends', 'off', 'closest')).toBe(true)
    expect(loosens('hosting.friends', 'close', 'closest')).toBe(false)
    expect(loosens('web.askDirectOnly', true, false)).toBe(true)
    for (const id of GROUP_SETTINGS.privacy) {
      const d = settingById(id)
      const vals = d.type === 'boolean' ? [false, true] : d.choices
      const ups = vals.flatMap((a) => vals.filter((b) => b !== a).map((b) => loosens(id, a, b)))
      expect(ups.some(Boolean), `${id} has a looser side`).toBe(true)
    }
  })
  it('a loosening update from the person I follow (auto on) waits in the inbox; a tightening one applies', () => {
    const r = rec()
    applyValues(r, 'privacy', { 'trust.only': true })
    follow(r, 'ben', 'privacy', true, 1, () => 'f1')
    expect(receive(r, 'ben', upd('u1', { 'trust.only': false }), 2)).toBe('inbox')
    expect(readSetting(r, 'trust.only')).toBe(true)
    expect(shareOf(r).inbox[0]).toMatchObject({ from: 'ben', group: 'privacy', follow: true })
    expect(receive(r, 'ben', upd('u2', { 'profile.openToConnect': false }), 3)).toBe('applied')
    expect(readSetting(r, 'profile.openToConnect')).toBe(false)
    // mixed: one loosening item holds the whole update
    expect(receive(r, 'ben', upd('u3', { 'profile.discoverable': true, 'general.qrProfileOption': false }), 4)).toBe('inbox')
    expect(readSetting(r, 'profile.discoverable')).toBe(false)
  })
})

describe('Q5 seesEvent is the read filter of a host\'s events; the Event chat button carries its unread count', () => {
  function host(mode) {
    const sent = []
    const ev = { id: 'e1', name: 'Winter OG', from: '2026-12-30', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna'], communityId: 'iyg', people: ['i'] }
    const state = {
      me: { id: 'me', displayName: 'Hanna' }, notifInbox: [],
      people: [P('m', 'Mia', { peerId: 'pm', fields: { iyg: 'true' } }), P('s', 'Sam', { peerId: 'ps' }), P('i', 'Ivo', { peerId: 'pi' })],
      events: [ev, { id: 'e2', name: 'Picnic', from: '2026-12-31', where: 'Park', createdAt: 1, attended: true, hosts: ['Hanna'] }],
    }
    if (mode) setEventAccess(state, 'iyg', mode)
    const env = createEventEnvelopes({
      state: () => state, save: () => {}, now: () => 1e12, link: (e) => encodeEventLink(e, 'https://app.trustweb.one', 'peer', { name: 'Hanna' }),
      send: async (peer, e) => { sent.push({ to: peer.id, e }) }, pending: () => null, setPending: () => {}, changed: () => {}, later: () => {},
    })
    const want = (peer, id = 'e1') => env.onEnvelope({ id: peer }, { v: 1, t: 'event', want: id })
    return { want, sent }
  }
  it('mode members: a member gets the community event, a stranger does not', async () => {
    const h = host()
    expect(await h.want('pm')).toBe('answered')
    expect(await h.want('ps')).toBe('ignored')
    expect(await h.want('pi')).toBe('answered')
    expect(h.sent.map((x) => x.to)).toEqual(['pm', 'pi'])
  })
  it('mode invited: only the invited person gets it, a member does not', async () => {
    const h = host('invited')
    expect(await h.want('pm')).toBe('ignored')
    expect(await h.want('pi')).toBe('answered')
  })
  it('an event outside any community: as before, a host answers a connected person', async () => {
    expect(await host().want('ps', 'e2')).toBe('answered')
  })
  it('eventChatUnread counts one event\'s thread (the badge), or all', () => {
    const it1 = { m: 'a1', k: 'msg', by: 'Ben', ts: 1, at: 1, text: 'hi' }
    const s = { eventChats: { e1: { items: [it1], unread: 2 }, e2: { items: [it1], unread: 3 } } }
    expect(eventChatUnread(s, 'e1')).toBe(2)
    expect(eventChatUnread(s, 'e9')).toBe(0)
    expect(eventChatUnread(s)).toBe(5)
    const top = readFileSync(path.join(SRC, 'event_page_top_view.ts'), 'utf8')
    expect(top).toMatch(/eventChatUnread\(/)
    expect(top).toMatch(/data-event-chat-unread/)
  })
  it('no dead exports of the rows left: seesEvent, eventChatUnread have a caller in src (invitedTo serves seesEvent; nonMembersOf archived: bulk_invite.ts nonMembers is the one in use)', () => {
    const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'))
    const callers = (name, home) => files.filter((f) => f !== home && new RegExp(`\\b${name}\\b`).test(readFileSync(path.join(SRC, f), 'utf8')))
    expect(callers('seesEvent', 'community_event_access.ts')).not.toEqual([])   // invitedTo is seesEvent's own part
    expect(callers('eventChatUnread', 'event_group_chat.ts')).not.toEqual([])
    expect(readFileSync(path.join(SRC, 'community_event_access.ts'), 'utf8')).not.toMatch(/export const nonMembersOf/)
  })
})

describe('Q8 P5: one install*() per row in main.ts', () => {
  const main = readFileSync(path.join(SRC, 'main.ts'), 'utf8')
  const count = (re) => (main.match(re) ?? []).length
  it('merge-events, events-refetch, group-chat-list: one import and one call each', () => {
    for (const fn of ['installEventMerge', 'installEventsRefetch', 'installGroupChat']) {
      expect(count(new RegExp(`import \\{[^}]*\\b${fn}\\b`, 'g')), fn).toBe(1)
      expect(count(new RegExp(`\\b${fn}(<[^>]*>)?\\(`, 'g')), fn).toBe(1)
    }
    for (const gone of ['createMergeView', 'defineEventMergeActions', 'mergedInto', 'createEventsRefetch', 'defineEventsRefetchAction', 'createGroupView', 'defineGroupActions']) expect(main, gone).not.toMatch(new RegExp(`\\b${gone}\\b`))
  })
  it('installEventsRefetch registers the MCP action and returns the run', async () => {
    const reg = createActions()
    const sent = []
    const run = installEventsRefetch(reg, { now: () => 1, peers: () => [{ id: 'p1' }], send: async (p, e) => { sent.push([p.id, e]) } })
    expect(await run(true)).toBe(1)
    const c = reg.check({ type: 'events-refetch', args: {} })
    expect(c.ok).toBe(true)
    reg.run(c.action)
    await new Promise((r) => setTimeout(r, 0))
    expect(sent).toHaveLength(2)
  })
})

describe('Q9 MCP event_invite mirrors the UI gate', () => {
  it('refuses an event I may not invite to; nothing changes', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-a45a-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { displayName: 'Jakob' }, people: [P('a', 'Ada')], events: [{ id: 'e9', name: 'Their party', from: '2026-12-01', where: 'Prater', createdAt: 0, attended: false, hosts: ['Someone Else'] }] }))
    const by = Object.fromEntries(allTools({ file, write: true, now: () => new Date('2026-11-20T10:00:00Z') }).map((t) => [t.name, t]))
    expect(() => by.event_invite.run({ event: 'e9', people: ['a'] })).toThrow(/may not invite/)
    expect(JSON.parse(readFileSync(file, 'utf8')).events[0].people).toBeUndefined()
  })
})

describe('Q10 tw_dev.sh never lets a stray run write the shared live record', () => {
  const SCRIPT = path.join(here, '../../../../scripts/tw_dev.sh')
  /** A fake HOME with Jakob-style state (dev-record.path -> a seed file), a registry with one preview port, and the port held by a
   *  listener that closes every connection: a run that passes the guard stops at "port taken" and starts nothing. */
  async function run(port, env = {}) {
    const home = mkdtempSync(path.join(tmpdir(), 'tw-a45a-home-'))
    const state = path.join(home, '.cache/trustweb-dev')
    mkdirSync(path.join(state, 'previews'), { recursive: true })
    writeFileSync(path.join(home, 'seed.json'), '{"v":1,"people":[]}')
    writeFileSync(path.join(state, 'dev-record.path'), path.join(home, 'seed.json'))
    writeFileSync(path.join(state, 'previews/tw999.json'), JSON.stringify({ id: 'tw999', port: 5994, stockPort: 6094 }, null, 2))
    const srv = net.createServer((c) => c.destroy())
    await new Promise((r) => srv.listen(port, '127.0.0.1', r))
    try {
      return await new Promise((resolve) => {
        const p = spawn('bash', [SCRIPT, '--no-open'], { env: { PATH: process.env.PATH, HOME: home, TW_PORT: String(port), TW_STOCK_URL: 'http://127.0.0.1:1/', ...env } })
        let out = ''
        p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { out += d })
        p.on('close', (code) => resolve({ code, out }))
      })
    } finally { srv.close() }
  }
  it('an unregistered port in personal mode is refused (exit 3) before anything starts', async () => {
    const r = await run(5991)
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/refused/)
  }, 20000)
  it('TW_STOCK=1 on the same port passes the guard', async () => {
    const r = await run(5992, { TW_STOCK: '1' })
    expect(r.out).not.toMatch(/refused/)
    expect(r.out).toMatch(/port 5992 is taken/)
  }, 20000)
  it('own record + own live file (isolated personal e2e) passes the guard', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'tw-a45a-own-'))
    writeFileSync(path.join(d, 'r.json'), '{"v":1,"people":[]}')
    const r = await run(5993, { TW_DEV_RECORD: path.join(d, 'r.json'), TW_DEV_LIVE: path.join(d, 'live.json') })
    expect(r.out).not.toMatch(/refused/)
  }, 20000)
  it('a registered preview port passes the guard', async () => {
    const r = await run(5994)
    expect(r.out).not.toMatch(/refused/)
    expect(r.out).toMatch(/port 5994 is taken/)
  }, 20000)
})
