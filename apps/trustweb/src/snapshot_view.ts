/**
 * The "Snapshots" block under Settings > My devices and the one `take` every merge and restore goes through (wave 13, R2, R8).
 * snapshot.ts holds the crypto and the store; this is the sheets around it, plus handing the person the file (R8).
 */
import { el } from '../../demo/src/ui/dom'
import { toB64u, fromB64u } from '../../demo/src/crypto'
import { keyFromPassphrase, parseKeyText } from './backup'
import type { BackupKey } from './backup'
import { backupKeyText } from './backup_view'
import type { AppState } from './model'
import { ensureKey, openSnapshot, readSnapshots, rekey, restoreRecord, takeSnapshot } from './snapshot'
import { parseRecord, storageKey } from './store'
import { S } from './strings'

export interface SnapshotViewHooks {
  persona: string
  storeCtx?: string
  /** The record now, or null on a device that has none yet. */
  state: () => AppState | null
  /** The restored record replaces this device's (then the app reloads). */
  replaceRecord: (s: AppState) => void
  sheet: HTMLElement
  openSheet: (children: (Node | null)[]) => void
  toast: (msg: string) => void
  when: (at: number) => string
}

export interface SnapshotView {
  /** Seals the record into the kept snapshots first; never throws. `file`: also hands the person the sealed file. */
  take(reason: string, file?: boolean): Promise<void>
  /** What the last `take` wants the person to hear (first snapshot, nothing kept); said once, then empty. */
  note(): string
  /** The block for the My devices sheet; `back` draws that sheet again. */
  block(back: () => void): HTMLElement[]
}

const SHEET_KIND = 'devices-snapshots'

