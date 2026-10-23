/**
 * Wave 20 qr-replay-guard: a connect link the app issues carries a nonce and an issue time; the receiver refuses an old or a used one.
 * A link without them (older app) is accepted and flagged; the public address (/c/<code>, /who/<name>) stays reusable.
 */
import { CONNECT_WINDOW_MS, check, issue, prune, readStamp, remember, stampUrl } from '../../src/connect_freshness.ts'
import { parseAddInput, AddKind } from '../../src/add_by_code.ts'
import { createIdentity } from '../../../demo/src/did.ts'
import { buildConnectLinkUrl } from '../../../demo/src/connect_link.ts'

const NOW = 1_800_000_000_000
const ORIGIN = 'https://app.trustintheweb.org'
const DID = createIdentity(`${ORIGIN}/relay`).did
const LONG = buildConnectLinkUrl(ORIGIN + '/', DID, { id: 'p1p1p1p1p1p1', displayName: 'Ada' })

describe('issue / stampUrl / readStamp', () => {
  it('a nonce has at least 96 bits and differs every time', () => {
    const a = issue(NOW), b = issue(NOW)
    expect(a.issuedAt).toBe(NOW)
    expect(a.nonce).toMatch(/^[A-Za-z0-9_-]{16,}$/)
    expect(a.nonce).not.toBe(b.nonce)
  })
  it('the stamp rides as nonce= and ts= and reads back; the old parameters stay', () => {
    const s = issue(NOW)
    const url = stampUrl(LONG, s)
    expect(readStamp(new URL(url).search)).toEqual(s)
    expect(new URL(url).searchParams.get('connect')).toBe(DID)
    expect(new URL(url).searchParams.get('id')).toBe('p1p1p1p1p1p1')
  })
  it('no stamp reads as empty; rubbish reads as empty', () => {
    expect(readStamp(new URL(LONG).search)).toEqual({})
    expect(readStamp('?nonce=abc&ts=zzz')).toEqual({})
  })
})

describe('check', () => {
  const fresh = (age = 0) => ({ nonce: 'n'.repeat(16), issuedAt: NOW - age })
  it('a fresh link is ok, not legacy', () => expect(check(fresh(), [], NOW)).toEqual({ ok: true, legacy: false }))
  it('older than the window is expired; just inside is ok', () => {
    expect(check(fresh(CONNECT_WINDOW_MS + 1), [], NOW)).toEqual({ ok: false, reason: 'expired' })
    expect(check(fresh(CONNECT_WINDOW_MS), [], NOW).ok).toBe(true)
  })
  it('a time far in the future is refused', () => expect(check(fresh(-3_600_000), [], NOW)).toEqual({ ok: false, reason: 'expired' }))
  it('a nonce seen before is replayed', () => {
    const seen = remember([], fresh().nonce, NOW)
    expect(check(fresh(), seen, NOW)).toEqual({ ok: false, reason: 'replayed' })
  })
  it('a half stamp is refused', () => {
    expect(check({ nonce: 'n'.repeat(16) }, [], NOW)).toEqual({ ok: false, reason: 'expired' })
    expect(check({ issuedAt: NOW }, [], NOW)).toEqual({ ok: false, reason: 'expired' })
  })
  it('no stamp at all (older app) is accepted and flagged legacy', () => expect(check({}, [], NOW)).toEqual({ ok: true, legacy: true }))
  it('the public address is accepted unflagged, again and again', () => {
    expect(check({ exempt: true }, [], NOW)).toEqual({ ok: true, legacy: false })
  })
})

describe('ledger', () => {
  it('remember adds and prunes past the window', () => {
    const old = remember([], 'old', NOW - CONNECT_WINDOW_MS - 1)
    const next = remember(old, 'new', NOW)
    expect(next.map((x) => x.nonce)).toEqual(['new'])
    expect(prune([{ nonce: 'a', at: NOW }], NOW + CONNECT_WINDOW_MS + 1)).toEqual([])
  })
})

describe('add_by_code keeps the stamp of a pasted long link', () => {
  it('a stamped link parses with nonce and issuedAt', () => {
    const s = issue(NOW)
    const p = parseAddInput(stampUrl(LONG, s), ORIGIN)
    expect(p.ok && p.kind === AddKind.LongLink && p.link.nonce === s.nonce && p.link.issuedAt === s.issuedAt).toBe(true)
  })
  it('an unstamped link parses without them', () => {
    const p = parseAddInput(LONG, ORIGIN)
    expect(p.ok && p.kind === AddKind.LongLink && p.link.nonce === undefined).toBe(true)
  })
})
