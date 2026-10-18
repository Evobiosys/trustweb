/**
 * Wave 16: "reuse the previous setting I used in a similar occasion" (Jakob 2026-10-18). The last choices per activity (area, radius,
 * friend degree) are kept on this phone and fill what the next sentence leaves out, so "play padel again before Thursday" needs no
 * second form. Set once, forget: a request that names a field always wins and then becomes the new default.
 * Kept by the small-list rule of kept_list.ts. Pure and DOM-free.
 */
import { clipText, isRecord, keptList } from './kept_list'
import type { Kept, KeepRule } from './kept_list'
import { TOGETHER_ACTIVITY_MAX, TOGETHER_AREA_MAX, TOGETHER_RADIUS_KM_DEFAULT } from './together_request'
import type { TogetherRequest } from './together_request'

export interface TogetherPref extends Kept {
  activity: string
  area?: string
  radiusKm?: number
  reach?: number
}

export const TOGETHER_PREFS_KEEP_MS = 365 * 86_400_000
export const TOGETHER_PREFS_MAX = 12

const RULE: KeepRule<TogetherPref> = {
  is: (v): v is TogetherPref => isRecord(v) && typeof v.at === 'number' && typeof v.activity === 'string' && v.activity !== '',
  keepMs: TOGETHER_PREFS_KEEP_MS,
  max: TOGETHER_PREFS_MAX,
}

export const liveTogetherPrefs = (list: unknown, now: number): TogetherPref[] => keptList(list, RULE, now)

/** Remembers what this request chose (one entry per activity, the newest wins). Returns the new list. */
export function rememberTogether(list: unknown, req: TogetherRequest, now: number): TogetherPref[] {
  const rest = liveTogetherPrefs(list, now).filter((p) => p.activity !== req.activity)
  const pref: TogetherPref = {
    at: now,
    activity: clipText(req.activity, TOGETHER_ACTIVITY_MAX),
    ...(req.area ? { area: clipText(req.area, TOGETHER_AREA_MAX) } : {}),
    ...(req.radiusKm !== undefined ? { radiusKm: req.radiusKm } : {}),
    ...(req.reach !== undefined ? { reach: req.reach } : {}),
  }
  return [pref, ...rest].slice(0, TOGETHER_PREFS_MAX)
}

/**
 * Fills the fields a request left out: first from the same activity, then (area and radius only: where someone plays travels between
 * activities, who they trust for it does not) from the most recent entry of any activity. Reach falls back to 1 at ask time (hops.ts).
 */
export function fillFromPrefs(req: TogetherRequest, list: unknown, now: number): TogetherRequest {
  const prefs = liveTogetherPrefs(list, now)
  const same = prefs.find((p) => p.activity === req.activity)
  const area = req.area ?? same?.area ?? prefs.find((p) => p.area)?.area
  const radiusKm = req.radiusKm ?? same?.radiusKm ?? prefs.find((p) => p.radiusKm !== undefined)?.radiusKm ?? (area ? TOGETHER_RADIUS_KM_DEFAULT : undefined)
  const reach = req.reach ?? same?.reach
  return {
    ...req,
    ...(area ? { area } : {}),
    ...(radiusKm !== undefined ? { radiusKm } : {}),
    ...(reach !== undefined ? { reach } : {}),
  }
}
