// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Notes relay (src/notes_relay.ts): size rule, sealing for the recipient, chunk framing, envelope, polling. No network: fetch is a fake.
import {
  RELAY_ITEMS_MAX, RELAY_TTL_MS, frameChunks, joinFrames, openNote, postNote, pollRelay, readRelayOn, relayEnvelope, relayNeeded, relayToken, sealNote, splitBytes, writeRelayOn,
} from '../../src/notes_relay.ts'
import { newNote, forward } from '../../src/notes_outline.ts'
import { createIdentity } from '../../../demo/src/did.ts'

const NOW = 1_800_000_000_000
const ANNA = createIdentity('https://x.invalid/relay')
const BEN = createIdentity('https://x.invalid/relay')
const by = { did: ANNA.did, name: 'Anna' }
const noteOf = (lines) => newNote({ title: 'Trip', text: Array.from({ length: lines }, (_, i) => `- item ${i}`).join('\n'), by, at: NOW })
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }

describe('size rule', () => {
  it('up to ~100 items go the direct way, more go to the relay', () => {
    expect(RELAY_ITEMS_MAX).toBe(100)
    expect(relayNeeded(noteOf(100))).toBe(false)
    expect(relayNeeded(noteOf(101))).toBe(true)
  })
  it('counts nested items too', () => {
    const n = newNote({ title: 't', text: '- a\n  - b\n    - c', by, at: NOW })
    expect(relayNeeded(n, 2)).toBe(true)
    expect(relayNeeded(n, 3)).toBe(false)
  })
  it('a note goes to the relay when the direct way is unavailable', () => {
    expect(relayNeeded(noteOf(3), RELAY_ITEMS_MAX, false)).toBe(true)
  })
})

describe('on / off', () => {
  it('is on by default, ignores junk, round-trips on this device', () => {
    const st = mem()
    expect(readRelayOn(st)).toBe(true)
    st.setItem('trustweb.ui.notesrelay', 'x')
    expect(readRelayOn(st)).toBe(true)
    writeRelayOn(false, st)
    expect(readRelayOn(st)).toBe(false)
    writeRelayOn(true, st)
    expect(readRelayOn(st)).toBe(true)
  })
})

describe('sealing', () => {
  it('only the recipient opens it; the ciphertext holds no note text', async () => {
    const note = forward(noteOf(5), 'Ben', by, NOW)
    const sealed = await sealNote(note, ANNA, BEN.did)
    expect(new TextDecoder().decode(sealed)).not.toContain('item 3')
    expect(await openNote(sealed, BEN, ANNA.did)).toEqual(note)
    expect(await openNote(sealed, createIdentity('https://x.invalid/relay'), ANNA.did)).toBeNull()
    expect(await openNote(sealed.slice(0, 10), BEN, ANNA.did)).toBeNull()
  })
})

describe('chunks', () => {
  it('split and frame keep every byte; a missing piece gives null', () => {
    const bytes = Uint8Array.from({ length: 25 }, (_, i) => i)
    expect(splitBytes(bytes, 10).map((c) => c.length)).toEqual([10, 10, 5])
    const frames = frameChunks(bytes, 10)
    expect(frames).toHaveLength(3)
    expect(joinFrames([frames[2], frames[0], frames[1]])).toEqual(bytes)
    expect(joinFrames([frames[0], frames[2]])).toBeNull()
    expect(joinFrames([])).toBeNull()
  })
  it('frames of two different sets never mix', () => {
    const a = frameChunks(new Uint8Array([1, 2, 3]), 2)
    const b = frameChunks(new Uint8Array([9, 9, 9]), 2)
    expect(joinFrames([a[0], b[1]])).toBeNull()
  })
})

describe('envelope', () => {
  it('carries to, from, base64 blob, size and an expiry at most 30 days ahead', () => {
    const e = relayEnvelope(BEN.did, ANNA.did, new Uint8Array([1, 2, 3]), NOW)
    expect(e).toEqual({ to: BEN.did, from: ANNA.did, blob: 'AQID', size: 3, expires: NOW + RELAY_TTL_MS })
    expect(RELAY_TTL_MS).toBeLessThanOrEqual(30 * 86_400_000)
  })
})

