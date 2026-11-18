// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c header-cluster (ε): "Update now" on the old-QR refusal notice. */
import { updateNow } from '../../src/update_now.ts'

const deps = (o = {}) => {
  const calls = []
  return {
    calls,
    d: {
      registration: async () => ({ update: async () => { calls.push('update') }, waiting: null }),
      newerRelease: async () => false,
      reload: async () => { calls.push('reload') },
      android: false,
      openInstallPage: () => { calls.push('install') },
      ...o,
    },
  }
}

describe('updateNow', () => {
  it('asks the service worker to update, and reloads when a new version waits', async () => {
    const { d, calls } = deps({ registration: async () => ({ update: async () => { calls.push('update') }, waiting: {} }) })
    expect(await updateNow(d)).toBe('reloaded')
    expect(calls).toEqual(['update', 'reload'])
  })
  it('reloads when the published release is newer than the running one', async () => {
    const { d, calls } = deps({ newerRelease: async () => true })
    expect(await updateNow(d)).toBe('reloaded')
    expect(calls).toEqual(['update', 'reload'])
  })
  it('opens the install page on Android when nothing newer is waiting', async () => {
    const { d, calls } = deps({ android: true })
    expect(await updateNow(d)).toBe('install-page')
    expect(calls).toEqual(['update', 'install'])
  })
  it('says the phone is current elsewhere: no reload, no page', async () => {
    const { d, calls } = deps()
    expect(await updateNow(d)).toBe('latest')
    expect(calls).toEqual(['update'])
  })
  it('survives no service worker and a failing update()', async () => {
    const a = deps({ registration: async () => undefined })
    expect(await updateNow(a.d)).toBe('latest')
    const b = deps({ registration: async () => ({ update: async () => { throw new Error('offline') }, waiting: null }), android: true })
    expect(await updateNow(b.d)).toBe('install-page')
  })
})
