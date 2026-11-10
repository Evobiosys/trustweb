// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Review wave 40: the extension asks for no permission it does not use, and runs no remote code.
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'))

describe('manifest', () => {
  it('permissions: storage (settings) and scripting (Mastodon instances the user adds), nothing else', () => {
    expect([...manifest.permissions].sort()).toEqual(['scripting', 'storage'])
  })
  it('fixed hosts: the four networks only; any other host only when the user adds it', () => {
    expect(manifest.host_permissions).toEqual(['https://x.com/*', 'https://twitter.com/*', 'https://www.facebook.com/*', 'https://www.linkedin.com/*'])
    expect(manifest.optional_host_permissions).toEqual(['https://*/*'])
  })
  it('no remote code: scripts from the package only', () => {
    expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'")
    expect(manifest.background).toBeUndefined()
  })
})
