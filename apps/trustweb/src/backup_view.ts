/**
 * The backup card in Inventory and its sheets (moved out of main.ts in wave
 * 1733 round B, unchanged in behaviour): the whole phone record, end-to-end
 * encrypted, to our server in Switzerland (questhub). The key is made on this
 * phone (or derived from a passphrase the person chooses) and never sent; the
 * server only ever sees ciphertext. backup.ts holds the crypto; this is the UI
 * around it, plus the one probe that says whether the server answers at all
 * (the meeting packs and hand-overs use the same server).
 */
import { el } from '../../demo/src/ui/dom'
import { autoOn, createAutoBackup, loadInfo, saveInfo } from './auto_backup'
import type { AutoBackup, BackupInfo } from './auto_backup'
import { BackupNotFound, backupNow, keyFromPassphrase, newRandomKey, parseKeyText, restore } from './backup'
import type { BackupKey } from './backup'
import type { AppState } from './model'
import { SchemaNewerError, assertReadable } from './schema_version'
import { parseRecord } from './store'
import { S } from './strings'

const infoKey = (persona: string, storeCtx?: string): string => `trustweb.backup.${persona}${storeCtx ? '.' + storeCtx : ''}`

/** The recovery key text this device backs up with, or null (snapshot_view.ts uses the same key for its local snapshots). */
export function backupKeyText(persona: string, storeCtx?: string): string | null {
  try { return (JSON.parse(localStorage.getItem(infoKey(persona, storeCtx)) ?? 'null') as BackupInfo | null)?.keyText ?? null } catch { return null }
}

export interface BackupViewHooks {
  persona: string
  storeCtx?: string
  state: () => AppState
  /** Restore: the backup's record replaces this phone's (after the person confirmed), then the app reloads. */
  replaceRecord: (s: AppState) => void
  /** Runs (and is awaited) just before a restore replaces the record: the local snapshot. */
  beforeRestore: () => Promise<void>
  openSheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  toast: (msg: string) => void
  /** Redraw the screen the card sits on (Inventory), if it is showing. */
  redraw: () => void
}

export interface BackupView {
  /** The card's slot, in Inventory (the default) or in Settings (`inSettings`); filled once the server answered. Both may be on screen at once. */
  card(inSettings?: boolean): HTMLElement
  /** The record was saved: the automatic backup (if the person switched it on) schedules itself. */
  changed(): void
  /** The app went to the background: back up now if something changed. */
  hidden(): void
  backOnline(): void
  /** Backs up now with the key already kept on this device (an extension asks before it changes the record). False: no key, no server, or it failed. */
  backUpNow(): Promise<boolean>
  /** Asks the server once whether it is there (/backup/health). */
  probe(): Promise<void>
  /** null: not asked yet; true / false: the answer. */
  available(): boolean | null
}

