/** Dev second device: the frame sources and the link rewrite. */
import { deviceSrc, nextDev, rewriteLink } from '../../src/dev_device2.ts'

describe('dev second device', () => {
  it('each kind opens on the stock twin origin', () => {
    expect(deviceSrc('new', 5336, 1)).toBe('http://127.0.0.1:5336/?dev=1')
    expect(deviceSrc('existing', 5336, 2)).toBe('http://127.0.0.1:5336/?persona=seeker&solo=1&ctx=generic&dev=2')
    expect(deviceSrc('organizer', 5336, 6)).toBe('http://127.0.0.1:5336/organizer.html?dev=6')
  })
  it('a pasted link keeps path, search and hash on the twin origin', () => {
    expect(rewriteLink(' https://app.trustweb.one/#ev=abc ', 5336, 3)).toBe('http://127.0.0.1:5336/?dev=3#ev=abc')
    expect(rewriteLink('https://app.trustweb.one/a/b?x=1#k=2', 5336, 1)).toBe('http://127.0.0.1:5336/a/b?x=1&dev=1#k=2')
  })
  it('text that is no link gives null', () => {
    expect(rewriteLink('hello', 5336, 1)).toBeNull()
  })
  it('nextDev takes the lowest free number and gives null with six open', () => {
    expect(nextDev([])).toBe(1)
    expect(nextDev([1, 3])).toBe(2)
    expect(nextDev([1, 2, 3, 4, 5, 6])).toBeNull()
  })
})
