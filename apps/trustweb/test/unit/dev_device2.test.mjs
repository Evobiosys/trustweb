/** Dev second device: the frame sources and the link rewrite. */
import { deviceSrc, rewriteLink } from '../../src/dev_device2.ts'

describe('dev second device', () => {
  it('each kind opens on the stock twin origin', () => {
    expect(deviceSrc('new', 5336)).toBe('http://127.0.0.1:5336/')
    expect(deviceSrc('existing', 5336)).toBe('http://127.0.0.1:5336/?persona=seeker&solo=1&ctx=generic')
    expect(deviceSrc('organizer', 5336)).toBe('http://127.0.0.1:5336/organizer.html')
  })
  it('a pasted link keeps path, search and hash on the twin origin', () => {
    expect(rewriteLink(' https://app.trustweb.one/#ev=abc ', 5336)).toBe('http://127.0.0.1:5336/#ev=abc')
    expect(rewriteLink('https://app.trustweb.one/a/b?x=1#k=2', 5336)).toBe('http://127.0.0.1:5336/a/b?x=1#k=2')
  })
  it('text that is no link gives null', () => {
    expect(rewriteLink('hello', 5336)).toBeNull()
  })
})
