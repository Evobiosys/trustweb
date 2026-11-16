// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-invite-link: the community invite token (Ed25519-signed by the inviter's DID key) and the inviter's counter.
 * Fake identities only.
 */
import { createIdentity, signBytes, verifyDidSignature } from '../../../demo/src/did.ts'
import {
  INVITE_DAYS, INVITE_TRIES_PER_HOUR, OPEN_INVITE_MAX_USES, createInvite, inviteLink, inviteOfHash, inviteSettingsOf, inviteStatus,
  openInviteOf, addInvite, redeemInvite, revokeInvites, setOpenMax, takeInvite, verifyInvite,
} from '../../src/invite_policy.ts'

const DAY = 86_400_000
const inviter = createIdentity('https://relay.example/relay')
const other = createIdentity('https://relay.example/relay')
const a = createIdentity('https://relay.example/relay')
const b = createIdentity('https://relay.example/relay')
const c = createIdentity('https://relay.example/relay')
const sign = (bytes) => signBytes(inviter, bytes)
const verifyAs = (did) => (bytes, sig) => verifyDidSignature(did, bytes, sig)
const T0 = Date.UTC(2026, 10, 16, 10)
let n = 0
const make = (kind, settings) => createInvite({ kind, tag: 'iyg', label: 'IYG', inviterDid: inviter.did, inviterName: 'Ina', id: `id${++n}abcdefgh`, now: T0, settings, sign })
const redeem = (ledger, tok, fromDid, now = T0 + 1000) => redeemInvite(ledger, tok, { myDid: inviter.did, fromDid, now, verify: verifyAs(inviter.did) })

describe('defaults', () => {
  it('open link 10 uses, 30 days; clamps Advanced input', () => {
    expect(OPEN_INVITE_MAX_USES).toBe(10)
    expect(INVITE_DAYS).toBe(30)
    expect(inviteSettingsOf(undefined)).toEqual({ max: 10, days: 30 })
    expect(inviteSettingsOf({ max: 0, days: 9999 })).toEqual({ max: 1, days: 365 })
    const o = make('open')
    expect(o.max).toBe(10)
    expect(o.x).toBe(T0 + 30 * DAY)
    expect(make('personal').max).toBe(1)
    expect(make('open', { max: 3, days: 2 })).toMatchObject({ max: 3, x: T0 + 2 * DAY })
  })
})

describe('token sign / verify', () => {
  it('verifies against the inviter DID and shows name + community', () => {
    const e = make('personal')
    const v = verifyInvite(e.tok, inviter.did, T0, verifyAs(inviter.did))
    expect(v).toMatchObject({ ok: true, inv: { k: 'p', n: 'Ina', l: 'IYG', t: 'iyg', id: e.id } })
  })
  it('tampered payload, tampered signature, another DID: tampered', () => {
    const e = make('open')
    const [p, s] = e.tok.split('.')
    const flip = (x) => (x[5] === 'A' ? x.slice(0, 5) + 'B' + x.slice(6) : x.slice(0, 5) + 'A' + x.slice(6))
    expect(verifyInvite(`${flip(p)}.${s}`, inviter.did, T0, verifyAs(inviter.did))).toEqual({ ok: false, reason: 'tampered' })
    expect(verifyInvite(`${p}.${flip(s)}`, inviter.did, T0, verifyAs(inviter.did))).toEqual({ ok: false, reason: 'tampered' })
    // a token moved onto another person's link (another connect DID) fails
    expect(verifyInvite(e.tok, other.did, T0, verifyAs(other.did))).toEqual({ ok: false, reason: 'tampered' })
    // a forger re-signs a changed payload with its own key: fails against the inviter's DID
    const forged = createInvite({ kind: 'open', tag: 'iyg', label: 'IYG', inviterDid: inviter.did, inviterName: 'Ina', id: 'forged12345', now: T0, sign: (bytes) => signBytes(other, bytes) })
    expect(verifyInvite(forged.tok, inviter.did, T0, verifyAs(inviter.did))).toEqual({ ok: false, reason: 'tampered' })
    expect(verifyInvite('garbage', inviter.did, T0, verifyAs(inviter.did))).toEqual({ ok: false, reason: 'tampered' })
  })
  it('expired', () => {
    const e = make('open')
    expect(verifyInvite(e.tok, inviter.did, T0 + 31 * DAY, verifyAs(inviter.did))).toEqual({ ok: false, reason: 'expired' })
  })
  it('the link carries the token in the fragment only', () => {
    const e = make('open')
    const link = inviteLink('https://app.example/?connect=did:x&id=1&name=Ina&k=abc', e)
    const u = new URL(link)
    expect(u.search).not.toContain(e.tok.slice(0, 20))
    expect(inviteOfHash(u.hash)).toBe(e.tok)
    expect(inviteOfHash('#n=x')).toBeNull()
  })
})

