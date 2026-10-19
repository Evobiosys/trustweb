/** Wave 16 (src/apk_hint.ts): who sees the visitor's notification hint and the Settings card. */
import { apkHintKind, apkSettingsRow } from '../../src/apk_hint.ts'

const base = { android: false, ios: false, apkSession: false, standalone: false, dismissedApk: false, dismissedIos: false }

describe('apk_hint', () => {
  it('Android in a browser gets the APK notice until dismissed', () => {
    expect(apkHintKind({ ...base, android: true })).toBe('android')
    expect(apkHintKind({ ...base, android: true, dismissedApk: true })).toBeNull()
    expect(apkHintKind({ ...base, android: true, dismissedIos: true })).toBe('android')
  })
  it('iPhone gets the coming-soon notice until dismissed', () => {
    expect(apkHintKind({ ...base, ios: true })).toBe('ios')
    expect(apkHintKind({ ...base, ios: true, dismissedIos: true })).toBeNull()
    expect(apkHintKind({ ...base, ios: true, dismissedApk: true })).toBe('ios')
  })
  it('desktop, the APK and the home-screen app get none', () => {
    expect(apkHintKind(base)).toBeNull()
    expect(apkHintKind({ ...base, android: true, apkSession: true })).toBeNull()
    expect(apkHintKind({ ...base, android: true, standalone: true })).toBeNull()
    expect(apkHintKind({ ...base, ios: true, standalone: true })).toBeNull()
  })
  it('the Settings card is Android outside the app, dismissed or not', () => {
    expect(apkSettingsRow({ ...base, android: true })).toBe(true)
    expect(apkSettingsRow({ ...base, android: true, dismissedApk: true })).toBe(true)
    expect(apkSettingsRow({ ...base, android: true, apkSession: true })).toBe(false)
    expect(apkSettingsRow({ ...base, android: true, standalone: true })).toBe(false)
    expect(apkSettingsRow({ ...base, ios: true })).toBe(false)
    expect(apkSettingsRow(base)).toBe(false)
  })
})
