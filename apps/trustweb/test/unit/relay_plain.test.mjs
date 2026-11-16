// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// review-fixes-43c: what a relay operator can read in a stored wire: the raw text and every base64/base64url token decoded.
import { describe, expect, it } from 'vitest'
import { plainHits, wireKind } from '../helpers/relay_plain.mjs'

const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url')

describe('plainHits', () => {
  it('finds a name in the raw wire', () => {
    expect(plainHits('{"t":"connect-ack","from":{"displayName":"Otto"}}', ['Otto', 'Ada'])).toEqual(['Otto'])
  })
  it('finds a name hidden in a base64url token', () => {
    expect(plainHits(JSON.stringify({ to: 'did:x', body: b64u('{"name":"Ada Lovelace"}') }), ['Ada'])).toEqual(['Ada'])
  })
  it('stays silent on sealed bytes', () => {
    const sealed = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256)).toString('base64url')
    expect(plainHits(JSON.stringify({ body: sealed }), ['Ada', 'Otto'])).toEqual([])
  })
})

describe('wireKind', () => {
  it('names the cleartext connect-ack (raw or inside a token), else sealed', () => {
    expect(wireKind('{"v":1,"t":"connect-ack"}')).toBe('connect-ack')
    expect(wireKind(JSON.stringify({ p: b64u('{"v":1,"t":"connect-ack"}') }))).toBe('connect-ack')
    expect(wireKind(JSON.stringify({ payload: '{"v":1,"t":"connect-ack"}' }))).toBe('connect-ack') // escaped inside the relay's outer JSON
    expect(wireKind('{"p":"AAAA"}')).toBe('other')
  })
})
