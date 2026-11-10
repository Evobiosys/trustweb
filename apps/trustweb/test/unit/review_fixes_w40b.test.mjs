// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 review, second pass: fail-closed MCP tool list, safe MCP client, assistant undo/approve rules, stricter e-mail, bottom row with modules,
 *  group filter, Google flag, map consent per address, feed preview switch, archive keeps transcripts, adopted edit line, photo metadata guard. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools, toolAllow } from '../../../mcp/src/record_tools.ts'
import { serverEnv } from '../../src/ext/mcp-local/mcp_config.ts'
import { openSession } from '../../src/ext/mcp-local/mcp_client.ts'
import { createActions } from '../../src/actions.ts'
import { defineAppActions } from '../../src/app_actions.ts'
import { createApproval } from '../../src/ext/assistant/approval.ts'
import { Ring } from '../../src/model.ts'
import { planServices, commitPlan, pendingProposals } from '../../src/services_import.ts'
import { NAMES, syntheticVcf } from '../fixtures/synthetic_contacts.mjs'
import { isEmailAddress } from '../../src/channel.ts'
import { emailBatches } from '../../src/support_delivery.ts'
import { moveBar, addBar, resolveBar } from '../../src/bottom_bar.ts'
import { withTag } from '../../src/membranes_five.ts'
import { googleConnectOn } from '../../src/google_flag.ts'
import { mapConsentCovers, mapEmbedUrl } from '../../src/ext/events/events_model.ts'
import { mergeFeed, parseFeed } from '../../src/ext/feed/feed_model.ts'
import { archiveRecord, readArchived } from '../../src/device_adopt.ts'
import { adoptedEdit } from '../../src/record_diff.ts'
import { hasMetadata } from '../../src/ext/photos/photo_ingest.ts'

const NOW = Date.UTC(2026, 10, 10)

describe('mcp: switching every tool off offers no tool (fail closed)', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'rf40b-')), 'rec.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [] }))
  it('TW_MCP_TOOLS="" means none, absent means all', () => {
    expect(toolAllow('')).toEqual([])
    expect(toolAllow(undefined)).toBeUndefined()
    expect(toolAllow(' list_tags , search ')).toEqual(['list_tags', 'search'])
  })
  it('all tools off in Settings -> the server lists none', () => {
    const env = serverEnv({ write: false, off: ['list_people', 'get_person', 'list_tags', 'list_notes', 'search'] })
    expect(env.TW_MCP_TOOLS).toBe('')
    expect(recordTools({ file, write: false, allow: toolAllow(env.TW_MCP_TOOLS) })).toHaveLength(0)
  })
})

describe('mcp client: the key never goes to an address Save would refuse; no redirects', () => {
  const resp = (body) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => body })
  it('plain http to another host: refused before any request', async () => {
    const calls = []
    await expect(openSession({ id: 'x', name: 'X', url: 'http://example.com/mcp', token: 'secret' }, async (u, i) => { calls.push([u, i]); return resp('{}') })).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
  it('https: requests refuse to follow redirects', async () => {
    const inits = []
    const fetchFn = async (_u, i) => { inits.push(i); const m = JSON.parse(i.body); return resp(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: m.method === 'tools/list' ? { tools: [] } : {} })) }
    await openSession({ id: 'x', name: 'X', url: 'https://mcp.example.org/', token: 'secret' }, fetchFn)
    expect(inits.length).toBeGreaterThan(0)
    expect(inits.every((i) => i.redirect === 'error')).toBe(true)
  })
})

function actionsSetup() {
  const s = { people: [{ id: 'p1', name: 'Ada Lovelace', context: '', ring: Ring.Friend, metAt: 0, lines: [] }], serviceImports: [], twSettings: undefined }
  commitPlan(s, planServices(s, [{ name: 'contacts.vcf', text: syntheticVcf() }], { me: 'Me', now: NOW }), 'b1', NOW)
  const host = {
    tagList: [], ext: {}, settings: {}, lookNow: 'default', profileNow: 'full', placeNow: 'web',
    state: () => s, save: () => {}, changed: () => {}, open: () => {}, place: () => 'web', tap: () => null,
    tags: () => host.tagList, saveTags: (t) => { host.tagList = [...t] },
    look: () => host.lookNow, setLook: (l) => { host.lookNow = l }, profile: () => host.profileNow, setProfile: (p) => { host.profileNow = p },
    modules: () => ['feed', 'events', 'assistant'], isEnabled: (id) => host.ext[id] ?? true, setExtension: (id, on) => { host.ext[id] = on },
    setting: (k) => host.settings[k], setSetting: (k, v) => { host.settings[k] = v }, saveTw: (tw) => { s.twSettings = tw },
    newId: (() => { let n = 0; return () => `n${++n}` })(), now: () => NOW,
  }
  const a = createActions()
  defineAppActions(a, host)
  return { a, s }
}
const ok = (a, type, args) => { const r = a.check({ type, args }); if (!r.ok) throw new Error(r.error); return r.action }

