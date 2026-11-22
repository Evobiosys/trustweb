// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 google-contacts-sync, DOM + network glue for google_sync.ts: one sync run (incremental with the stored sync token, a full
 * list again when Google says it expired), the Google part of Settings > Import (Sync now, Keep in sync, last run, Review new) and the
 * automatic run behind GOOGLE_CONTACTS_SYNC_ENABLED. New contacts always go through the import preview (offerContacts) first.
 */
import { el } from '../../demo/src/ui/dom'
import { SyncTokenExpired, fetchChanges, loadToken } from './google_contacts'
import type { GContact } from './google_contacts'
import { AUTO_SYNC_MS, GOOGLE_CONTACTS_SYNC_ENABLED, autoSyncDue, reconcile, setSyncOn, waitingContacts } from './google_sync'
import type { GoogleSyncRun } from './google_sync'
import { ensureTags } from './import_curate_view'
import type { ServiceRow } from './model'
import { offerContacts } from './services_view'
import type { ServicesHooks } from './services_view'
import { S } from './strings'

const fetchFn = (url: string, init?: RequestInit) => fetch(url, init)
const token = (): string | null => { try { return loadToken(sessionStorage) } catch { return null } }
const plain = (cs: readonly GContact[]) => cs.map(({ photo: _p, deleted: _d, ...c }) => c)

/** `open`: hand contacts new to TrustWeb to the import preview right away (the owner's own tap); the automatic run only counts them. */
export async function runGoogleSync(h: ServicesHooks, tok: string, open: boolean): Promise<GoogleSyncRun> {
  const s = h.state()
  let full = !s.googleSync?.syncToken
  let r
  try { r = await fetchChanges(fetchFn, tok, s.googleSync?.syncToken) } catch (e) {
    if (!(e instanceof SyncTokenExpired)) throw e
    full = true
    r = await fetchChanges(fetchFn, tok)
  }
  const tagOf = ensureTags(h, [{ batchId: '', row: { labels: [...new Set(r.changes.flatMap((c) => c.labels))] } as ServiceRow }])
  const out = reconcile(s, r.changes, { now: Date.now(), tagOf, full, ...(r.nextSyncToken ? { syncToken: r.nextSyncToken } : {}) })
  h.save()
  if (out.changed.length) h.changed()
  const waiting = waitingContacts(s)
  if (open && waiting.length) offerContacts(h, plain(waiting))
  return out.run
}

/** The Google part of Settings > Import once connected (a token in this tab). `redraw` draws the Google box again. */
export function googleSyncPart(h: ServicesHooks, tok: string, redraw: () => void): HTMLElement {
  const gs = h.state().googleSync
  const on = !!gs?.on && GOOGLE_CONTACTS_SYNC_ENABLED
  const waiting = waitingContacts(h.state()).length
  const last = gs?.last
  const sync = (): void => {
    void runGoogleSync(h, tok, true).then((run) => { if (!run.fresh && !run.updated) h.toast(S.gsync.upToDate); redraw() }).catch(() => h.toast(S.googleFailed))
  }
  return el('div', { class: 'gsync-part', 'data-gsync': '1' }, [
    el('p', { class: 'meta', 'data-gsync-last': last ? String(last.at) : '' }, [last ? S.gsync.last(new Date(last.at).toLocaleString(), last.updated, last.kept, last.fresh, last.gone) : S.gsync.never]),
    el('div', { class: 'gsync-row' }, [
      el('button', { class: 'btn btn-ghost', type: 'button', 'data-gsync-now': '1', onclick: sync }, [S.gsync.syncNow]),
      el('button', {
        class: 'chip' + (on ? ' on' : ' tw-off'), type: 'button', 'aria-pressed': String(on), 'data-gsync-keep': '1',
        ...(GOOGLE_CONTACTS_SYNC_ENABLED ? {} : { disabled: '' }),
        onclick: () => { setSyncOn(h.state(), !on); h.save(); redraw() },
      }, [S.gsync.keep]),
      waiting ? el('button', { class: 'btn btn-ghost', type: 'button', 'data-gsync-review': String(waiting), onclick: () => offerContacts(h, plain(waitingContacts(h.state()))) }, [S.gsync.reviewNew(waiting)]) : null,
    ].filter((x): x is HTMLButtonElement => x !== null)),
    el('p', { class: 'meta' }, [GOOGLE_CONTACTS_SYNC_ENABLED ? S.gsync.keepHint : S.gsync.keepWaits]),
  ])
}

let timer: ReturnType<typeof setInterval> | undefined
/** Once at start: checks every minute whether an automatic run is due (switch, token, Keep in sync, 15 minutes since the last run). */
export function startGoogleAutoSync(h: ServicesHooks): void {
  if (timer || !GOOGLE_CONTACTS_SYNC_ENABLED) return
  let busy = false
  let failedAt = 0
  timer = setInterval(() => {
    const tok = token()
    const now = Date.now()
    // A failed run (token expired with the tab, Google down) waits one interval before the next try instead of asking every minute.
    if (busy || !tok || now - failedAt < AUTO_SYNC_MS || !autoSyncDue(GOOGLE_CONTACTS_SYNC_ENABLED, h.state().googleSync, tok, now)) return
    busy = true
    void runGoogleSync(h, tok, false).catch(() => { failedAt = Date.now() }).finally(() => { busy = false })
  }, Math.min(60_000, AUTO_SYNC_MS))
}
