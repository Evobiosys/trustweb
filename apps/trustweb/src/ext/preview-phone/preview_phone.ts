// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b phone-preview-extension: the personal preview's catalogue on a phone (TW_PREVIEW_LAN, `bin/preview <id> phone` on the Mac).
 * Dev only: main.ts imports this behind the __TW_PREVIEW__ define, which is the literal null in every build, so the module is dropped there.
 * Rows come from the registry the Mac panel uses (dev_preview_rules.ts); a verdict is the Mac panel's own POST /__tw/preview/verdict (no new server).
 */
import { applyVerdicts, ensureLoaded, pillPress, shownVerdict, visible, type PreviewFeature, type Verdict } from '../../dev_preview_rules'

/** The shell width up to which the phone sheet replaces the Mac panel (the Mac panel's own narrow breakpoint). */
export const PHONE_MAX_W = 700
export const isPhoneShell = (width: number): boolean => width <= PHONE_MAX_W

export interface PhoneRow { key: string; title: string; where: string; steps: string[]; loaded: boolean; verdict: Verdict }

export const phoneRows = (features: PreviewFeature[]): PhoneRow[] =>
  visible(features).map((f) => ({ key: f.key, title: f.title, where: f.where ?? '', steps: f.steps ?? [], loaded: f.checked, verdict: shownVerdict(f) }))

/** A press on like (merge) or needs work: the verdict to store and the rows as the registry will settle them (like loads the row, needs work unloads it). */
export function phonePress(features: PreviewFeature[], key: string, v: 'merge' | 'needs-work'): { verdict: Verdict; features: PreviewFeature[] } {
  const base = v === 'merge' ? ensureLoaded(features, key) : features
  const verdict = pillPress(base, key, v)
  return { verdict, features: applyVerdicts(base, [key], verdict) }
}

type Json = { error?: string }
type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>

/** POST /__tw/preview/verdict, the route dev_preview.ts uses; null clears the verdict (the route maps it to the CLI's `clear`). */
export async function postVerdict(fetchFn: FetchFn, feature: string, verdict: Verdict): Promise<void> {
  const r = await fetchFn('/__tw/preview/verdict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature, verdict }) })
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as Json).error ?? 'HTTP ' + String(r.status))
}

declare const __TW_PREVIEW__: { id: string; features: PreviewFeature[] } | null | undefined

/** Mounts the pill and the sheet on a phone-width shell; a wide shell keeps the Mac panel. */
export function initPreviewPhone(): void {
  if (window.top !== window || typeof __TW_PREVIEW__ === 'undefined' || !__TW_PREVIEW__) return
  const seed = __TW_PREVIEW__
  if (!isPhoneShell(innerWidth)) return
  void import('./preview_phone_view').then((m) => { m.mountPreviewPhone(seed, { fetchFn: (u, i) => fetch(u, i), copy: (t) => navigator.clipboard.writeText(t) }) })
}
