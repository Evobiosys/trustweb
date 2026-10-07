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
import { BackupNotFound, backupNow, keyFromPassphrase, newRandomKey, parseKeyText, restore } from './backup'
import type { BackupKey } from './backup'
import type { AppState } from './model'
import { parseRecord } from './store'
import { S } from './strings'

interface BackupInfo { keyText: string; fromPassphrase: boolean; lastAt: number; lastBytes: number }

export interface BackupViewHooks {
  persona: string
  storeCtx?: string
  state: () => AppState
  /** Restore: the backup's record replaces this phone's (after the person confirmed), then the app reloads. */
  replaceRecord: (s: AppState) => void
  openSheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  toast: (msg: string) => void
  /** Redraw the screen the card sits on (Inventory), if it is showing. */
  redraw: () => void
}

export interface BackupView {
  /** The card's slot in Inventory; filled once the server answered. */
  card(): HTMLElement
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
  const storeKey = `trustweb.backup.${h.persona}${h.storeCtx ? '.' + h.storeCtx : ''}`

  function loadBackupInfo(): BackupInfo | null {
    try {
      const raw = localStorage.getItem(storeKey)
      return raw ? JSON.parse(raw) as BackupInfo : null
    } catch { return null }
  }

  function saveBackupInfo(info: BackupInfo | null): void {
    try {
      if (info) localStorage.setItem(storeKey, JSON.stringify(info))
      else localStorage.removeItem(storeKey)
    } catch { /* storage blocked: the backup still works this visit */ }
  }

  async function runBackup(key: BackupKey): Promise<void> {
    try {
      const r = await backupNow(key, h.state())
      saveBackupInfo({ keyText: key.text, fromPassphrase: key.fromPassphrase, lastAt: r.at, lastBytes: r.bytes })
      h.toast(S.bkDone(Math.max(1, Math.round(r.bytes / 1024))))
    } catch {
      h.toast(S.bkFailed)
    }
    h.redraw()
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
        const record = typeof data === 'object' && data !== null ? parseRecord(JSON.stringify(data)) : null
        if (!record) { msg.textContent = S.bkBadData; return }
        if (!confirm(S.bkRestoreConfirm)) return
        saveBackupInfo({ keyText: key.text, fromPassphrase: key.fromPassphrase, lastAt: Date.now(), lastBytes: 0 })
        h.replaceRecord(record)
      } catch (e) {
        msg.textContent = e instanceof BackupNotFound ? S.bkNotFound : S.bkFailed
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
      const slot = document.getElementById('backup-slot')
      if (slot) slot.replaceChildren(...[cardInner()].filter((c): c is HTMLElement => c !== null))
    })()
    return backupProbe
  }

  function cardInner(): HTMLElement | null {
    if (!backupAvailable) return null
    const info = loadBackupInfo()
    if (!info) {
      return el('div', { class: 'verse backup' }, [
        el('h3', {}, [S.bkQuestion]),
        el('p', {}, [S.bkLead]),
        el('button', { class: 'btn btn-electric btn-sm', onclick: () => void newRandomKey().then(recoveryKeySheet) }, [S.bkStart]),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: passphraseSheet }, [S.bkOwnPass]),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: restoreSheet }, [S.bkRestore]),
      ])
    }
    const key = ((): BackupKey | null => { try { return parseKeyText(info.keyText) } catch { return null } })()
    return el('div', { class: 'verse backup' }, [
      el('h3', {}, [S.bkOn]),
      el('p', {}, [S.bkLast(new Date(info.lastAt).toLocaleString())]),
      key ? el('button', { class: 'btn btn-electric btn-sm', onclick: () => void runBackup(key) }, [S.bkBackUpNow]) : null,
      key ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => recoveryKeySheet(key) }, [S.bkShowKey]) : null,
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { if (confirm(S.bkForgetConfirm)) { saveBackupInfo(null); h.redraw() } } }, [S.bkForget]),
    ])
  }

  return {
    card: () => {
      if (backupAvailable === null) void probe()
      const inner = cardInner()
      return el('div', { id: 'backup-slot' }, inner ? [inner] : [])
    },
    probe,
    available: () => backupAvailable,
  }
}
