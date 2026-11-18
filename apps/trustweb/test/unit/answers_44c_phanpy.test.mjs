// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c answers-44c item 3 (Jakob 20:22): Phanpy self-hosted on questhub, on its own origin (phanpy.trustweb.one), phanpy.social a typed fallback. */
import { readFileSync } from 'node:fs'
import { PHANPY_DEFAULT_ORIGIN, PHANPY_DEFAULT_URL, PHANPY_FALLBACK_URL, PHANPY_PINNED_RELEASE, PHANPY_PINNED_SHA256, parsePhanpyUrl, phanpyUrl, setPhanpyUrl } from '../../src/ext/phanpy/phanpy_model.ts'

const APP = 'https://app.trustweb.one'
describe('answers-44c phanpy self-hosted', () => {
  it('defaults to the self-hosted copy on its own origin, never the app origin', () => {
    expect(PHANPY_DEFAULT_ORIGIN).toBe('https://phanpy.trustweb.one')
    expect(PHANPY_DEFAULT_URL).toBe('https://phanpy.trustweb.one/')
    expect(phanpyUrl({})).toBe(PHANPY_DEFAULT_URL)
    expect(parsePhanpyUrl(PHANPY_DEFAULT_URL, APP)).toBe(PHANPY_DEFAULT_URL)
    expect(new URL(PHANPY_DEFAULT_URL).origin).not.toBe(APP)
  })
  it('phanpy.social stays a fallback the user can type; empty goes back to the self-hosted one', () => {
    expect(PHANPY_FALLBACK_URL).toBe('https://phanpy.social/')
    const s = {}
    expect(setPhanpyUrl(s, 'phanpy.social', APP)).toBe(PHANPY_FALLBACK_URL)
    expect(phanpyUrl(s)).toBe(PHANPY_FALLBACK_URL)
    expect(setPhanpyUrl(s, '', APP)).toBe(PHANPY_DEFAULT_URL)
    expect(s.extData.phanpy).toEqual({})
  })
  it('pins the release with the checksum of its dist asset', () => {
    expect(PHANPY_PINNED_RELEASE).toBe('2026.10.09.febb38d')
    expect(PHANPY_PINNED_SHA256).toBe('42a45f0df92ac10840f3064c46d60e34b2ab2029574ee4593062cfcc1663a9e0')
  })
  it('the hint names the self-hosted copy and the fallback', async () => {
    const { S } = await import('../../src/strings.ts')
    expect(S.feedExt.phanpyUrlHint).toMatch(/phanpy\.trustweb\.one/)
    expect(S.feedExt.phanpyUrlHint).toMatch(/phanpy\.social/)
  })
  it('keeps the MIT notice', () => {
    const notice = readFileSync(new URL('../../../../NOTICE', import.meta.url), 'utf8')
    expect(notice).toMatch(/Phanpy[\s\S]*MIT/)
  })
})
