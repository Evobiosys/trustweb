// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Settings > Advanced > "Archived copies" (wave 40): the records that taking another device's state, or a restore, replaced. Each is kept
 * 30 days (device_adopt.ts); Restore archives what is here first, so a restore can itself be undone. `keep` is the one place a copy is made.
 */
import { el } from '../../demo/src/ui/dom'
import { alphaSub } from './alpha_heading'
import { ARCHIVE_DAYS, archiveRecord, readArchived, restoreArchived } from './device_adopt'
import type { AppState } from './model'
import { parseRecord, storageKey } from './store'
import { S } from './strings'

export interface ArchivedCopiesHooks {
  persona: string
  storeCtx?: string
  state: () => AppState | null
  /** The restored record replaces this device's (then the app reloads). */
  replaceRecord: (s: AppState) => void
  toast: (msg: string) => void
  when: (at: number) => string
  deviceName: () => string
}

export interface ArchivedCopiesView {
  /** Keeps a copy of the record now; false = nothing kept, the caller must not replace anything. A device without a record has nothing to keep (true). */
  keep(reason: string, device: string): boolean
  /** The Settings > Advanced block; `back` draws the settings again. */
  block(back: () => void): HTMLElement[]
}

const DAY = 86_400_000

export function createArchivedCopiesView(h: ArchivedCopiesHooks): ArchivedCopiesView {
  const listKey = storageKey(h.persona, h.storeCtx) + ':archived-copies'
  const keep = (reason: string, device: string): boolean => {
    const s = h.state()
    return !s || archiveRecord(localStorage, listKey, s, { reason, device }, Date.now())
  }

  function restore(id: string): void {
    const c = readArchived(localStorage, listKey, Date.now()).find((x) => x.id === id)
    const record = c && parseRecord(JSON.stringify(c.record))
    if (!c || !record) { h.toast(S.adCopyUnreadable); return }
    if (!keep(S.adRestoreReason, h.deviceName())) { h.toast(S.adNotKept); return }
    h.toast(S.adRestored)
    h.replaceRecord(restoreArchived({ ...c, record }, h.state()))
  }

  function block(back: () => void): HTMLElement[] {
    const now = Date.now()
    const rows = readArchived(localStorage, listKey, now).map((c) => el('div', { class: 'verse', 'data-archived-copy': c.id }, [
      el('p', { class: 'meta' }, [S.adRow(h.when(c.at), c.people, c.device, Math.max(1, Math.ceil((c.expiresAt - now) / DAY))), c.pictures ? '' : ` ${S.adNoPictures}`]),
      el('p', { class: 'meta' }, [c.reason]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-archived-restore': c.id, onclick: () => { restore(c.id); back() } }, [S.adRestore]),
    ]))
    return [
      el('h4', { class: 'eyebrow', 'data-archived-copies': String(ARCHIVE_DAYS) }, [S.adTitle, ' ', alphaSub()]),
      el('p', { class: 'meta' }, [S.adLead]),
      ...(rows.length ? rows : [el('p', { class: 'empty' }, [S.adNone])]),
    ]
  }

  return { keep, block }
}