const stamp = (d: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

export function createSnapshotView(h: SnapshotViewHooks): SnapshotView {
  const base = storageKey(h.persona, h.storeCtx)
  const listKey = base + ':snapshots'
  const keyName = base + ':snapshot-key'
  let pending = ''
  const open = (nodes: (Node | null)[]): void => { h.openSheet(nodes); h.sheet.dataset.kind = SHEET_KIND }
  const currentKey = async (): Promise<BackupKey> => (await ensureKey(localStorage, keyName, backupKeyText(h.persona, h.storeCtx))).key

  /** The file (R8): a download; on the iPhone shell or where downloads are unsupported the share sheet, else the text to copy. */
  async function giveFile(bytes: Uint8Array): Promise<void> {
    const name = `trustweb-snapshot-${stamp(new Date())}.twb`
    const file = new File([bytes as BlobPart], name, { type: 'application/octet-stream' })
    const native = location.protocol === 'capacitor:' || !('download' in HTMLAnchorElement.prototype)
    if (!native) {
      const a = el('a', { href: URL.createObjectURL(file), download: name })
      document.body.append(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      return
    }
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return }
    } catch { /* cancelled or refused: the text below */ }
    const text = toB64u(bytes)
    open([
      el('h3', {}, [S.snFileShareTitle]),
      el('p', { class: 'meta' }, [S.snFileShareLead]),
      el('code', { class: 'recovery-key', 'data-snapshot-text': '1' }, [text]),
      el('button', { class: 'btn btn-electric btn-sm', onclick: () => { void navigator.clipboard?.writeText(text).then(() => h.toast(S.snCopied), () => { /* selectable above */ }) } }, [S.snCopy]),
    ])
  }

  async function take(reason: string, file = false): Promise<void> {
    pending = ''
    const s = h.state()
    if (!s) return
    try {
      const first = readSnapshots(localStorage, listKey).length === 0
      const r = await takeSnapshot(await currentKey(), s, reason, localStorage, listKey, Date.now())
      if (!r.kept) pending = S.snNotKept
      else if (first) pending = S.snFirst
      if (file) await giveFile(r.blob)
    } catch { pending = S.snNotKept }
  }

  /** Opens `bytes` with `key`, asks, snapshots what is here, then replaces the record. False when it did not open as a record. */
  async function restoreBytes(bytes: Uint8Array, key: BackupKey): Promise<boolean> {
    let record
    try { record = parseRecord(JSON.stringify((await openSnapshot(key, bytes)).record)) } catch { return false }
    if (!record) return false
    if (!confirm(S.snRestoreConfirm)) return true
    await take(S.snReasonRestore)
    h.replaceRecord(restoreRecord(record, h.state()))
    return true
  }

  function showKey(back: () => void, key: BackupKey): void {
    const shared = key.text === backupKeyText(h.persona, h.storeCtx)
    open([
      el('h3', {}, [S.snKeyTitle]),
      el('p', { class: 'meta' }, [S.snKeyLead]),
      el('code', { class: 'recovery-key', 'data-snapshot-key': '1' }, [key.text]),
      shared ? el('p', { class: 'meta' }, [S.snKeyShared]) : null,
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { void navigator.clipboard?.writeText(key.text).then(() => h.toast(S.snCopied), () => { /* selectable above */ }) } }, [S.snCopy]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: back }, [S.dvBack]),
    ])
  }

  function changeKeySheet(back: () => void): void {
    const input = el('input', { class: 'field', type: 'password', placeholder: S.snChangePh, 'aria-label': S.snChangePh, autocomplete: 'new-password', 'data-snapshot-newkey': '1' })
    const msg = el('p', { class: 'meta' }, [S.snChangeLead])
    const ok = async (): Promise<void> => {
      let next: BackupKey
      try { next = input.value.trim().toUpperCase().startsWith('TW1') ? parseKeyText(input.value) : await keyFromPassphrase(input.value) } catch { msg.textContent = S.snBadKey; return }
      const { skipped } = await rekey(await currentKey(), next, localStorage, listKey)
      localStorage.setItem(keyName, next.text)
      h.toast(skipped ? S.snKeySkipped(skipped) : S.snKeyChanged)
      back()
    }
    input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void ok() })
    open([
      el('h3', {}, [S.snChangeKey]), msg, input,
      el('button', { class: 'btn btn-electric', onclick: () => void ok() }, [S.snChangeOk]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: back }, [S.dvCancel]),
    ])
  }

  function fileSheet(back: () => void): void {
    const picker = el('input', { type: 'file', accept: '.twb', 'aria-label': S.snFileRestore, 'data-snapshot-file': '1' })
    const paste = el('textarea', { class: 'field', rows: '3', placeholder: S.snFilePaste, 'aria-label': S.snFilePaste })
    const keyIn = el('input', { class: 'field', type: 'password', placeholder: S.snFileKeyPh, 'aria-label': S.snFileKeyPh, autocomplete: 'off' })
    const msg = el('p', { class: 'meta' }, [S.snFileLead])
    const ok = async (): Promise<void> => {
      try {
        const f = picker.files?.[0]
        const bytes = f ? new Uint8Array(await f.arrayBuffer()) : fromB64u(paste.value.trim())
        const text = keyIn.value.trim()
        const key = !text ? await currentKey() : text.toUpperCase().startsWith('TW1') ? parseKeyText(text) : await keyFromPassphrase(text)
        if (!(await restoreBytes(bytes, key))) msg.textContent = S.snFileBad
      } catch { msg.textContent = S.snFileBad }
    }
    open([
      el('h3', {}, [S.snFileRestore]), msg, picker, paste, keyIn,
      el('button', { class: 'btn btn-electric', onclick: () => void ok() }, [S.snFileOk]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: back }, [S.dvCancel]),
    ])
  }

  function block(back: () => void): HTMLElement[] {
    const rows = readSnapshots(localStorage, listKey).reverse().map((e) => el('div', { class: 'verse', 'data-snapshot': String(e.at) }, [
      el('p', { class: 'meta' }, [S.snRow(h.when(e.at), Math.max(1, Math.round(e.bytes / 1024)), e.reason)]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-snapshot-restore': String(e.at), onclick: () => {
        void (async () => {
          if (!(await restoreBytes(fromB64u(e.blob), await currentKey()))) h.toast(S.snKeyOpenFailed)
        })()
      } }, [S.snRestore]),
    ]))
    return [
      el('h4', { class: 'eyebrow' }, [S.snTitle]),
      el('p', { class: 'meta' }, [S.snLead]),
      ...(rows.length ? rows : [el('p', { class: 'empty' }, [S.snNone])]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-snapshot-now': '1', onclick: () => { void take(S.snReasonManual).then(() => { h.toast(pending || S.snTaken); pending = ''; back() }) } }, [S.snNow]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { void currentKey().then((k) => showKey(back, k)) } }, [S.snShowKey]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => changeKeySheet(back) }, [S.snChangeKey]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => fileSheet(back) }, [S.snFileRestore]),
    ]
  }

  return { take, note: () => { const n = pending; pending = ''; return n }, block }
}
