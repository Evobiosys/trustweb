/**
 * Wave 6f: ONE relay drain per identity per browser profile.
 *
 * Reproduced (test/e2e/offline_connect_flow.mjs part B): the installed app and a browser tab, or two tabs, of the same origin share one
 * record and therefore one identity (one DID). The relay keeps one drain per DID and closes the older socket when a newer one
 * authenticates (relay_server.ts handleAuth); relay.ts reconnects a closed socket within about a second; so two tabs took the drain
 * from each other forever, and every wire went to whichever tab held it at that moment. A connect-ack that landed in the tab the
 * person was not looking at made the new person appear THERE, never in the tab in front of them (and an answer to an ask went to
 * the tab that did not ask).
 *
 * Here the Web Locks API (navigator.locks, every current browser; secure pages only) decides: one tab holds the lock named after the
 * DID and drains; the others wait for it. The tab in front of the person TAKES it (steal: visible, focused or acting), so the tab the
 * person looks at is always the one that receives. Where the API is missing (tests in Node, an old browser) the drain runs as before.
 *
 * DOM-free except for the injected LockManager.
 */

/** The parts of the Web Locks API this module uses (navigator.locks). */
export interface LockManagerLike {
  request(name: string, options: { steal?: boolean }, callback: () => Promise<void>): Promise<unknown>
}

export interface DrainLockHooks {
  /** This tab holds the drain now: open it. */
  onGranted(): void
  /** Another tab took the drain: close it here (this tab queues for it again by itself). */
  onLost(): void
}

export interface DrainLock {
  /** Asks for the drain. `take` = take it from another tab now (the person is in front of this one); else wait for it. */
  request(take: boolean): void
  /** Does this tab hold the drain? */
  held(): boolean
  /** Gives the drain up for good (a hand-over to another phone). */
  release(): void
}

export function drainLockName(did: string): string {
  return 'trustweb-drain:' + did
}

/** A lock that is always granted at once: no Web Locks API, the drain runs in every tab as before this module. */
function alwaysGranted(hooks: DrainLockHooks): DrainLock {
  let isHeld = false
  let stopped = false
  return {
    request: () => { if (stopped || isHeld) return; isHeld = true; hooks.onGranted() },
    held: () => isHeld,
    release: () => { stopped = true; isHeld = false },
  }
}

export function createDrainLock(name: string, locks: LockManagerLike | undefined, hooks: DrainLockHooks): DrainLock {
  if (!locks || typeof locks.request !== 'function') return alwaysGranted(hooks)
  let isHeld = false
  let stopped = false
  let queued = false
  let giveBack: (() => void) | null = null

  const lost = (): void => {
    if (!isHeld) return
    isHeld = false
    giveBack = null
    hooks.onLost()
    if (!stopped) ask(false)
  }

  function ask(take: boolean): void {
    if (stopped || isHeld) return
    if (!take) {
      if (queued) return
      queued = true
    }
    let mine = false
    const granted = (): Promise<void> => new Promise<void>((done) => {
      if (!take) queued = false
      // A second grant (an older queued request, after a take) is handed straight back.
      if (stopped || isHeld) { done(); return }
      mine = true
      isHeld = true
      giveBack = done
      hooks.onGranted()
    })
    const failed = (): void => {
      if (!take) queued = false
      // Taken by another tab while this one held it (AbortError): close here, queue again.
      if (mine) { lost(); return }
      // The request itself failed (no lock service on this page): drain without one, as before this module.
      if (!stopped && !isHeld) { isHeld = true; hooks.onGranted() }
    }
    try {
      locks!.request(name, take ? { steal: true } : {}, granted).catch(failed)
    } catch {
      failed()
    }
  }

  return {
    request: ask,
    held: () => isHeld,
    release: () => {
      stopped = true
      isHeld = false
      const done = giveBack
      giveBack = null
      done?.()
    },
  }
}
