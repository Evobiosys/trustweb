// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c social-hosting: the app's signed bytes (name_record.ts, did.ts) and the server's check (services/trustweb-backup/directory.mjs) agree. */
import { createIdentity, signBytes } from '../../../demo/src/did.ts'
import { makeIntent, makeRecord, normName } from '../../src/name_record.ts'
import { checkIntent, checkRecord, normName as serverNorm, verifyDid } from '../../../../services/trustweb-backup/directory.mjs'

const id = createIdentity('https://x.test')
const sign = (bytes) => signBytes(id, bytes)

describe('app and server agree', () => {
  it('the server accepts a record made by the app, and stores it without hosts', () => {
    const r = makeRecord(sign, { first: 'Zoë', last: 'Müller-Ka', key: id.did, ts: 7, open: true, srv: true, hosts: ['did:a'] })
    const stored = checkRecord(r)
    expect(stored).not.toBeNull()
    expect(stored.hosts).toEqual([])
  })
  it('the server refuses what the app signed with srv false, or with a changed field', () => {
    expect(checkRecord(makeRecord(sign, { first: 'A', last: 'B', key: id.did, ts: 1, open: true, srv: false }))).toBeNull()
    expect(checkRecord({ ...makeRecord(sign, { first: 'A', last: 'B', key: id.did, ts: 1, open: true, srv: true }), ts: 2 })).toBeNull()
  })
  it('wave44b: the server accepts a record with signed extra, keeps it, and refuses a changed or unknown one', () => {
    const r = makeRecord(sign, { first: 'A', last: 'B', key: id.did, ts: 1, open: true, srv: true, extra: { nickname: 'Ab' } })
    expect(checkRecord(r)?.extra).toEqual({ nickname: 'Ab' })
    expect(checkRecord({ ...r, extra: { nickname: 'Eve' } })).toBeNull()
    expect(checkRecord(makeRecord(sign, { first: 'A', last: 'B', key: id.did, ts: 1, open: true, srv: true, extra: { shoe: '1' } }))).toBeNull()
  })
  it('the server accepts an intent made by the app', () => {
    expect(checkIntent(makeIntent(sign, { to: 'did:x', first: 'A', last: 'B', key: id.did, ts: 3 }))).not.toBeNull()
  })
  it('both normalise a name the same way', () => {
    for (const [f, l] of [['Ada', 'Lovelace'], [' ADA ', 'love  lace'], ['Zoë', 'K'], ['ﬁna', 'Ｘ']]) expect(serverNorm(f, l)).toBe(normName(f, l))
  })
  it('verifyDid rejects what is not a did:peer:2 key', () => {
    expect(verifyDid('did:key:abc', 'x', 'sig')).toBe(false)
    expect(verifyDid(id.did, 'x', 'AAAA')).toBe(false)
  })
})