describe('token', () => {
  it('is 64 hex, differs per role and per key, and is stable', async () => {
    const a = await relayToken(ANNA, 'send')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await relayToken(ANNA, 'send')).toBe(a)
    expect(await relayToken(ANNA, 'read')).not.toBe(a)
    expect(await relayToken(BEN, 'send')).not.toBe(a)
  })
})

/** A fake relay server: the same four calls the real one answers. */
function fakeServer() {
  const box = []
  let n = 0
  const calls = []
  const fetch = async (url, init = {}) => {
    const u = new URL(url, 'https://x.invalid')
    calls.push(`${init.method ?? 'GET'} ${u.pathname}${u.search}`)
    const json = (status, body) => ({ status, ok: status < 300, json: async () => body })
    if (init.method === 'POST') { const b = JSON.parse(init.body); const id = `id${n++}`; box.push({ id, ...b }); return json(201, { id }) }
    if (init.method === 'DELETE') { const i = box.findIndex((x) => x.id === u.searchParams.get('id')); if (i >= 0) box.splice(i, 1); return { status: 204, ok: true } }
    const id = u.searchParams.get('id')
    if (id) { const m = box.find((x) => x.id === id); return m ? json(200, m) : json(404, {}) }
    const mine = box.filter((x) => x.to === u.searchParams.get('for'))
    return mine.length ? json(200, { items: mine.map(({ id: i, from, size, expires }) => ({ id: i, from, size, expires })) }) : json(404, {})
  }
  return { fetch, box, calls }
}

describe('post and poll', () => {
  it('a big note goes up sealed and the recipient gets it back, then the blobs are deleted', async () => {
    const srv = fakeServer()
    const note = forward(noteOf(150), 'Ben', by, NOW)
    expect(await postNote({ origin: 'https://x.invalid', fetch: srv.fetch, now: () => NOW }, note, ANNA, BEN.did)).toBe(true)
    expect(JSON.stringify(srv.box)).not.toContain('item 3')
    const got = await pollRelay({ origin: 'https://x.invalid', fetch: srv.fetch, now: () => NOW }, BEN)
    expect(got).toEqual([{ from: ANNA.did, note }])
    expect(srv.box).toEqual([])
  })
  it('nothing waiting (404) is an empty answer, and a note that does not open stays on the server', async () => {
    const srv = fakeServer()
    expect(await pollRelay({ origin: 'https://x.invalid', fetch: srv.fetch, now: () => NOW }, BEN)).toEqual([])
    await postNote({ origin: 'https://x.invalid', fetch: srv.fetch, now: () => NOW }, noteOf(3), ANNA, BEN.did)
    const stranger = createIdentity('https://x.invalid/relay')
    srv.box[0].to = stranger.did
    expect(await pollRelay({ origin: 'https://x.invalid', fetch: srv.fetch, now: () => NOW }, stranger)).toEqual([])
    expect(srv.box).toHaveLength(1)
  })
  it('a note from a sender nobody here knows is left alone', async () => {
    const srv = fakeServer()
    await postNote({ origin: 'https://x.invalid', fetch: srv.fetch, now: () => NOW }, noteOf(3), ANNA, BEN.did)
    expect(await pollRelay({ origin: 'https://x.invalid', fetch: srv.fetch, now: () => NOW }, BEN, () => false)).toEqual([])
    expect(srv.box).toHaveLength(1)
  })
  it('a failing server makes postNote false and pollRelay empty, never a throw', async () => {
    const down = async () => { throw new Error('offline') }
    expect(await postNote({ origin: 'https://x.invalid', fetch: down, now: () => NOW }, noteOf(3), ANNA, BEN.did)).toBe(false)
    expect(await pollRelay({ origin: 'https://x.invalid', fetch: down, now: () => NOW }, BEN)).toEqual([])
  })
})
