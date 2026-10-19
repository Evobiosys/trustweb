/**
 * Wave 16: the visitor's hint about notifications. Android outside the app is offered the APK; iPhone is told it is coming.
 * Pure: main.ts reads the browser and the dismissed list, this decides.
 */
export interface ApkHintEnv {
  android: boolean
  ios: boolean
  /** Opened by the Android shell (apk.ts isApkSession). */
  apkSession: boolean
  /** Running from the home screen. */
  standalone: boolean
  dismissedApk: boolean
  dismissedIos: boolean
}

/** Which top notice to raise, if any. Dismissed hints stay away. */
export function apkHintKind(env: ApkHintEnv): 'android' | 'ios' | null {
  if (env.apkSession || env.standalone) return null
  if (env.android) return env.dismissedApk ? null : 'android'
  if (env.ios) return env.dismissedIos ? null : 'ios'
  return null
}

/** The Settings card: Android outside the app, whether or not the notice was dismissed. */
export function apkSettingsRow(env: ApkHintEnv): boolean {
  return env.android && !env.apkSession && !env.standalone
}