describe('the inviter counter', () => {
  it('personal: single use, bound to the first recipient; a resent ack of that recipient stays accepted', () => {
    const e = make('personal')
    let ledger = addInvite([], e)
    const first = redeem(ledger, e.tok, a.did)
    expect(first.ok).toBe(true)
    ledger = first.ledger
    expect(ledger[0].uses).toEqual([{ did: a.did, at: T0 + 1000 }])
    expect(redeem(ledger, e.tok, a.did).ok).toBe(true)
    const second = redeem(ledger, e.tok, b.did)
    expect(second).toMatchObject({ ok: false, reason: 'used' })
    expect(second.ledger[0].uses).toHaveLength(1)
  })
  it('open: counter limit', () => {
    const e = make('open', { max: 2 })
    let ledger = addInvite([], e)
    for (const who of [a, b]) { const r = redeem(ledger, e.tok, who.did); expect(r.ok).toBe(true); ledger = r.ledger }
    expect(redeem(ledger, e.tok, c.did)).toMatchObject({ ok: false, reason: 'limit' })
    // Advanced raises the limit: the same link works again
    ledger = setOpenMax(ledger, 'iyg', 3)
    expect(redeem(ledger, e.tok, c.did).ok).toBe(true)
  })
  it('expired, revoked, tampered, unknown are refused; nothing is used', () => {
    const e = make('open')
    const ledger = addInvite([], e)
    expect(redeem(ledger, e.tok, a.did, T0 + 31 * DAY)).toMatchObject({ ok: false, reason: 'expired' })
    const { ledger: rv, revoked } = revokeInvites(ledger, 'iyg')
    expect(revoked).toBe(1)
    expect(redeem(rv, e.tok, a.did)).toMatchObject({ ok: false, reason: 'revoked' })
    expect(redeem(ledger, e.tok.slice(0, -2) + 'AA', a.did)).toMatchObject({ ok: false, reason: 'tampered' })
    expect(redeem([], e.tok, a.did)).toMatchObject({ ok: false, reason: 'unknown' })
  })
  it('rate limit per token and hour', () => {
    const e = make('personal')
    let ledger = redeem(addInvite([], e), e.tok, a.did).ledger
    const others = Array.from({ length: INVITE_TRIES_PER_HOUR + 1 }, () => createIdentity('https://relay.example/relay').did)
    let last
    for (const d of others) { last = redeem(ledger, e.tok, d); ledger = last.ledger }
    expect(last).toMatchObject({ ok: false, reason: 'rate' })
    expect(redeem(ledger, e.tok, others[0], T0 + 2 * 3_600_000)).toMatchObject({ ok: false, reason: 'used' })
  })
  it('the open link is reused until used up; status never shows a DID or the token', () => {
    const e = make('open', { max: 1 })
    let ledger = addInvite([], e)
    expect(openInviteOf(ledger, 'iyg', T0)?.id).toBe(e.id)
    ledger = redeem(ledger, e.tok, a.did).ledger
    expect(openInviteOf(ledger, 'iyg', T0)).toBeUndefined()
    const st = inviteStatus(ledger, T0)
    expect(st).toEqual([{ id: e.id, kind: 'open', tag: 'iyg', community: 'IYG', uses: 1, max: 1, expiresAt: e.x, state: 'used' }])
    expect(JSON.stringify(st)).not.toContain(a.did)
    expect(JSON.stringify(st)).not.toContain(e.tok)
  })
  it('the recipient remembers links it took', () => {
    expect(takeInvite(takeInvite([], 'x'), 'x')).toEqual(['x'])
  })
})
