/**
 * The "Advanced" disclosure on a person's card remembers it was open for two minutes (wave 6e, owner 2026-10-08 16:12: "that should start
 * collapsed whenever I navigate away from it, but memorize it for 2 minutes to keep it on in that manner"). ONE timestamp for the whole
 * phone, not one per person: the last moment the disclosure was opened or used. A card built within ADVANCED_MEMORY_MS of it opens expanded;
 * otherwise it starts collapsed. Closing it by hand forgets the stamp at once.
 *
 * The stamp is interface state, not data: it lives in one small storage cell (localStorage in the app), never in the record, never in a
 * backup, never sent. A storage that is missing or refuses (a private window, blocked site data) only means the disclosure starts collapsed.
 * Pure and DOM-free: the clock and the cell are injected.
 */

/** How long "was open" is remembered. */
export const ADVANCED_MEMORY_MS = 2 * 60 * 1000

/** One storage cell holding a number (a millisecond timestamp), or nothing. */
export interface StampCell {
  read(): string | null
  write(value: string): void
  clear(): void
}

export interface AdvancedMemory {
  /** The disclosure was opened or used just now. */
  markOpen(): void
  /** The person closed it: forget. */
  markClosed(): void
  /** Was it open within the last two minutes? */
  wasOpen(): boolean
}

export function createAdvancedMemory(cell: StampCell, now: () => number): AdvancedMemory {
  const safe = <T>(fn: () => T, fallback: T): T => {
    try { return fn() } catch { return fallback }
  }
  return {
    markOpen: (): void => safe(() => cell.write(String(now())), undefined),
    markClosed: (): void => safe(() => cell.clear(), undefined),
    wasOpen: (): boolean => {
      const raw = safe(() => cell.read(), null)
      const at = raw === null ? Number.NaN : Number(raw)
      // A stamp in the future (a clock set back) or not a number counts as none.
      return Number.isFinite(at) && at <= now() && now() - at < ADVANCED_MEMORY_MS
    },
  }
}

/** The cell of the app: one localStorage key, every access guarded. */
export function localStorageCell(key: string, storage: () => Storage | undefined): StampCell {
  return {
    read: () => storage()?.getItem(key) ?? null,
    write: (value) => { storage()?.setItem(key, value) },
    clear: () => { storage()?.removeItem(key) },
  }
}
