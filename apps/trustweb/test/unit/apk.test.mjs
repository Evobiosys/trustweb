/** Wave 11 (src/apk.ts): the Android shell's version hand-over and the update check. */
import { APK_CHECK_EVERY_MS, apkParam, latestApkVersion, newerVersion, updateCheckDue } from '../../src/apk.ts'

describe('apk', () => {
  it('reads only a plain x.y.z from the launch URL', () => {
    expect(apkParam(new URLSearchParams('?apk=0.2.4'))).toBe('0.2.4')
    expect(apkParam(new URLSearchParams('?apk=v0.2.4'))).toBeNull()
    expect(apkParam(new URLSearchParams('?apk=<script>'))).toBeNull()
    expect(apkParam(new URLSearchParams(''))).toBeNull()
  })
  it('compares releases numerically', () => {
    expect(newerVersion('0.2.10', '0.2.4')).toBe(true)
    expect(newerVersion('0.2.4', '0.2.4')).toBe(false)
    expect(newerVersion('1.0.0', '0.9.9')).toBe(true)
    expect(newerVersion('x', '0.1.0')).toBe(false)
  })
  it('checks at most every six hours and never when switched off', () => {
    expect(updateCheckDue({}, 1e12)).toBe(true)
    expect(updateCheckDue({ apkCheckedAt: 1e12 - APK_CHECK_EVERY_MS + 1 }, 1e12)).toBe(false)
    expect(updateCheckDue({ apkCheckedAt: 1e12 - APK_CHECK_EVERY_MS }, 1e12)).toBe(true)
    expect(updateCheckDue({ apkUpdates: false }, 1e12)).toBe(false)
  })
  it('reads the latest tag from GitHub and survives failure', async () => {
    const ok = async () => new Response(JSON.stringify({ tag_name: 'v0.2.9' }), { status: 200 })
    expect(await latestApkVersion(ok)).toBe('0.2.9')
    expect(await latestApkVersion(async () => new Response('', { status: 403 }))).toBeNull()
    expect(await latestApkVersion(async () => { throw new Error('offline') })).toBeNull()
    expect(await latestApkVersion(async () => new Response(JSON.stringify({ tag_name: 'nightly' }), { status: 200 }))).toBeNull()
  })
})
