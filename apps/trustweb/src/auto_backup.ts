/**
 * Automatic encrypted backup. Pure scheduling, no I/O of its own: the clock, the timers, the key/switch check, the online flag and the
 * backup itself are injected (backup_view.ts wires the real ones), so every rule here runs in a unit test.
 *
 * It runs only while the person has a key (BackupInfo) AND the switch "Automatisch sichern" is on (`auto`; set on right when they
 * choose their key, never on for an older BackupInfo that has no flag). The backup is the same end-to-end encrypted one as "Back up
 * now" (backup.ts): nothing leaves the phone unsealed.
 *
 * Rules: a change waits 2 min (debounce); at least 5 min between two backups; the app going to the background backs up at once if
 * something changed (a phone may kill it right after); back online retries; a failure retries after 5, 10, 20 ... max 60 min; one
 * backup at a time; nothing is sent when the record is the same as at the last backup (hash of the sealed input).
 */

export interface BackupInfo {
  keyText: string
  fromPassphrase: boolean
  lastAt: number
  lastBytes: number
  /** The "Automatisch sichern" switch. Missing (a BackupInfo from before this switch existed) counts as off. */
  auto?: boolean
  /** Hash of the record the last backup sealed; an unchanged record is not sent again. */
  lastHash?: string
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function loadInfo(store: Store, key: string): BackupInfo | null {
  try {
    const raw = store.getItem(key)
    return raw ? JSON.parse(raw) as BackupInfo : null
  } catch { return null }
}

export function saveInfo(store: Store, key: string, info: BackupInfo | null): void {
  try {
    if (info) store.setItem(key, JSON.stringify(info))
    else store.removeItem(key)
  } catch { /* storage blocked: the backup still works this visit */ }
}

/** Key present and switch on. */
export const autoOn = (info: BackupInfo | null): boolean => !!info?.keyText && info.auto === true

export const AUTO_DEBOUNCE_MS = 2 * 60_000
export const AUTO_MIN_GAP_MS = 5 * 60_000
export const AUTO_BASE_BACKOFF_MS = 5 * 60_000
export const AUTO_MAX_BACKOFF_MS = 60 * 60_000

export interface AutoBackupDeps {
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  enabled: () => boolean
  online: () => boolean
  /** Hash of what a backup would seal now. */
  fingerprint: () => Promise<string>
  lastHash: () => string | null
  lastAt: () => number
  /** Seals and uploads, then stores lastAt/lastBytes/lastHash. Throws on failure. */
  backup: (hash: string) => Promise<void>
  /** After every attempt, so the status line can redraw. */
  onStatus: () => void
}

export interface AutoBackup {
  /** The record changed. */
  changed(): void
  /** The app went to the background (visibilitychange hidden / pagehide). */
  hidden(): void
  backOnline(): void
  /** retryAt: when the next try after a failure is due, else null. */
  status(): { lastAt: number; retryAt: number | null }
}

export function createAutoBackup(d: AutoBackupDeps): AutoBackup {
  let dirty = false
  let running = false
  let failures = 0
  let retryAt: number | null = null
  let timer: unknown = null

  const gapLeft = (): number => Math.max(0, d.lastAt() + AUTO_MIN_GAP_MS - d.now())
  const schedule = (ms: number): void => {
    if (timer !== null) d.clearTimer(timer)
    timer = d.setTimer(() => { timer = null; void attempt(false) }, ms)
  }
  const afterGap = (floor: number): number => Math.max(floor, gapLeft(), retryAt === null ? 0 : retryAt - d.now())

  async function attempt(force: boolean): Promise<void> {
    if (timer !== null) { d.clearTimer(timer); timer = null }
    if (running || !d.enabled() || !dirty || !d.online()) return
    const gap = gapLeft()
    if (!force && gap > 0) { schedule(gap); return }
    running = true
    dirty = false
    try {
      const hash = await d.fingerprint()
      if (hash !== d.lastHash()) await d.backup(hash)
      failures = 0
      retryAt = null
    } catch {
      dirty = true
      failures++
      const wait = Math.min(AUTO_MAX_BACKOFF_MS, AUTO_BASE_BACKOFF_MS * 2 ** (failures - 1))
      retryAt = d.now() + wait
      schedule(wait)
    } finally {
      running = false
      d.onStatus()
    }
    if (dirty && timer === null) schedule(afterGap(AUTO_DEBOUNCE_MS)) // changed while the backup ran
  }

  return {
    changed() {
      if (!d.enabled()) return
      dirty = true
      schedule(afterGap(AUTO_DEBOUNCE_MS))
    },
    hidden() {
      if (!d.enabled() || !dirty) return
      if (retryAt !== null && retryAt > d.now()) return // the backoff holds, even in the background
      void attempt(true)
    },
    backOnline() {
      if (!d.enabled()) return
      if (failures > 0) { void attempt(true); return }
      void attempt(false)
    },
    status: () => ({ lastAt: d.lastAt(), retryAt }),
  }
}
