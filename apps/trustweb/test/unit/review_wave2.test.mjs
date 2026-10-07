/**
 * review-wave2 (2026-10-07), what the adversarial review of wave 2 fixed in the app:
 *   - the transcription consent is built from the server's provider block (/hosted/status, contract v1.5), never from a
 *     hardcoded route: OpenRouter/US/deny, Infomaniak/CH, an unknown or absent block (generic, no names);
 *   - the hosting allowance counts the recordings the server enforces (maxRecordings), and "reached" covers the count.
 */
import { InferenceRegion, ProviderDataPolicy, TranscribeProviderName } from '../../src/model.ts'
import { parseProviderInfo, parseStatus } from '../../src/swiss_server.ts'
import { allowanceOf, allowanceReached } from '../../src/hosting.ts'
import { S } from '../../src/strings.ts'

const OPENROUTER = { transcribe: { enabled: true, provider: 'openrouter', region: 'us', dataPolicy: 'deny' } }

describe('the provider block of /hosted/status', () => {
  it('is read defensively: known values only, anything else null', () => {
    expect(parseProviderInfo(OPENROUTER)).toEqual({ provider: TranscribeProviderName.OpenRouter, region: InferenceRegion.Us, dataPolicy: ProviderDataPolicy.Deny })
    expect(parseProviderInfo({ transcribe: { provider: 'acme', region: 'mars', dataPolicy: 1 } })).toEqual({ provider: null, region: null, dataPolicy: null })
    for (const v of [undefined, null, 'x', {}, { transcribe: null }, { transcribe: 'openrouter' }]) expect(parseProviderInfo(v)).toBeNull()
    expect(parseStatus({ hosted: true, transcribe: true, feedback: true, plan: null, provider: OPENROUTER }).provider?.provider).toBe('openrouter')
    expect(parseStatus({ hosted: true, transcribe: false, feedback: true, plan: null }).provider).toBeNull() // the server before wave 2
  })
})

describe('the consent says what the server reports, nothing more', () => {
  it('OpenRouter in the US with "deny": names OpenRouter, the US, the policy; no provider it cannot pick, no Infomaniak', () => {
    const c = S.consentBody(parseProviderInfo(OPENROUTER), 10)
    expect(c).toMatch(/our server in Switzerland to OpenRouter/)
    expect(c).toMatch(/in the United States/)
    expect(c).toMatch(/OpenRouter picks which one/)
    expect(c).toMatch(/data policy "deny"/)
    expect(c).toMatch(/not end-to-end encrypted/)
    expect(c).toMatch(/We keep neither the audio nor the text/)
    expect(c).toMatch(/up to 10 hours of audio per person, within a daily budget shared by everyone/)
    expect(c).not.toMatch(/Infomaniak|DeepInfra|Groq|Together/)
  })
  it('Infomaniak in Switzerland: names it, says nothing about a data policy it does not have', () => {
    const c = S.consentBody({ provider: TranscribeProviderName.Infomaniak, region: InferenceRegion.Ch, dataPolicy: null }, 2.5)
    expect(c).toMatch(/transcription service of Infomaniak in Switzerland/)
    expect(c).not.toMatch(/OpenRouter|United States|data policy/)
    expect(c).toMatch(/up to 2\.5 hours/)
  })
  it('"allow" is said plainly, never as "not used for training"', () => {
    const c = S.consentBody({ provider: TranscribeProviderName.OpenRouter, region: InferenceRegion.Us, dataPolicy: ProviderDataPolicy.Allow }, 10)
    expect(c).toMatch(/its own terms apply/)
    expect(c).not.toMatch(/not used for training/)
  })
  it('no block (an older server) or an unknown provider: a generic route, no names, no number it was not given', () => {
    for (const p of [null, { provider: null, region: null, dataPolicy: null }]) {
      const c = S.consentBody(p, null)
      expect(c).toMatch(/to an outside transcription service, which turns it into text/)
      expect(c).not.toMatch(/OpenRouter|Infomaniak|United States|DeepInfra|data policy|hours/)
      expect(c).toMatch(/Free while we test\.$/)
    }
  })
  it('the Settings hint names no provider (it asks once and names them then)', () => {
    const hints = Object.values(S.setTranscriptionHint).join(' ')
    expect(hints).not.toMatch(/OpenRouter|Infomaniak|United States|DeepInfra/)
  })
})

describe('the hosting allowance is the count the server enforces', () => {
  const u = (extra) => ({ secondsUsed: 3600, secondsLimit: 36000, recordings: 3, maxSecondsPerRecording: 3600, ...extra })
  it('of maxRecordings when the server says it; derived only when it does not', () => {
    expect(allowanceOf(u({ maxRecordings: 10 })).recordingsLimit).toBe(10)
    expect(allowanceOf(u({ maxRecordings: 50 })).recordingsLimit).toBe(50) // the server before wave 2 enforced 50 slots
    expect(allowanceOf(u({ maxRecordings: 0 })).recordingsLimit).toBe(10)
    expect(allowanceOf(u({})).recordingsLimit).toBe(10)
  })
  it('reached by count (10 short recordings) or by hours, not before', () => {
    expect(allowanceReached(u({ recordings: 10, maxRecordings: 10, secondsUsed: 600 }))).toBe(true)
    expect(allowanceReached(u({ recordings: 2, maxRecordings: 10, secondsUsed: 36000 }))).toBe(true)
    expect(allowanceReached(u({ recordings: 9, maxRecordings: 10, secondsUsed: 35999 }))).toBe(false)
  })
})