describe('assistant actions: undo touches only what that step did', () => {
  it('undo of the first accept keeps the person a later accept created', () => {
    const { a, s } = actionsSetup()
    const rowOf = (name) => pendingProposals(s, NOW).find((x) => x.row.name === name).row.key
    const first = a.run(ok(a, 'accept-row', { row: rowOf(NAMES[0]) }))
    a.run(ok(a, 'accept-row', { row: rowOf(NAMES[1]) }))
    first.undo()
    expect(s.people.some((p) => p.name === NAMES[0])).toBe(false)
    expect(s.people.some((p) => p.name === NAMES[1])).toBe(true)
    expect(s.people.some((p) => p.name === 'Ada Lovelace')).toBe(true)
  })
  it('create-variation over an existing name: undo brings the earlier one back', () => {
    const { a, s } = actionsSetup()
    a.run(ok(a, 'create-variation', { name: 'Quiet', base: 'reader', look: 'sleek' }))
    const second = a.run(ok(a, 'create-variation', { name: 'Quiet', base: 'full', look: 'dex' }))
    second.undo()
    const c = s.twSettings.custom.find((x) => x.id === 'custom-quiet')
    expect(c).toMatchObject({ base: 'reader', look: 'sleek' })
  })
  it('set-field needs text: a missing value is refused, "" still clears', () => {
    const { a } = actionsSetup()
    expect(a.check({ type: 'set-field', args: { person: 'p1', field: 'email' } }).ok).toBe(false)
    expect(a.check({ type: 'set-field', args: { person: 'p1', field: 'email', value: 5 } }).ok).toBe(false)
    expect(a.check({ type: 'set-field', args: { person: 'p1', field: 'email', value: '' } }).ok).toBe(true)
  })
  it('the assistant cannot switch itself off (its own Undo would vanish with it)', () => {
    const { a } = actionsSetup()
    expect(a.check({ type: 'set-extension', args: { module: 'assistant', on: false } }).ok).toBe(false)
    expect(a.check({ type: 'set-extension', args: { module: 'feed', on: false } }).ok).toBe(true)
  })
})

describe('assistant approval: Approve all never presses a button on the page', () => {
  it('cards that need their own Approve stay waiting', () => {
    const ran = []
    const ap = createApproval({ run: (x) => { ran.push(x.label); return { label: x.label, undo: () => {} } } }, { auto: () => false })
    ap.add([{ type: 'set-ring', args: {}, label: 'ring', auto: true, undoable: true }, { type: 'tap', args: {}, label: 'tap', auto: false, undoable: false }])
    expect(ap.approveAll()).toBe(1)
    expect(ran).toEqual(['ring'])
    expect(ap.summary().proposed.map((c) => c.action.label)).toEqual(['tap'])
  })
})

describe('e-mail addresses: one card field is never several recipients', () => {
  it('commas, semicolons, angle brackets and quotes are refused', () => {
    for (const bad of ['a,b@c.com', 'a@b.com,c.com', 'a@b.com;x.org', '<a@b.com>', '"a"@b.com', 'a@b.com%0d']) expect(isEmailAddress(bad)).toBe(false)
    for (const good of ['ada@example.org', 'first.last+tag@sub.example.co.at', "o'neil@example.ie"]) expect(isEmailAddress(good)).toBe(true)
  })
  it('emailBatches: counts per mail, every address once', () => {
    const addrs = Array.from({ length: 150 }, (_, i) => `person${i}@example.org`)
    const b = emailBatches(addrs, 'S', 'B')
    expect(b.length).toBeGreaterThan(1)
    expect(b.reduce((n, x) => n + x.count, 0)).toBe(150)
    expect(b.every((x) => x.href.length <= 1900)).toBe(true)
  })
})

