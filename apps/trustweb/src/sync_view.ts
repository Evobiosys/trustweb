/**
 * Settings > "My devices" and its sheets (wave 7): link another of the owner's devices (a code, shown as a QR and as text, or typed or
 * scanned on the other side), check the same 4 characters on both, then "Sync now": the other device is asked first, receives the
 * record sealed, asks its person before it merges, and sends its own back. The logic is sync_core.ts (merge) and sync_link.ts (relay).
 */
import { el } from '../../demo/src/ui/dom'
import { renderQr } from '../../demo/src/ui/qr'
import { scanQr } from '../../demo/src/ui/scanner'
import type { AppState } from './model'
import { createSyncLink } from './sync_link'
import type { Incoming, PairRequest, Pairing } from './sync_link'
import type { Conflict } from './sync_core'
import { S } from './strings'

export interface SyncViewHooks {
  persona: string
  storeCtx?: string
  state: () => AppState
  save: () => void
  sheet: HTMLElement
  openSheet: (children: (Node | null)[]) => void
  toast: (msg: string) => void
  when: (at: number) => string
  /** Redraw the app behind the sheet after a merge changed the record. */
  changed: () => void
  /** Settings redraws (the "My devices" row lives there). */
  openSettings: () => void
}

export interface SyncView {
  /** The row in Settings. */
  settingsGroup(): HTMLElement[]
  /** Opens the relay connection; call once at boot of a personal phone. */
  start(): void
}

const SHEET_KIND = 'devices'
const LOG_MAX = 30

/** "Phone", "Mac" or "Device", or what ?device_name= says (the two-profile test uses it). */
function deviceName(): string {
  const given = new URLSearchParams(location.search).get('device_name')
  if (given) return given.slice(0, 40)
  return /iPhone|iPad|Android/.test(navigator.userAgent) ? 'Phone' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Device'
}

function summary(c: Conflict, side: unknown): string {
  const x = side as { name?: string; text?: string; about?: string; lines?: unknown[] }
  if (c.kind === 'person') return `${x.name ?? ''} · ${x.lines?.length ?? 0}`
  return x.text ?? x.about ?? ''
}

