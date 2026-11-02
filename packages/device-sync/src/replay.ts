// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * replay.ts -- the anti-replay window for one (peer, direction).
 *
 * WHY: the relay delivers at least once and keeps un-acked wires, and anyone who captured a wire can submit it again. v1 sync
 * relied on a 10-minute `exp` alone, so a captured wire replayed inside those 10 minutes was accepted. Here every sealed message
 * carries a strictly increasing counter `ctr` (sender side: `sendCtr`, one per direction, so counters of the two directions never
 * collide -- keys.ts gives each direction its own key). The receiver keeps an RFC 4303-style sliding window of REPLAY_WINDOW = 64:
 * the highest accepted counter `high` and the set of accepted counters in (high - 64, high]. A counter is accepted once if it is
 * a positive safe integer, not already seen, and newer than high - 64; everything else is dropped. Out-of-order delivery inside
 * the window is fine (the relay does not promise order).
 *
 * The state is plain JSON so the caller can persist it BEFORE acknowledging the wire: if the device crashes after accepting but
 * before persisting, the wire is redelivered and accepted again, which the log merge (idempotent by entry id + hash) absorbs.
 *
 * WHAT IS NOT CLAIMED (I7):
 *  - A malformed persisted state is treated as EMPTY (by contract, so a corrupted store cannot brick sync). That re-opens the
 *    window: wires still held by the relay could then be accepted once more. The merge is the second line of defence there.
 *  - A message older than the window (more than 64 behind) is dropped even if it was never seen. With one `have`/`entries`
 *    round per sync this is not expected to bite; if it does, the next sync round resends what is missing.
 *  - This prevents replay of a message to the SAME receiver state. It does not stop a relay from withholding or delaying
 *    wires (no availability or timeliness claim), and it hides nothing (no metadata protection).
 */

export const REPLAY_WINDOW = 64

export interface ReplayState {
  high: number
  seen: number[]
}

export interface ReplayGuard {
  accept(ctr: number): boolean
  state(): ReplayState
}

function isCtr(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0
}

/** The initial state if it is exactly a state this module could have produced; otherwise null. */
function validState(v: unknown): ReplayState | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const { high, seen } = v as Record<string, unknown>
  if (!Array.isArray(seen)) return null
  if (high === 0) return seen.length === 0 ? { high: 0, seen: [] } : null
  if (!isCtr(high) || seen.length === 0 || seen[seen.length - 1] !== high) return null
  let prev = high - REPLAY_WINDOW
  for (const c of seen) {
    if (!isCtr(c) || c <= prev) return null // also enforces strictly ascending and inside the window
    prev = c
  }
  return { high, seen: [...(seen as number[])] }
}

export function createReplayGuard(initial?: ReplayState): ReplayGuard {
  const s = validState(initial) ?? { high: 0, seen: [] }
  let high = s.high
  const seen = new Set<number>(s.seen)

  return {
    accept(ctr: number): boolean {
      if (!isCtr(ctr)) return false
      if (ctr <= high - REPLAY_WINDOW || seen.has(ctr)) return false
      seen.add(ctr)
      if (ctr > high) {
        high = ctr
        for (const c of seen) if (c <= high - REPLAY_WINDOW) seen.delete(c)
      }
      return true
    },
    state(): ReplayState {
      return { high, seen: [...seen].sort((a, b) => a - b) }
    },
  }
}
