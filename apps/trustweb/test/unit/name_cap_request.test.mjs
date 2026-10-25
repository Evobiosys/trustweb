// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 21: the "Ask for more (organizers)" request (src/name_cap_request.ts): payload shape, caps on lengths, the three outcomes.
import { CAP_REASON_MAX, CAP_WANTED_DEFAULT, CAP_WANTED_MAX, capRequestBody, sendCapRequest } from '../../src/name_cap_request.ts'

const ORIGIN = 'https://app.trustintheweb.org'
const record = { code: 'AbCdEfGhIjKlMnOpQrStUv', secret: 'S'.repeat(43), url: ORIGIN + '/?connect=x', updatedAt: 1, name: 'ada', aliases: [] }
const deps = (status) => {
  const calls = []
  return { calls, origin: ORIGIN, now: () => 1, fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); if (status === 0) throw new TypeError('offline'); return { status, json: async () => ({}) } } }
}

describe('capRequestBody', () => {
  it('carries the credentials, the held name, the reason and the count', () => {
    expect(capRequestBody(record, 'Meetup', 10)).toEqual({ code: record.code, secret: record.secret, name: 'ada', reason: 'Meetup', wanted: 10 })
  })
  it('trims and caps the reason at 280 and the count between 1 and 50; a bad count falls back to the default', () => {
    expect(capRequestBody(record, '  ' + 'x'.repeat(400), 999)).toMatchObject({ reason: 'x'.repeat(CAP_REASON_MAX), wanted: CAP_WANTED_MAX })
    expect(capRequestBody(record, 'r', 0).wanted).toBe(1)
    expect(capRequestBody(record, 'r', Number.NaN).wanted).toBe(CAP_WANTED_DEFAULT)
  })
  it('is null without a reason or a name', () => {
    expect(capRequestBody(record, '   ', 10)).toBeNull()
    expect(capRequestBody({ ...record, name: '' }, 'r', 10)).toBeNull()
  })
})

describe('sendCapRequest', () => {
  it('202 -> sent, to /names/cap-request', async () => {
    const d = deps(202)
    expect(await sendCapRequest(d, record, 'Meetup', 10)).toBe('sent')
    expect(d.calls[0].url).toBe(ORIGIN + '/names/cap-request')
  })
  it('429 -> throttled; other answers and no network -> failed; nothing is sent without a reason', async () => {
    expect(await sendCapRequest(deps(429), record, 'r', 5)).toBe('throttled')
    expect(await sendCapRequest(deps(500), record, 'r', 5)).toBe('failed')
    expect(await sendCapRequest(deps(0), record, 'r', 5)).toBe('failed')
    const d = deps(202)
    expect(await sendCapRequest(d, record, '', 5)).toBe('failed')
    expect(d.calls).toHaveLength(0)
  })
})
