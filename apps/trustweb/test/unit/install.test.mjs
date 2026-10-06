/**
 * Install on the home screen (src/install.ts, wave 1733 item 5): which way to
 * install applies, and which agents count as iPhone / iPad. Plus the manifest
 * the build ships (pwa/manifest.json): standalone, scoped to the app, icons present.
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { InstallPath, installPath, isIosAgent } from '../../src/install.ts'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'

describe('installPath', () => {
  it('already installed wins over everything', () => {
    expect(installPath({ standalone: true, ios: true, promptReady: true })).toBe(InstallPath.Installed)
  })
  it('a pending Chromium prompt gives the one-tap button', () => {
    expect(installPath({ standalone: false, ios: false, promptReady: true })).toBe(InstallPath.Prompt)
  })
  it('iOS gets the Share > Add to Home Screen steps', () => {
    expect(installPath({ standalone: false, ios: true, promptReady: false })).toBe(InstallPath.Ios)
  })
  it('anything else is told about the browser menu, plainly', () => {
    expect(installPath({ standalone: false, ios: false, promptReady: false })).toBe(InstallPath.Menu)
  })
})

describe('isIosAgent', () => {
  it('knows an iPhone', () => expect(isIosAgent(IPHONE, 5)).toBe(true))
  it('knows an iPad that reports itself as a Mac with touch', () => expect(isIosAgent(IPAD, 5)).toBe(true))
  it('a real Mac (no touch) is not iOS', () => expect(isIosAgent(IPAD, 0)).toBe(false))
  it('Android is not iOS', () => expect(isIosAgent(ANDROID, 5)).toBe(false))
})

describe('pwa/manifest.json', () => {
  const dir = path.resolve(__dirname, '../../pwa')
  const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  it('is TrustWeb, standalone, scoped to wherever the app is served', () => {
    expect(m).toMatchObject({ name: 'TrustWeb', short_name: 'TrustWeb', display: 'standalone', start_url: './', scope: './', id: './' })
    expect(m.theme_color).toBe('#3B1163')
  })
  it('names 192 and 512 icons that exist, one of them maskable', () => {
    const sizes = m.icons.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true)
    for (const i of m.icons) expect(existsSync(path.join(dir, i.src))).toBe(true)
  })
})