export function createBackupView(h: BackupViewHooks): BackupView {
  // The card only shows where the backup service answers: a static deploy
  // without it must not offer a backup that can only fail.
  let backupAvailable: boolean | null = null
  let backupProbe: Promise<void> | null = null
  const storeKey = infoKey(h.persona, h.storeCtx)

  const loadBackupInfo = (): BackupInfo | null => loadInfo(localStorage, storeKey)
  const saveBackupInfo = (info: BackupInfo | null): void => saveInfo(localStorage, storeKey, info)

  /** SHA-256 of the record as it is sealed; an unchanged record is not sent again. */
  async function hashOf(s: AppState): Promise<string> {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(s))))
    return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  /** Seals and uploads the record, then remembers when, how big and which record. The switch is on for a new key, as it was for an old one. */
  async function sealAndSave(key: BackupKey, hash: string): Promise<{ at: number; bytes: number }> {
    const r = await backupNow(key, h.state())
    const prev = loadBackupInfo()
    saveBackupInfo({ keyText: key.text, fromPassphrase: key.fromPassphrase, lastAt: r.at, lastBytes: r.bytes, auto: prev ? prev.auto : true, lastHash: hash })
    return r
  }

  async function runBackup(key: BackupKey): Promise<void> {
    try {
      const r = await sealAndSave(key, await hashOf(h.state()))
      h.toast(S.bkDone(Math.max(1, Math.round(r.bytes / 1024))))
    } catch {
      h.toast(S.bkFailed)
    }
    redraw()
  }

  const auto: AutoBackup = createAutoBackup({
    now: Date.now,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    enabled: () => autoOn(loadBackupInfo()),
    online: () => navigator.onLine !== false,
    fingerprint: () => hashOf(h.state()),
    lastHash: () => loadBackupInfo()?.lastHash ?? null,
    lastAt: () => loadBackupInfo()?.lastAt ?? 0,
    backup: async (hash) => { await sealAndSave(parseKeyText(loadBackupInfo()?.keyText ?? ''), hash) },
    onStatus: () => fillSlot(),
  })

  /** Fills every card slot in place, never a full re-render: that would wipe whatever is being typed on the screen. */
  function fillSlot(): void {
    document.querySelectorAll<HTMLElement>('[data-backup-slot]').forEach((slot) => {
      slot.replaceChildren(...[cardInner(slot.id !== '')].filter((c): c is HTMLElement => c !== null))
    })
  }

  /** The Inventory screen redraws itself; a card in an open Settings sheet is refilled in place. */
  function redraw(): void {
    h.redraw()
    fillSlot()
  }

  /** Shows a fresh recovery key; the backup only runs after "I saved it". */
  function recoveryKeySheet(key: BackupKey): void {
    const saved = el('input', { type: 'checkbox', id: 'bk-saved' })
    const go2 = el('button', { class: 'btn btn-electric', disabled: true, onclick: () => { h.closeSheet(); void runBackup(key) } }, [S.bkBackUpNow])
    saved.addEventListener('change', () => { if (saved.checked) go2.removeAttribute('disabled'); else go2.setAttribute('disabled', '') })
    const download = (): void => {
      const a = el('a', { href: URL.createObjectURL(new Blob([S.bkKeyFile(key.text)], { type: 'text/plain' })), download: 'trustweb-recovery-key.txt' })
      document.body.append(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    }
    h.openSheet([
      el('h3', {}, [S.bkKeyTitle]),
      el('p', { class: 'meta' }, [key.fromPassphrase ? S.bkKeyLeadPass : S.bkKeyLead]),
      el('code', { class: 'recovery-key' }, [key.text]),
      el('div', { class: 'rec-saves' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { void navigator.clipboard?.writeText(key.text).then(() => h.toast(S.bkCopied), () => h.toast(S.meetingCopyFailed)) } }, [S.bkCopy]),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: download }, [S.bkDownload]),
      ]),
      el('label', { class: 'consent' }, [saved, el('span', {}, [S.bkSaved])]),
      go2,
    ])
  }

  function passphraseSheet(): void {
    const pass = el('input', { class: 'field', type: 'password', placeholder: S.bkPassPh, autocomplete: 'new-password', 'aria-label': S.bkPassPh })
    const msg = el('p', { class: 'meta' }, [S.bkPassLead])
    const ok = async (): Promise<void> => {
      try { recoveryKeySheet(await keyFromPassphrase(pass.value)) } catch { msg.textContent = S.bkPassShort; pass.focus() }
    }
    pass.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void ok() })
    h.openSheet([el('h3', {}, [S.bkPassTitle]), msg, pass, el('button', { class: 'btn btn-electric', onclick: () => void ok() }, [S.bkPassOk])])
    setTimeout(() => pass.focus(), 320)
  }

  function restoreSheet(): void {
    const input = el('input', { class: 'field', placeholder: S.bkRestorePh, 'aria-label': S.bkRestorePh, autocomplete: 'off' })
    const msg = el('p', { class: 'meta' }, [S.bkRestoreLead])
    const run = async (): Promise<void> => {
      const text = input.value.trim()
      if (!text) { input.focus(); return }
      let key: BackupKey
      try { key = text.startsWith('TW1') ? parseKeyText(text) : await keyFromPassphrase(text) } catch { msg.textContent = S.bkBadKey; return }
      try {
        const data = await restore(key)
        // The same rule as a record on this phone (store.ts): an object at version 1 with an owner.
        assertReadable((data as { schemaVersion?: unknown } | null)?.schemaVersion)
        const record = typeof data === 'object' && data !== null ? parseRecord(JSON.stringify(data)) : null
        if (!record) { msg.textContent = S.bkBadData; return }
        if (!confirm(S.bkRestoreConfirm)) return
        await h.beforeRestore()
        saveBackupInfo({ keyText: key.text, fromPassphrase: key.fromPassphrase, lastAt: Date.now(), lastBytes: 0, auto: true })
        h.replaceRecord(record)
      } catch (e) {
        msg.textContent = e instanceof SchemaNewerError ? (msg.dataset.schemaNewer = String(e.found), S.schemaNewer(e.found, e.reads)) : e instanceof BackupNotFound ? S.bkNotFound : S.bkFailed
      }
    }
    h.openSheet([el('h3', {}, [S.bkRestoreTitle]), msg, input, el('button', { class: 'btn btn-electric', onclick: () => void run() }, [S.bkRestoreOk])])
  }

  /**
   * Probed once. When the answer arrives it fills the card's slot in place, never
   * a full re-render: that would wipe whatever is being typed on the screen.
   */
  function probe(): Promise<void> {
    backupProbe ??= (async (): Promise<void> => {
      try {
        const r = await fetch('/backup/health', { cache: 'no-store' })
        backupAvailable = r.ok && (await r.text()).trim() === 'ok'
      } catch {
        backupAvailable = false
      }
      fillSlot()
    })()
    return backupProbe
  }

  /** `ids`: the Inventory card carries the element ids (one per page); the Settings card, which can sit over it, does not. */
  function cardInner(ids: boolean): HTMLElement | null {
    if (!backupAvailable) return null
    const info = loadBackupInfo()
    if (!info) {
      return el('div', { class: 'verse backup' }, [
        el('h3', {}, [S.bkQuestion]),
        el('p', {}, [S.bkLead]),
        el('button', { class: 'btn btn-electric btn-sm', onclick: passphraseSheet }, [S.bkOwnPass]),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => void newRandomKey().then(recoveryKeySheet) }, [S.bkStart]),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: restoreSheet }, [S.bkRestore]),
      ])
    }
    const key = ((): BackupKey | null => { try { return parseKeyText(info.keyText) } catch { return null } })()
    return el('div', { class: 'verse backup' }, [
      el('h3', {}, [S.bkOn]),
      el('p', {}, [S.bkLast(new Date(info.lastAt).toLocaleString())]),
      autoSwitch(info, ids),
      key ? el('button', { class: 'btn btn-electric btn-sm', onclick: () => void runBackup(key) }, [S.bkBackUpNow]) : null,
      key ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => recoveryKeySheet(key) }, [S.bkShowKey]) : null,
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { if (confirm(S.bkForgetConfirm)) { saveBackupInfo(null); redraw() } } }, [S.bkForget]),
    ])
  }

  /** The "Automatisch sichern" switch and, under it, when the last backup was or when the next try after a failure is due. */
  function autoSwitch(info: BackupInfo, ids: boolean): HTMLElement {
    const box = el('input', { type: 'checkbox', ...(ids ? { id: 'bk-auto' } : {}), class: 'bk-auto' })
    box.checked = autoOn(info)
    box.addEventListener('change', () => {
      saveBackupInfo({ ...info, auto: box.checked })
      if (box.checked) auto.changed()
      fillSlot()
    })
    const { retryAt } = auto.status()
    const when = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const line = !box.checked ? null
      : retryAt !== null ? S.bkAutoFailed(when(retryAt))
      : info.lastAt > 0 ? S.bkAutoLast(Math.max(0, Math.round((Date.now() - info.lastAt) / 60_000))) : null
    return el('div', { class: 'bk-auto-row' }, [
      el('label', { class: 'consent' }, [box, el('span', {}, [S.bkAuto])]),
      line ? el('p', { class: 'meta', ...(ids ? { id: 'bk-auto-status' } : {}) }, [line]) : null,
    ])
  }

  return {
    changed: () => auto.changed(),
    hidden: () => auto.hidden(),
    backOnline: () => auto.backOnline(),
    backUpNow: async () => {
      const keyText = loadBackupInfo()?.keyText
      if (!keyText || backupAvailable === false) return false
      try { await sealAndSave(parseKeyText(keyText), await hashOf(h.state())); redraw(); return true } catch { return false }
    },
    card: (inSettings = false) => {
      if (backupAvailable === null) void probe()
      const inner = cardInner(!inSettings)
      return el('div', { ...(inSettings ? {} : { id: 'backup-slot' }), 'data-backup-slot': inSettings ? 'settings' : 'inventory' }, inner ? [inner] : [])
    },
    probe,
    available: () => backupAvailable,
  }
}
