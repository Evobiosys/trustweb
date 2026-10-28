/**
 * App updates: the server publishes /release.json {"release": "<sha>", "built_at"} (vite.config.mjs releaseFile()); the running build
 * carries the same id (__TW_RELEASE__). A different published release means a newer build is deployed. Pure and injectable; main.ts
 * wires fetch, the clock, the banner and the reload.
 */

/** The automatic check runs at most this often (start and every return to the foreground). */
export const UPDATE_GAP_MS = 10 * 60_000

export interface ReleaseInfo { release: string; builtAt: string }

export enum UpdateResult { Current = 'current', Newer = 'newer', Failed = 'failed' }

export function readRelease(json: unknown): ReleaseInfo | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const { release, built_at: builtAt } = json as Record<string, unknown>
  if (typeof release !== 'string' || release === '') return null
  return { release, builtAt: typeof builtAt === 'string' ? builtAt : '' }
}

/** A build with no real id ("dev", "<sha>-dirty", empty) neither compares nor is offered. */
const real = (id: string): boolean => id !== '' && id !== 'dev' && !id.endsWith('-dirty')

export function isNewer(running: string, latest: string): boolean {
  return real(running) && real(latest) && running !== latest
}

export interface UpdateCheckDeps {
  running: string
  now: () => number
  /** The parsed body of /release.json (any shape); throws when the server cannot be reached. */
  fetchLatest: () => Promise<unknown>
  /** A newer release was found: once per release. */
  onNewer: (info: ReleaseInfo) => void
}

export interface UpdateCheck {
  /** The manual check: always asks, says what it found. */
  check(): Promise<UpdateResult>
  /** The automatic check: skipped within UPDATE_GAP_MS of the last answer; silent. */
  auto(): Promise<void>
}

export function createUpdateCheck(d: UpdateCheckDeps): UpdateCheck {
  let lastAnswerAt = Number.NEGATIVE_INFINITY
  let announced = ''
  async function check(): Promise<UpdateResult> {
    let info: ReleaseInfo | null = null
    try { info = readRelease(await d.fetchLatest()) } catch { /* offline */ }
    if (!info) return UpdateResult.Failed
    lastAnswerAt = d.now()
    if (!isNewer(d.running, info.release)) return UpdateResult.Current
    if (announced !== info.release) { announced = info.release; d.onNewer(info) }
    return UpdateResult.Newer
  }
  return {
    check,
    async auto(): Promise<void> {
      if (d.now() - lastAnswerAt < UPDATE_GAP_MS) return
      await check()
    },
  }
}

export interface ReloadDeps {
  caches?: { keys(): Promise<string[]>; delete(key: string): Promise<boolean> }
  reload: () => void
}

/** Clears the Cache Storage (the app registers no caching worker today; this keeps a future one from serving the old build), then reloads. */
export async function reloadFresh(d: ReloadDeps): Promise<void> {
  try {
    if (d.caches) await Promise.all((await d.caches.keys()).map((k) => d.caches?.delete(k)))
  } catch { /* reload anyway */ }
  d.reload()
}
