// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Invite someone (src/invite.ts, wave 21): which link, the share-or-copy step, and when the counter bumps. */
import { inviteText, sendInvite } from '../../src/invite.ts'

const CONNECT = 'https://app.trustintheweb.org/c/AbCdEfGhIjKlMnOpQrStUv'

describe('inviteText', () => {
  it('uses the public link when I hold a name', () => {
    const i = inviteText('ada', CONNECT)
    expect(i.url).toBe('https://trustweb.one/ada')
    expect(i.text).toBe('Join my web of trust on TrustWeb: https://trustweb.one/ada')
    expect(i.title).toBe('TrustWeb')
  })
  it('falls back to the connect link without a name', () => {
    const i = inviteText(null, CONNECT)
    expect(i.url).toBe(CONNECT)
    expect(i.text.endsWith(CONNECT)).toBe(true)
  })
})

describe('sendInvite', () => {
  const inv = inviteText('ada', CONNECT)
  it('counts a share that resolved', async () => {
    expect(await sendInvite(inv, { share: async () => {}, copy: async () => { throw new Error('no') } })).toBe(true)
  })
  it('does not count a share that was rejected (sheet closed)', async () => {
    expect(await sendInvite(inv, { share: async () => { throw new Error('AbortError') }, copy: async () => {} })).toBe(false)
  })
  it('copies when there is no share sheet, and counts the copy', async () => {
    let copied = ''
    expect(await sendInvite(inv, { copy: async (t) => { copied = t } })).toBe(true)
    expect(copied).toBe(inv.text)
  })
  it('does not count a failed copy', async () => {
    expect(await sendInvite(inv, { copy: async () => { throw new Error('denied') } })).toBe(false)
  })
})
