/**
 * Wave 16: "reuse the previous setting I used in a similar occasion" (Jakob 2026-10-18). The last choices per activity (area, radius,
 * friend degree) are kept on this phone and fill what the next sentence leaves out, so "play padel again before Thursday" needs no
 * second form. Set once, forget: a request that names a field always wins and then becomes the new default.
 * Kept by the small-list rule of kept_list.ts. Pure and DOM-free.
 */
import { clipText, isRecord, keptList } from './kept_list'
import type { Kept, KeepRule } from './kept_list'
import type { Place } from './together_location'
import { HOP_CAP } from '../../demo/src/types'
import { TOGETHER_ACTIVITY_MAX, TOGETHER_AREA_MAX, TOGETHER_RADIUS_KM_DEFAULT, TOGETHER_RADIUS_KM_MAX } from './together_request'
import type { TogetherRequest } from './together_request'

export interface TogetherPref extends Kept {
  activity: string
  area?: string
  /** Of the picked place (together_location.ts geoPicker); stay on this phone, the ask carries only the label. */
  lat?: number
  lon?: number
  radiusKm?: number
  reach?: number
}

export const TOGETHER_PREFS_KEEP_MS = 365 * 86_400_000
export const TOGETHER_PREFS_MAX = 12

const RULE: KeepRule<TogetherPref> = {
  is: (v): v is TogetherPref =>
    isRecord(v) && typeof v.at === 'number' && Number.isFinite(v.at) && typeof v.activity === 'string' && v.activity !== '' &&
    (v.area === undefined || typeof v.area === 'string') &&
    (v.lat === undefined || (typeof v.lat === 'number' && Math.abs(v.lat) <= 90)) &&
    (v.lon === undefined || (typeof v.lon === 'number' && Math.abs(v.lon) <= 180)) &&
    (v.radiusKm === undefined || (typeof v.radiusKm === 'number' && v.radiusKm >= 1 && v.radiusKm <= TOGETHER_RADIUS_KM_MAX)) &&
    (v.reach === undefined || (typeof v.reach === 'number' && Number.isInteger(v.reach) && v.reach >= 1 && v.reach <= HOP_CAP)),
  keepMs: TOGETHER_PREFS_KEEP_MS,
  max: TOGETHER_PREFS_MAX,
}

/** Entries stamped in the future (a clock that jumped) never expire, so they are not kept. */
export const liveTogetherPrefs = (list: unknown, now: number): TogetherPref[] => keptList(list, RULE, now).filter((p) => p.at <= now + 60_000)

/** Remembers what this request chose (one entry per activity, the newest wins). `place` adds its coordinates when it IS the area. Returns the new list. */
export function rememberTogether(list: unknown, req: TogetherRequest, now: number, place?: Place): TogetherPref[] {
  const rest = liveTogetherPrefs(list, now).filter((p) => p.activity !== req.activity)
  const pref: TogetherPref = {
    at: now,
    activity: clipText(req.activity, TOGETHER_ACTIVITY_MAX),
    ...(req.area ? { area: clipText(req.area, TOGETHER_AREA_MAX) } : {}),
    ...(place && req.area && place.label === req.area && place.lat !== undefined && place.lon !== undefined ? { lat: place.lat, lon: place.lon } : {}),
    ...(req.radiusKm !== undefined ? { radiusKm: req.radiusKm } : {}),
    ...(req.reach !== undefined ? { reach: req.reach } : {}),
  }
  return [pref, ...rest].slice(0, TOGETHER_PREFS_MAX)
}

/**
 * Fills the fields a request left out from the entry of the SAME activity (area and radius together, never mixed from two entries;
 * nothing crosses to another activity: a place or a trust circle chosen for padel was not chosen for a language tandem). The dock
 * shows the filled sentence before it is sent. Reach falls back to the dock's at ask time (hops.ts).
 */
export function fillFromPrefs(req: TogetherRequest, list: unknown, now: number): TogetherRequest {
  const same = liveTogetherPrefs(list, now).find((p) => p.activity === req.activity)
  if (!same) return req
  const area = req.area ?? same.area
  const radiusKm = req.radiusKm ?? (req.area ? undefined : same.radiusKm) ?? (area ? TOGETHER_RADIUS_KM_DEFAULT : undefined)
  const reach = req.reach ?? same.reach
  return {
    ...req,
    ...(area ? { area } : {}),
    ...(radiusKm !== undefined ? { radiusKm } : {}),
    ...(reach !== undefined ? { reach } : {}),
  }
}
