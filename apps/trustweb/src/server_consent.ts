/**
 * The yes to transcription on a server, bound to its route (wave 3; D7 of
 * review-wave2; Jakob 2026-10-07: "transcription on a server should not be
 * the default but an extra button with a clear note where it is processed").
 *
 * - The yes is stored WITH the route the server reported when it was given:
 *   provider, region, data policy and the fallback that may take over. Any
 *   difference later (Berget becomes OpenRouter, a fallback appears) means
 *   the yes does not cover it: nothing is sent until the person says yes again.
 * - The older bare timestamp (serverTranscriptionConsentAt) names no route and
 *   counts as no yes; a new yes or a withdrawal removes it.
 * - "Automatic" never uses the server: only the server button's choice does.
 *
 * DOM-free: the unit tests run the exact rules.
 */
import { TranscriptionChoice } from './model'
import type { AppState, ServerConsent, ServerConsentRoute, TranscribeProviderInfo, TranscribeRoute } from './model'

const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'

function readRoute(v: unknown): ServerConsentRoute | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  return isStrOrNull(o.provider) && isStrOrNull(o.region) && isStrOrNull(o.dataPolicy)
    ? { provider: o.provider, region: o.region, dataPolicy: o.dataPolicy }
    : null
}

/** The stored yes, read defensively: any odd shape reads as no yes (never repaired, never thrown on). */
export function readConsent(s: Pick<AppState, 'serverTranscriptionConsent'>): ServerConsent | null {
  const v: unknown = s.serverTranscriptionConsent
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const route = readRoute(o)
  if (!route || typeof o.at !== 'number' || !Number.isFinite(o.at)) return null
  if (o.fallback === null) return { ...route, at: o.at, fallback: null }
  const fallback = readRoute(o.fallback)
  return fallback ? { ...route, at: o.at, fallback } : null
}

/** Is there any yes on this phone, of either generation (so it can be taken back)? */
export function hasAnyConsent(s: Pick<AppState, 'serverTranscriptionConsent' | 'serverTranscriptionConsentAt'>): boolean {
  return readConsent(s) !== null || typeof s.serverTranscriptionConsentAt === 'number'
}

const routeOf = (r: TranscribeRoute): ServerConsentRoute => ({ provider: r.provider, region: r.region, dataPolicy: r.dataPolicy })

/** The yes for the route the server reports now. */
export function consentFor(info: TranscribeProviderInfo | null, at: number): ServerConsent {
  const none: ServerConsentRoute = { provider: null, region: null, dataPolicy: null }
  return { ...(info ? routeOf(info) : none), at, fallback: info?.fallback ? routeOf(info.fallback) : null }
}

const sameRoute = (a: ServerConsentRoute | null, b: ServerConsentRoute | null): boolean =>
  a === null || b === null ? a === b : a.provider === b.provider && a.region === b.region && a.dataPolicy === b.dataPolicy

/**
 * Does the stored yes cover the route the server reports now? Provider,
 * region, data policy and fallback must all be the same; a server that does
 * not say whether it has a fallback reads as "none" (as at the yes).
 */
export function consentCovers(c: ServerConsent | null, info: TranscribeProviderInfo | null): boolean {
  if (!c) return false
  const now = consentFor(info, c.at)
  return sameRoute(c, now) && sameRoute(c.fallback, now.fallback)
}

/** Stores the yes for this route (replacing any earlier one, and the old bare timestamp). */
export function giveConsent(s: AppState, info: TranscribeProviderInfo | null, at: number): void {
  s.serverTranscriptionConsent = consentFor(info, at)
  delete s.serverTranscriptionConsentAt
}

/** Takes the yes back: both generations go; a server choice becomes "Automatic" (which never uses the server). */
export function withdrawConsent(s: AppState): void {
  delete s.serverTranscriptionConsent
  delete s.serverTranscriptionConsentAt
  if (s.transcription === TranscriptionChoice.Server) s.transcription = TranscriptionChoice.Auto
}

/**
 * Does a finished recording go to the server by itself? Only when the person
 * chose the server button, the server transcribes, and the yes covers its
 * route. "Automatic" never does (wave 3), whatever else holds.
 */
export function serverTranscribesByItself(choice: TranscriptionChoice, serverOn: boolean, covered: boolean): boolean {
  return choice === TranscriptionChoice.Server && serverOn && covered
}
