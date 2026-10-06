/**
 * Asking the browser to keep this site's storage (wave 1733 round B, review
 * P6): once the person keeps audio or images, the origin holds far more than
 * the record, and a browser short of space may clear "best effort" storage,
 * the record with it. navigator.storage.persist() asks for durable storage
 * (no prompt in Chromium and Safari, which decide by themselves; a prompt in
 * Firefox). Settings shows honestly whether it was granted.
 */

export enum PersistState {
  Granted = 'granted',
  NotGranted = 'not-granted',
  /** This browser has no such switch. */
  Unsupported = 'unsupported',
}

let asked: Promise<PersistState> | null = null

function api(): StorageManager | null {
  return typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function' ? navigator.storage : null
}

/** Asks once per visit (after something big was kept); later calls get the same answer. */
export function askPersist(): Promise<PersistState> {
  asked ??= (async (): Promise<PersistState> => {
    const s = api()
    if (!s) return PersistState.Unsupported
    try {
      if (await s.persisted()) return PersistState.Granted
      return (await s.persist()) ? PersistState.Granted : PersistState.NotGranted
    } catch {
      return PersistState.NotGranted
    }
  })()
  return asked
}

/** What the browser says now, without asking. */
export async function persistState(): Promise<PersistState> {
  const s = api()
  if (!s || typeof s.persisted !== 'function') return PersistState.Unsupported
  try {
    return (await s.persisted()) ? PersistState.Granted : PersistState.NotGranted
  } catch {
    return PersistState.NotGranted
  }
}
