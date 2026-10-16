/**
 * Wave 11: the Android app (android/) is a thin shell around this web app, so the web app updates itself on every open,
 * as always. Only the shell needs a new download now and then. The shell opens the app at `/?apk=<its version>`
 * (android/app/build.gradle.kts launchUrl), which tells this page two things: it runs inside the APK (sessionStorage,
 * this session only, so a browser tab on the same origin is not mistaken for the app), and which shell version. Once per
 * six hours the app asks GitHub for the latest release and offers the download when the shell is older; Settings can
 * turn that check off (record field apkUpdates).
 */
const SESSION_KEY = 'tw-apk'
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/Evobiosys/trustweb/releases/latest'
export const APK_CHECK_EVERY_MS = 6 * 3600_000
const VERSION_RE = /^\d+\.\d+\.\d+$/

/** The shell version the launch URL carries; null in a browser or a malformed value. */
export function apkParam(params: URLSearchParams): string | null {
  const v = params.get('apk') ?? ''
  return VERSION_RE.test(v) ? v : null
}

export function rememberApkSession(version: string): void {
  try { sessionStorage.setItem(SESSION_KEY, version) } catch { /* storage off: this open only looks like a tab */ }
}

/** This page was opened by the APK (this session). */
export function isApkSession(): boolean {
  try { return sessionStorage.getItem(SESSION_KEY) !== null } catch { return false }
}

export function apkSessionVersion(): string | null {
  try { return sessionStorage.getItem(SESSION_KEY) } catch { return null }
}

/** `a` is a newer release than `b` (plain x.y.z). */
export function newerVersion(a: string, b: string): boolean {
  if (!VERSION_RE.test(a) || !VERSION_RE.test(b)) return false
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i]
  return false
}

export interface ApkUpdateState {
  /** Off: never check (Settings). Absent: on. */
  apkUpdates?: boolean
  apkCheckedAt?: number
}

export function updateCheckDue(s: ApkUpdateState, now: number): boolean {
  return s.apkUpdates !== false && now - (s.apkCheckedAt ?? 0) >= APK_CHECK_EVERY_MS
}

/** The newest release's version from GitHub ("v0.2.4" -> "0.2.4"); null when unreachable or oddly named. */
export async function latestApkVersion(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' })
    if (!res.ok) return null
    const tag = ((await res.json()) as { tag_name?: unknown }).tag_name
    const v = typeof tag === 'string' ? tag.replace(/^v/, '') : ''
    return VERSION_RE.test(v) ? v : null
  } catch {
    return null
  }
}
