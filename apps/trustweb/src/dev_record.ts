/**
 * Dev-only seed (Jakob 2026-10-14): a local preview port is a fresh origin, so it would open on the welcome screen.
 * vite.config.mjs `define`s __TW_DEV_RECORD__ only for `vite serve` with TW_DEV_RECORD set (scripts/tw_dev.sh); in
 * every build it is null, so this code and the record never reach a bundle. File-only: the record lives outside the repo.
 *
 * Hosted (Jakob 2026-10-19, "make dev.trustweb.one also load every person's content"): a preview slot gets the same record
 * at run time. The Mac puts the file on the VM (trustweb-ops bin/tw_dev_record.sh), the release controller serves it at
 * HOSTED_RECORD_PATH to a logged-in dev-slot session only, and the app fetches it there (seedHostedDevRecord). A slot is
 * recognised by the overlay script the controller injects into slot HTML; the production build never has it, so the
 * production app never asks. The record never enters the bundle, GitHub or the CI artifact.
 */
import { mergeDevEvents, pickDevEvents } from './dev_events'
import { addNetworkDemo } from './network_seed'
import { hideDemoContent } from './demo_hide'
import type { AppState } from './model'
import { parseRecord, storageKey } from './store'

declare const __TW_DEV_RECORD__: { file: string; text: string } | null | undefined

interface DevRecord { file: string; text: string }

/** Where a preview slot's controller serves the record (trustweb-ops controller/dev_record.mjs). */
export const HOSTED_RECORD_PATH = '/__tw/dev-record'
/** The response header carrying the record's file name. */
export const HOSTED_RECORD_FILE_HEADER = 'X-TW-Record-File'
/** The script tag the controller injects into slot HTML (trustweb-ops controller/fsops.mjs injectOverlay). */
const OVERLAY_SELECTOR = 'script[src="/__tw/overlay.js"]'
/** Per origin: the hosted record's file name while one is in play (devRecordFile() on a slot). */
const HOSTED_FILE_KEY = 'trustweb.dev-record.file'

function devRecord(): DevRecord | null {
  return typeof __TW_DEV_RECORD__ === 'undefined' ? null : __TW_DEV_RECORD__
}

const stored = {
  get: (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string): void => { try { localStorage.setItem(k, v) } catch { /* storage blocked */ } },
  remove: (k: string): void => { try { localStorage.removeItem(k) } catch { /* storage blocked */ } },
}

/** The seed file's name while a dev record is in play (build-time or hosted), else null (About sheet banner). */
export function devRecordFile(): string | null {
  return devRecord()?.file ?? stored.get(HOSTED_FILE_KEY)
}

/** Cheap content stamp of the seed text (FNV-1a 32 bit), remembered per origin so a changed seed file is noticed. */
function stamp(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16) + ':' + text.length
}

/** The seed text with the events and tags of the record it replaces merged on top; the seed text itself where there is nothing to keep. */
function withKeptEvents(seed: string, replaced: string | null): string {
  const old = replaced === null ? null : parseRecord(replaced)
  const next = parseRecord(seed)
  if (!next) return seed
  const added = addNetworkDemo(next)
  const events = old !== null && mergeDevEvents(next, pickDevEvents(old))
  const placed = old !== null && keepPlacements(next, old)
  // The phone's choice to hide the demo content outlives a regenerated seed.
  const hidden = old?.demoHidden !== undefined && hideDemoContent(next)
  return added || events || placed || hidden ? JSON.stringify(next) : seed
}

/**
 * A re-applied seed never moves what the phone placed (Jakob 2026-10-16: "if there is a fight, TrustWeb stays as is"): for every
 * person in both, the stored ring, intending value and dot angle win over the seed's. Returns whether anything was kept.
 */
export function keepPlacements(next: AppState, old: AppState): boolean {
  const was = new Map(old.people.map((p) => [p.id, p]))
  let kept = false
  for (const p of next.people) {
    const o = was.get(p.id)
    if (!o) continue
    if (o.ring !== p.ring) { p.ring = o.ring; delete p.ringSuggested; kept = true }
    if (o.intending && JSON.stringify(o.intending) !== JSON.stringify(p.intending)) { p.intending = o.intending; kept = true }
    if (o.angle !== undefined && o.angle !== p.angle) { p.angle = o.angle; kept = true }
  }
  return kept
}

/**
 * Stores `rec` as this origin's record when none is there yet or when the seed changed since it was last applied (Jakob
 * 2026-10-15: the seed is regenerated from Tana, so it wins); the record it replaces is kept under <key>.before-seed, and its
 * events, per-person event tags, placements and hidden-demo choice carry over onto the new seed. True when the stored record changed.
 */
function applySeed(persona: string, rec: DevRecord): boolean {
  if (!parseRecord(rec.text)) return false
  const key = storageKey(persona)
  const had = stored.get(key)
  const now = stamp(rec.text)
  if (had !== null && stored.get(key + '.seed') === now) return false
  if (had !== null && had !== rec.text) stored.set(key + '.before-seed', had)
  stored.set(key, withKeptEvents(rec.text, had))
  stored.set(key + '.seed', now)
  return true
}

/** Build-time record (`vite serve` with TW_DEV_RECORD). Call before the first loadState. */
export function seedDevRecord(persona: string): void {
  const rec = devRecord()
  if (rec) applySeed(persona, rec)
}

/** True on a page the release controller published into a preview slot (its overlay script is in the HTML). */
export function onPreviewSlot(doc: Pick<Document, 'querySelector'>): boolean {
  return doc.querySelector(OVERLAY_SELECTOR) !== null
}

interface HostedDeps { fetch: typeof fetch; doc: Pick<Document, 'querySelector'> }

/**
 * Hosted record on a preview slot: fetches it (the login cookie goes along) and applies it like the build-time seed. Resolves true
 * when the stored record changed, so the caller reloads into it. A 404 (no record on the VM) forgets the file name; a failed
 * fetch changes nothing. Never runs where a build-time record is in play or off a slot.
 */
export async function seedHostedDevRecord(persona: string, deps: HostedDeps = { fetch: (...a) => fetch(...a), doc: document }): Promise<boolean> {
  if (devRecord() || !onPreviewSlot(deps.doc)) return false
  let r: Response
  try { r = await deps.fetch(HOSTED_RECORD_PATH, { credentials: 'same-origin', cache: 'no-store' }) } catch { return false }
  if (r.status === 404) { stored.remove(HOSTED_FILE_KEY); return false }
  if (!r.ok) return false
  const text = await r.text()
  const file = r.headers.get(HOSTED_RECORD_FILE_HEADER) ?? 'dev-record.json'
  if (!parseRecord(text)) return false
  stored.set(HOSTED_FILE_KEY, file)
  return applySeed(persona, { file, text })
}
