// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c feed-ext (θ): Phanpy as an optional /extension. Off by default; while off its view code is not in the main bundle (the stub has no
 * static import of the body, and nothing the stub imports builds a frame); on, it registers its view; the address is the user's own Phanpy
 * (default the self-hosted phanpy.trustweb.one since answers-44c), https, never this app's own origin.
 */
import { readFileSync } from 'node:fs'
import { createBus, createRegistry } from '../../src/ext/tw_registry.ts'
import { module as phanpy } from '../../src/ext/phanpy/index.ts'
import { MODULE_ID, PHANPY_DEFAULT_URL, PHANPY_DIST_GZ_BYTES, PHANPY_SANDBOX, PHANPY_VENDORED, PHANPY_VENDOR_MAX_GZ, parsePhanpyUrl, phanpyUrl, setPhanpyUrl } from '../../src/ext/phanpy/phanpy_model.ts'

const src = (p) => readFileSync(new URL(`../../src/ext/phanpy/${p}`, import.meta.url), 'utf8')

describe('switch and bundle', () => {
  it('registered off by default and heavy (loaded only when switched on)', () => {
    expect(phanpy).toMatchObject({ id: 'phanpy', enabledByDefault: false, heavy: true, kind: 'view' })
    expect(MODULE_ID).toBe('phanpy')
  })
  it('bundle scan: the stub and the model import no view code and build no frame', () => {
    const stub = src('index.ts')
    const model = src('phanpy_model.ts')
    expect(stub).not.toMatch(/^import .*phanpy_body/m)
    expect(stub).toMatch(/import\('\.\/phanpy_body'\)/)
    for (const s of [stub, model]) { expect(s).not.toMatch(/createElement|el\('iframe'|<iframe/); expect(s).not.toMatch(/\bfetch\(/) }
    expect(src('phanpy_body.ts')).toMatch(/'iframe'/)
  })
  it('off: no view; on: the Phanpy view mounts in the registry', async () => {
    let tw
    const reg = createRegistry({ settings: () => tw, save: (t) => { tw = t }, ctx: () => ({ store: () => ({}), strings: {}, bus: createBus(), navigate: () => {}, profile: () => 'full' }) })
    reg.registerModule(phanpy)
    await reg.start()
    expect(reg.views().map((v) => v.id)).toEqual([])
    await reg.setEnabled('phanpy', true)
    expect(reg.views().map((v) => v.id)).toEqual(['phanpy'])
    expect(typeof reg.views()[0].mount).toBe('function')
    await reg.setEnabled('phanpy', false)
    expect(reg.views()).toEqual([])
  })
})

describe('vendoring decision', () => {
  it('the pinned dist is above the 3 MB gz limit, so it is not vendored: the user\'s own Phanpy address is framed instead', () => {
    expect(PHANPY_VENDOR_MAX_GZ).toBe(3_000_000)
    expect(PHANPY_DIST_GZ_BYTES).toBeGreaterThan(PHANPY_VENDOR_MAX_GZ)
    expect(PHANPY_VENDORED).toBe(false)
  })
  it('the frame is sandboxed: scripts, its own storage and login popups, nothing else (no top navigation)', () => {
    expect(PHANPY_SANDBOX.split(' ').sort()).toEqual(['allow-forms', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-same-origin', 'allow-scripts'])
    expect(PHANPY_SANDBOX).not.toMatch(/top-navigation/)
  })
})

describe('address', () => {
  const APP = 'https://app.trustweb.one'
  it.each([
    ['phanpy.social', 'https://phanpy.social/'],
    ['https://phanpy.social', 'https://phanpy.social/'],
    [' https://my.phanpy.example.org/client/ ', 'https://my.phanpy.example.org/client/'],
  ])('%j -> %j', (input, want) => { expect(parsePhanpyUrl(input, APP)).toBe(want) })
  it.each(['http://phanpy.social', 'https://localhost', 'https://user:pw@phanpy.social', 'javascript:alert(1)', 'https://app.trustweb.one/phanpy/', 'https://phanpy.social:8443/', ''])('refuses %j', (s) => { expect(parsePhanpyUrl(s, APP)).toBeNull() })
  it('default = the self-hosted copy (answers-44c); a stored address wins; empty clears; nothing stored at the default', () => {
    const s = {}
    expect(phanpyUrl(s)).toBe(PHANPY_DEFAULT_URL)
    expect(PHANPY_DEFAULT_URL).toBe('https://phanpy.trustweb.one/')
    expect(setPhanpyUrl(s, 'my.phanpy.example.org', APP)).toBe('https://my.phanpy.example.org/')
    expect(phanpyUrl(s)).toBe('https://my.phanpy.example.org/')
    expect(s.extData.phanpy).toEqual({ url: 'https://my.phanpy.example.org/' })
    expect(setPhanpyUrl(s, '', APP)).toBe(PHANPY_DEFAULT_URL)
    expect(s.extData.phanpy).toEqual({})
    expect(() => setPhanpyUrl(s, 'http://x.example.org', APP)).toThrow(/https/)
  })
})
