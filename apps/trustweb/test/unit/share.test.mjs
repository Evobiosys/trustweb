/**
 * Sending a meeting inside TrustWeb (src/share.ts): the link's fragment carries
 * the key and never reaches a server; a chat text is only understood when it
 * points at this very app; a pack off the server is shape-checked.
 */
import { isMeetingPack, parseShareFragment, parseShareText, shareFragment, shareUrl } from '../../src/share.ts'

const APP = 'https://app.idea2.site/trustweb/'
const KEY = 'TW1R-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567-89ABC-DEFGH-JKMNP-QRSTV-WXY'

describe('share link', () => {
  it('round-trips key and title through the fragment', () => {
    const link = { keyText: KEY, title: 'Meeting with Max' }
    const frag = shareFragment(link)
    expect(frag).toMatch(/^k=TW1R-/)
    expect(parseShareFragment('#' + frag)).toEqual(link)
    expect(parseShareFragment(frag)).toEqual(link)
  })
  it('reads the share parts out of a connect link fragment that also carries notes', () => {
    expect(parseShareFragment('#n=hello%20there&' + shareFragment({ keyText: KEY, title: 'T' }))).toEqual({ keyText: KEY, title: 'T' })
  })
  it('is null without a valid key', () => {
    expect(parseShareFragment('#n=notes')).toBeNull()
    expect(parseShareFragment('#k=not-a-key&t=x')).toBeNull()
    expect(parseShareFragment('')).toBeNull()
  })
  it('the URL points at the app with ?share=1 and the key in the fragment only', () => {
    const url = shareUrl(APP, { keyText: KEY, title: 'Meeting with Max' })
    expect(url.startsWith(APP + '?share=1#k=')).toBe(true)
    expect(new URL(url).search).toBe('?share=1')
    expect(url.length).toBeLessThan(500)
  })
  it('a chat text is understood only when it is this app\'s own share link', () => {
    const url = shareUrl(APP, { keyText: KEY, title: 'Meeting with Max' })
    expect(parseShareText(APP, url)).toEqual({ keyText: KEY, title: 'Meeting with Max' })
    expect(parseShareText(APP, 'https://evil.example/?share=1#k=' + KEY)).toBeNull()
    expect(parseShareText(APP, 'hello')).toBeNull()
    expect(parseShareText('https://other.site/', url)).toBeNull()
  })
})

describe('isMeetingPack', () => {
  const pack = { v: 1, kind: 'meeting', from: 'Jakob', about: 'Max', where: 'Café', startedAt: 1, durationMs: 2, notes: ['a'], transcript: [{ speaker: 1, atMs: 0, text: 'hi' }] }
  it('accepts a well-formed pack', () => expect(isMeetingPack(pack)).toBe(true))
  it('rejects anything else', () => {
    expect(isMeetingPack(null)).toBe(false)
    expect(isMeetingPack({ ...pack, kind: 'record' })).toBe(false)
    expect(isMeetingPack({ ...pack, notes: [1] })).toBe(false)
    expect(isMeetingPack({ ...pack, transcript: [{ speaker: '1', atMs: 0, text: 'x' }] })).toBe(false)
    expect(isMeetingPack({ ...pack, from: undefined })).toBe(false)
  })
})