describe('bottom row with a module on: arrows and add keep every button', () => {
  const f = { events: true, feed: false, inventory: true, people: false, map: false, mods: ['cal'] }
  it('moving a view next to the module button keeps all buttons', () => {
    const before = resolveBar(undefined, f).ids
    const last = before.filter((x) => x !== 'mod:cal').pop()
    const next = moveBar(undefined, last, 1, f)
    const after = resolveBar(next, f).ids
    expect([...after].sort()).toEqual([...before].sort())
    expect(after.indexOf(last)).toBe(before.indexOf(last) + 1)
  })
  it('add right of the module button lands right of it', () => {
    const hidden = { order: undefined, hidden: ['chat'] }
    const next = addBar(hidden, 'chat', 'mod:cal', 'right', f)
    const ids = resolveBar(next, f).ids
    expect(ids.indexOf('chat')).toBe(ids.indexOf('mod:cal') + 1)
  })
})

describe('group tags: the tag filter of a group shows its resolved members', () => {
  const tags = [{ id: 'g', colour: '#111111', label: 'IYG' }, { id: 'c', colour: '#222222', label: 'Kids', parents: ['g'] }]
  const people = [{ id: 'a', ring: 'friend', fields: { c: 'true' } }, { id: 'b', ring: 'friend', fields: { g: 'true' } }, { id: 'x', ring: 'friend' }]
  it('a child tag holder counts for the group; without the tag list only direct holders', () => {
    expect(withTag(people, 'g', tags).map((p) => p.id).sort()).toEqual(['a', 'b'])
    expect(withTag(people, 'g').map((p) => p.id)).toEqual(['b'])
    expect(withTag(people, null, tags)).toHaveLength(3)
  })
})

describe('Google: the switch off wins over a stored client id', () => {
  const store = (v) => ({ getItem: () => v, setItem: () => {} })
  it('explicitly off -> off even with a client id; never set + client id -> on; on -> on', () => {
    expect(googleConnectOn(store('0'), '123.apps.googleusercontent.com')).toBe(false)
    expect(googleConnectOn(store(null), '123.apps.googleusercontent.com')).toBe(true)
    expect(googleConnectOn(store('1'), null)).toBe(true)
    expect(googleConnectOn(store(null), null)).toBe(false)
  })
})

describe('events map: consent belongs to the address that was shown; never this app itself', () => {
  it('consent covers its own origin only; the old global "1" asks again', () => {
    expect(mapConsentCovers('https://andrewalan11.github.io', 'https://andrewalan11.github.io/regen-events-map/')).toBe(true)
    expect(mapConsentCovers('https://andrewalan11.github.io', 'https://other.example/map')).toBe(false)
    expect(mapConsentCovers('1', 'https://andrewalan11.github.io/regen-events-map/')).toBe(false)
    expect(mapConsentCovers(null, 'https://andrewalan11.github.io/')).toBe(false)
  })
  it('a map on this app\'s own origin is refused (it would run with the app\'s storage)', () => {
    expect(mapEmbedUrl('https://app.trustweb.one/x', 'https://app.trustweb.one')).toBeNull()
    expect(mapEmbedUrl('https://andrewalan11.github.io/regen-events-map/', 'https://app.trustweb.one')).toBe('https://andrewalan11.github.io/regen-events-map/')
  })
})

describe('feed: switching the host preview off on one device stays off after a sync', () => {
  it('false is kept and the incoming false wins over a true here', () => {
    expect(parseFeed({ preview: false }).preview).toBe(false)
    expect(mergeFeed({ preview: true }, { preview: false }).preview).toBe(false)
    expect(mergeFeed({ preview: false }, {}).preview).toBe(false)
  })
})

describe('device adopt: the archived copy keeps meeting transcripts while storage allows', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) } } }
  it('transcripts and the outbox survive in the copy', () => {
    const store = mem()
    const s = { v: 1, me: { displayName: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [{ id: 'm1', at: 1, transcript: [{ who: 'a', text: 'hello' }], outbox: [{ x: 1 }] }] }
    expect(archiveRecord(store, 'k', s, { reason: 'r', device: 'Phone' }, NOW)).toBe(true)
    expect(readArchived(store, 'k', NOW)[0].record.meetings[0].transcript).toEqual([{ who: 'a', text: 'hello' }])
  })
})