export function createSyncView(h: SyncViewHooks): SyncView {
  const log: string[] = []
  const showing = (): boolean => h.sheet.dataset.kind === SHEET_KIND && h.sheet.classList.contains('on')

  const link = createSyncLink({
    persona: h.persona, storeCtx: h.storeCtx, state: h.state, save: h.save, deviceName: deviceName(),
    onLog: (line) => {
      log.unshift(`${new Date().toLocaleTimeString()}  ${line}`)
      log.length = Math.min(log.length, LOG_MAX)
      if (showing()) logBox()?.replaceWith(logList())
    },
    onChange: () => { if (showing()) devicesSheet() },
    onPairRequest: (r) => confirmSheet(r),
    onIncoming: (i) => incomingSheet(i),
  })

  const logList = (): HTMLElement => el('div', { class: 'dv-log', id: 'dv-log', role: 'log' }, log.map((l) => el('div', { class: 'meta' }, [l])))
  const logBox = (): HTMLElement | null => document.getElementById('dv-log')
  const open = (kind: string, nodes: (Node | null)[]): void => { h.openSheet(nodes); h.sheet.dataset.kind = kind }

  function devicesSheet(): void {
    const rows = link.pairings().map((p: Pairing) => el('div', { class: 'verse', 'data-device': p.name }, [
      el('h3', {}, [p.name]),
      el('p', { class: 'meta' }, [`${p.fp} · ${p.lastSyncAt ? S.dvLast(h.when(p.lastSyncAt)) : S.dvNever}`]),
      el('button', { class: 'btn btn-electric btn-sm', 'data-sync-now': p.did, onclick: () => void syncNow(p) }, [S.dvSyncNow]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { if (confirm(S.dvUnlinkConfirm)) { link.unlink(p.did); devicesSheet() } } }, [S.dvUnlink]),
    ]))
    open(SHEET_KIND, [
      el('h3', {}, [S.dvTitle]),
      el('p', { class: 'meta' }, [S.dvLead]),
      ...(rows.length ? rows : [el('p', { class: 'empty' }, [S.dvNone])]),
      el('button', { class: 'btn btn-electric', 'data-link-device': '1', onclick: () => void linkSheet() }, [S.dvLink]),
      el('button', { class: 'btn btn-ghost', 'data-enter-code': '1', onclick: enterSheet }, [S.dvEnter]),
      el('h4', { class: 'eyebrow' }, [S.dvLogTitle]),
      logList(),
    ])
  }

  async function syncNow(p: Pairing): Promise<void> {
    try { await link.syncNow(p.did); h.toast(S.dvSent) } catch { h.toast(S.dvOffline) }
  }

  async function linkSheet(): Promise<void> {
    const code = await link.offerCode()
    const qr = el('div', { class: 'qr-box' })
    open('devices-link', [
      el('h3', {}, [S.dvLinkTitle]),
      el('p', { class: 'meta' }, [S.dvLinkLead]),
      qr,
      el('code', { class: 'recovery-key', 'data-device-code': '1' }, [code]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { void navigator.clipboard?.writeText(code).then(() => h.toast(S.dvCodeCopied), () => { /* selectable text above */ }) } }, [S.dvCodeCopy]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: devicesSheet }, [S.dvCancel]),
    ])
    void renderQr(qr, code).catch(() => { /* the text code still works */ })
  }

  function enterSheet(): void {
    const input = el('input', { class: 'field', placeholder: S.dvEnterPh, 'aria-label': S.dvEnterPh, autocomplete: 'off', 'data-code-input': '1' })
    const msg = el('p', { class: 'meta' }, [])
    const video = el('video', { class: 'scan-video', hidden: true })
    let stop: (() => void) | null = null
    const join = async (text: string): Promise<void> => {
      stop?.()
      const r = await link.join(text).catch(() => null)
      if (!r) { msg.textContent = S.dvBadCode; return }
      confirmSheet(r)
    }
    input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void join(input.value) })
    open('devices-enter', [
      el('h3', {}, [S.dvEnter]),
      input, msg, video,
      el('button', { class: 'btn btn-electric', 'data-code-ok': '1', onclick: () => void join(input.value) }, [S.dvEnterOk]),
      el('button', { class: 'btn btn-ghost', onclick: () => {
        video.hidden = false
        const handle = scanQr(video as HTMLVideoElement, (text) => void join(text))
        stop = handle.stop
        handle.ready.catch(() => { video.hidden = true })
      } }, [S.dvScan]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { stop?.(); devicesSheet() } }, [S.dvCancel]),
    ])
  }

  function confirmSheet(r: PairRequest): void {
    open('devices-confirm', [
      el('h3', {}, [S.dvConfirmTitle]),
      el('p', { class: 'meta' }, [S.dvConfirmLead(r.name)]),
      el('code', { class: 'recovery-key', 'data-fingerprint': r.fp }, [r.fp]),
      el('button', { class: 'btn btn-electric', 'data-pair-confirm': '1', onclick: () => { r.confirm(); h.toast(S.dvLinked(r.name)); devicesSheet() } }, [S.dvConfirm]),
      el('button', { class: 'btn btn-ghost', onclick: () => { r.cancel(); devicesSheet() } }, [S.dvCancel]),
    ])
  }

  function incomingSheet(i: Incoming): void {
    open('devices-incoming', [
      el('h3', {}, [S.dvReceiveTitle(i.from.name)]),
      el('p', {}, [S.dvReceiveBody(i.counts.people, i.counts.lines, i.counts.resources)]),
      el('p', { class: 'meta' }, [S.dvReceiveFp(i.from.fp)]),
      el('button', { class: 'btn btn-electric', 'data-receive': '1', onclick: () => void receive(i) }, [S.dvReceive]),
      el('button', { class: 'btn btn-ghost', onclick: () => { i.decline(); devicesSheet() } }, [S.dvNotNow]),
    ])
  }

  async function receive(i: Incoming): Promise<void> {
    const res = await i.accept()
    h.changed()
    h.toast(S.dvMerged(res.added, res.updated))
    if (res.conflicts.length) reviewSheet(res.conflicts)
    else devicesSheet()
  }

  function reviewSheet(conflicts: Conflict[]): void {
    open('devices-review', [
      el('h3', {}, [S.dvReviewTitle]),
      el('p', { class: 'meta' }, [S.dvReviewLead]),
      ...conflicts.map((c) => el('div', { class: 'verse', 'data-conflict': c.id }, [
        el('h3', {}, [c.label]),
        el('p', { class: 'meta' }, [c.kept === 'theirs' ? S.dvKeptTheirs : S.dvKeptMine]),
        el('p', {}, [`${c.kept === 'theirs' ? '✓ ' : ''}${summary(c, c.theirs)}`]),
        el('p', {}, [`${c.kept === 'mine' ? '✓ ' : ''}${summary(c, c.mine)}`]),
      ])),
      el('button', { class: 'btn btn-electric', onclick: devicesSheet }, [S.dvTitle]),
    ])
  }

  return {
    settingsGroup: () => [
      el('button', { class: 'radio', 'data-open-devices': '1', onclick: devicesSheet }, [el('b', {}, [S.dvOpen]), el('small', {}, [S.dvOpenHint])]),
    ],
    start: () => { void link.start() },
  }
}