describe('adopted edit line: only the four counted fields, short device name', () => {
  it('extra keys are dropped', () => {
    const e = adoptedEdit({ at: 'x', previewId: 'p' }, 'D'.repeat(200), { people: 1, notes: 2, settings: 3, evil: 'x'.repeat(10) })
    expect(e.after).toEqual({ device: 'D'.repeat(80), people: 1, notes: 2, settings: 3 })
  })
})

describe('photos: the metadata guard knows PNG text/EXIF chunks and JPEG XMP too', () => {
  const pngChunk = (type) => { const b = new Uint8Array(8 + 12 + 4); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); b.set([0, 0, 0, 0], 8); b.set([...type].map((c) => c.charCodeAt(0)), 12); return b }
  it('flags eXIf, tEXt, iTXt, zTXt chunks and JPEG APP1 Exif/XMP; a plain picture passes', () => {
    for (const t of ['eXIf', 'tEXt', 'iTXt', 'zTXt']) expect(hasMetadata(pngChunk(t))).toBe(true)
    expect(hasMetadata(pngChunk('IDAT'))).toBe(false)
    expect(hasMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0x10, 0x45, 0x78, 0x69, 0x66, 0, 0, 0xff, 0xd9]))).toBe(true)
    const xmp = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/')
    expect(hasMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0x30, ...xmp, 0xff, 0xd9]))).toBe(true)
    expect(hasMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xd9]))).toBe(false)
  })
})

describe('photos: picking a recently removed picture again brings it back', () => {
  it('the duplicate of a tombstoned photo is restored, not left to the 30-day purge', async () => {
    const { createHash } = await import('node:crypto')
    const { ingestFiles } = await import('../../src/ext/photos/photo_ingest.ts')
    const { PhotoStore } = await import('../../src/ext/photos/photo_store.ts')
    const { tombstone } = await import('../../src/ext/photos/photo_model.ts')
    const { fakeIndexedDB } = await import('./helpers/fake_idb.mjs')
    const { png } = await import('./helpers/png.mjs')
    const file = Object.assign(new Blob([png(4, 4, [9, 9, 9])], { type: 'image/png' }), { name: 'a.png' })
    let n = 0
    const d = { store: new PhotoStore('t', fakeIndexedDB()), scale: async (b) => ({ blob: b, w: 4, h: 4 }), hash: async (bytes) => createHash('sha256').update(bytes).digest('hex'), newId: () => 'id' + ++n, now: () => 1_800_000_000_000, room: async () => true }
    const [first] = await ingestFiles([file], { source: 's', people: [] }, d)
    await d.store.update(first.meta.id, (m) => tombstone(m, 1_800_000_000_000))
    const [again] = await ingestFiles([file], { source: 's', people: ['p1'] }, d)
    expect(again.kind).toBe('duplicate')
    expect(again.meta.deletedAt).toBeUndefined()
    expect(again.meta.people).toEqual(['p1'])
    expect((await d.store.list()).find((m) => m.id === first.meta.id).deletedAt).toBeUndefined()
  })
})

describe('Google: coming back from Google with the switch off (or no client id) calls nobody', () => {
  const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) }, m } }
  const setup = (local, session) => {
    const calls = []
    globalThis.localStorage = mem(local)
    globalThis.sessionStorage = mem(session)
    globalThis.location = { href: 'https://app.example/?code=c1&state=s1', origin: 'https://app.example', pathname: '/' }
    globalThis.history = { state: null, replaceState: () => {} }
    globalThis.fetch = async (u) => { calls.push(String(u)); return { ok: true, status: 200, json: async () => ({}) } }
    return calls
  }
  const pending = JSON.stringify({ verifier: 'v'.repeat(43), state: 's1' })
  it('flag off: no request, the pending sign-in is dropped', async () => {
    const { resumeGoogle } = await import('../../src/contacts_sync_view.ts')
    const calls = setup({ 'tw-google-connect': '0', tw_google_client_id: '123.apps.googleusercontent.com' }, { tw_google_pkce: pending, tw_google_client_secret: 'sec' })
    await resumeGoogle({ toast: () => {} }, () => {}, globalThis.location.href)
    expect(calls).toEqual([])
    expect(globalThis.sessionStorage.getItem('tw_google_pkce')).toBeNull()
    expect(globalThis.sessionStorage.getItem('tw_google_client_secret')).toBeNull()
  })
  it('flag on but no client id: no request', async () => {
    const { resumeGoogle } = await import('../../src/contacts_sync_view.ts')
    const calls = setup({ 'tw-google-connect': '1' }, { tw_google_pkce: pending })
    await resumeGoogle({ toast: () => {} }, () => {}, globalThis.location.href)
    expect(calls).toEqual([])
  })
  it('a damaged pending entry is dropped, never thrown at start', async () => {
    const { resumeGoogle } = await import('../../src/contacts_sync_view.ts')
    const calls = setup({ 'tw-google-connect': '1', tw_google_client_id: '123' }, { tw_google_pkce: '{not json' })
    await expect(resumeGoogle({ toast: () => {} }, () => {}, globalThis.location.href)).resolves.toBeUndefined()
    expect(calls).toEqual([])
    expect(globalThis.sessionStorage.getItem('tw_google_pkce')).toBeNull()
  })
  it('after the code exchange the client secret is forgotten (it was only needed for that one step)', async () => {
    const { resumeGoogle } = await import('../../src/contacts_sync_view.ts')
    setup({ 'tw-google-connect': '1', tw_google_client_id: '123' }, { tw_google_pkce: pending, tw_google_client_secret: 'sec' })
    globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => (String(u).includes('token') ? { access_token: 'tok' } : {}) })
    await resumeGoogle({ toast: () => {} }, () => {}, globalThis.location.href)
    expect(globalThis.sessionStorage.getItem('tw_google_client_secret')).toBeNull()
  })
  it('forgetGoogle: token and secret gone, the grant revoked, the device keys removed', async () => {
    const { forgetGoogle } = await import('../../src/contacts_sync_view.ts')
    const calls = setup({ 'tw-google-connect': '1', tw_google_client_id: '123', 'tw-google-nudge-dismissed': '1' }, { tw_google_token: 'tok', tw_google_client_secret: 'sec', tw_google_pkce: pending })
    await forgetGoogle({ device: true })
    expect(calls.some((u) => u.startsWith('https://oauth2.googleapis.com/revoke'))).toBe(true)
    for (const k of ['tw_google_token', 'tw_google_client_secret', 'tw_google_pkce']) expect(globalThis.sessionStorage.getItem(k)).toBeNull()
    for (const k of ['tw-google-connect', 'tw_google_client_id', 'tw-google-nudge-dismissed']) expect(globalThis.localStorage.getItem(k)).toBeNull()
  })
})

describe('Reset this phone also drops the archived copies (whole records in plain text)', () => {
  it('clearState removes the record and its archived copies', async () => {
    const { clearState, storageKey } = await import('../../src/store.ts')
    const m = new Map()
    globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }
    const key = storageKey('p', 'c')
    m.set(key, '{}'); m.set(key + ':archived-copies', '[]')
    clearState('p', 'c')
    expect(m.has(key)).toBe(false)
    expect(m.has(key + ':archived-copies')).toBe(false)
  })
})

describe('assistant: a row named only by a phone number, a date or an e-mail never sends that as its name', () => {
  it('aiRowName hides numbers, dates and addresses; real names pass', async () => {
    const { aiRowName } = await import('../../src/ext/assistant/protocol.ts')
    expect(aiRowName('+43 660 1234567')).toBe('(no name)')
    expect(aiRowName('ada@example.org')).toBe('(no name)')
    expect(aiRowName('   ')).toBe('(no name)')
    expect(aiRowName('Ada Lovelace')).toBe('Ada Lovelace')
  })
})

describe('photos: switching the module off closes its database connection', () => {
  it('close() closes the open connection; a later call opens a fresh one', async () => {
    const { PhotoStore } = await import('../../src/ext/photos/photo_store.ts')
    const { fakeIndexedDB } = await import('./helpers/fake_idb.mjs')
    const idb = fakeIndexedDB()
    const s = new PhotoStore('t', idb)
    await s.list()
    let closed = 0
    const db = await s['db']
    const c = db.close?.bind(db)
    db.close = () => { closed++; c?.() }
    s.close()
    await new Promise((r) => setTimeout(r, 0))
    expect(closed).toBe(1)
    expect(await s.list()).toEqual([])
  })
})
