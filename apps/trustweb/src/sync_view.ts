/**
 * Settings > "My devices" and its sheets (wave 7, wave 13): link another of the owner's devices (a code, shown as a QR and as text, or typed or
 * scanned on the other side), check the same 4 characters on both, then "Sync now": the other device is asked first, saves a snapshot of
 * itself, receives the record sealed, asks its person before it merges, and sends its own back. Also: the Review merge list (kept until
 * dismissed) with "Possible duplicates", the "Same person" actions, the snapshots block, and chats whose connection only the other device has.
 * The logic is sync_core.ts (merge), same_person.ts, sync_link.ts (relay) and snapshot_view.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { renderQr } from '../../demo/src/ui/qr'
import { scanQr } from '../../demo/src/ui/scanner'
import { Channel } from './model'
import type { AppState, Person } from './model'
import { matchPeople } from './events'
import { mergePersons, possibleDuplicates } from './same_person'
import type { SnapshotView } from './snapshot_view'
import { storageKey } from './store'
import { createSyncLink } from './sync_link'
import type { Incoming, PairRequest, Pairing } from './sync_link'
import type { Conflict } from './sync_core'
import { S } from './strings'

export interface SyncViewHooks {
  persona: string
  storeCtx?: string
  /** The record; on a device that has none yet it makes the empty one first (the first sync of a new phone). */
  state: () => AppState
  /** The record or null: for looking only, never makes one. */
  peek: () => AppState | null
  save: () => void
  sheet: HTMLElement
  openSheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  toast: (msg: string) => void
  when: (at: number) => string
  /** Redraw the app behind the sheet after a merge changed the record. */
  changed: () => void
  snapshots: SnapshotView
}

export interface SyncView {
  /** The row in Settings. */
  settingsGroup(): HTMLElement[]
  /** Opens the relay connection; call once at boot of a personal phone, or when a device without a record starts linking. */
  start(): void
  /** The My devices sheet. */
  open(): void
  /** The "Same person as..." picker on a person's card. */
  samePersonPicker(personId: string): void
}

const SHEET_KIND = 'devices'
const LOG_MAX = 30

/** The name the person gave this device, else "Phone", "Mac" or "Device" and 2 characters, kept so the other device always sees the same one. */
function deviceNameOf(key: string): string {
  try {
    const saved = localStorage.getItem(key)
    if (saved) return saved
    const kind = /iPhone|iPad|Android/.test(navigator.userAgent) ? 'Phone' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Device'
    const name = `${kind} ${Math.random().toString(36).slice(2, 4)}`
    localStorage.setItem(key, name)
    return name
  } catch { return 'Device' }
}

function summary(c: Conflict, side: unknown): string {
  if (typeof side === 'string') return side
  const x = side as { name?: string; text?: string; about?: string; lines?: unknown[] }
  if (c.kind === 'person') return `${x.name ?? ''} · ${x.lines?.length ?? 0}`
  return x.text ?? x.about ?? x.name ?? ''
}

export function createSyncView(h: SyncViewHooks): SyncView {
  const log: string[] = []
  const nameKey = storageKey(h.persona, h.storeCtx) + ':device-name'
  const failed = new Map<string, string>()
  let started = false
  const showing = (): boolean => h.sheet.dataset.kind === SHEET_KIND && h.sheet.classList.contains('on')

  const link = createSyncLink({
    persona: h.persona, storeCtx: h.storeCtx, state: h.state, save: h.save, deviceName: () => deviceNameOf(nameKey), snapshot: h.snapshots.take,
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

  /** Chats with a connection only the other device has: kept, readable, not lost. */
  function orphanChats(s: AppState | null): HTMLElement[] {
    const known = new Set([...(s?.peers ?? []).map((p) => p.id), ...(s?.people ?? []).flatMap((p) => [p.peerId, p.doorPeerId])])
    const rows = Object.entries(s?.chats ?? {}).filter(([id]) => !known.has(id))
    if (!rows.length) return []
    return [
      el('h4', { class: 'eyebrow' }, [S.dvOrphanTitle]),
      el('p', { class: 'meta' }, [S.dvOrphanLead]),
      ...rows.map(([id, t]) => el('button', { class: 'radio', 'data-orphan-chat': id, onclick: () => orphanSheet(t.messages) }, [
        el('small', {}, [S.dvOrphanRow(t.messages.length, t.messages[t.messages.length - 1]?.text.slice(0, 60) ?? '')]),
      ])),
    ]
  }

  function orphanSheet(messages: { dir: string; text: string }[]): void {
    open('devices-orphan', [
      el('h3', {}, [S.dvOrphanTitle]),
      ...messages.map((m) => el('p', {}, [`${m.dir === 'out' ? S.dvOrphanYou : S.dvOrphanThem}: ${m.text}`])),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: devicesSheet }, [S.dvBack]),
    ])
  }

  function devicesSheet(): void {
    const s = h.peek()
    const reviewing = s?.syncReview?.length ?? 0
    const rows = link.pairings().map((p: Pairing) => el('div', { class: 'verse', 'data-device': p.name }, [
      el('h3', {}, [p.name]),
      el('p', { class: 'meta' }, [`${p.fp} · ${p.lastSyncAt ? S.dvLast(h.when(p.lastSyncAt)) : S.dvNever}`]),
      failed.has(p.did) ? el('p', { class: 'warn', 'data-sync-failed': p.did }, [failed.get(p.did)]) : null,
      el('button', { class: 'btn btn-electric btn-sm', 'data-sync-now': p.did, onclick: () => void syncNow(p) }, [failed.has(p.did) ? S.dvTryAgain : S.dvSyncNow]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { if (confirm(S.dvUnlinkConfirm)) { link.unlink(p.did); devicesSheet() } } }, [S.dvUnlink]),
    ]))
    const name = el('input', { class: 'field', value: deviceNameOf(nameKey), maxlength: '40', 'aria-label': S.dvDeviceName, 'data-device-name': '1' })
    open(SHEET_KIND, [
      el('h3', {}, [S.dvTitle]),
      el('p', { class: 'meta' }, [S.dvLead]),
      el('label', { class: 'meta' }, [S.dvDeviceName]),
      name,
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { const v = name.value.trim(); if (v) { try { localStorage.setItem(nameKey, v.slice(0, 40)) } catch { /* kept this visit only */ } } devicesSheet() } }, [S.dvDeviceNameSave]),
      ...(rows.length ? rows : [el('p', { class: 'empty' }, [S.dvNone])]),
      el('button', { class: 'btn btn-electric', 'data-link-device': '1', onclick: () => void linkSheet() }, [S.dvLink]),
      el('button', { class: 'btn btn-ghost', 'data-enter-code': '1', onclick: enterSheet }, [S.dvEnter]),
      reviewing || (s && possibleDuplicates(s.people).length) ? el('button', { class: 'btn btn-ghost', 'data-open-review': '1', onclick: reviewSheet }, [reviewing ? `${S.dvReview} (${reviewing})` : S.dvReview]) : null,
      ...h.snapshots.block(devicesSheet),
      ...orphanChats(s),
      el('h4', { class: 'eyebrow' }, [S.dvLogTitle]),
      logList(),
    ])
  }

  async function syncNow(p: Pairing): Promise<void> {
    try { await link.syncNow(p.did); failed.delete(p.did); h.toast(S.dvSent) } catch (e) {
      failed.set(p.did, (e as Error).message === 'version' ? S.dvUpdate(p.name) : S.dvOffline)
      devicesSheet()
    }
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
    const file = el('input', { type: 'checkbox', id: 'dv-file', 'data-also-file': '1' })
    open('devices-incoming', [
      el('h3', {}, [S.dvReceiveTitle(i.from.name)]),
      el('p', {}, [S.dvReceiveBody(i.counts)]),
      el('p', { class: 'meta' }, [S.dvReceiveFp(i.from.fp)]),
      el('label', { class: 'consent' }, [file, el('span', {}, [S.dvAlsoFile])]),
      el('button', { class: 'btn btn-electric', 'data-receive': '1', onclick: () => void receive(i, file.checked) }, [S.dvReceive]),
      el('button', { class: 'btn btn-ghost', onclick: () => { i.decline(); devicesSheet() } }, [S.dvNotNow]),
    ])
  }

  async function receive(i: Incoming, file: boolean): Promise<void> {
    const res = await i.accept(file)
    h.changed()
    h.toast([S.dvMerged(res.added, res.updated), h.snapshots.note()].filter(Boolean).join(' '))
    if (res.conflicts.length) reviewSheet()
    else devicesSheet()
  }

  function conflictRow(c: Conflict): HTMLElement {
    const keptTheirs = c.kept === 'theirs'
    const [kept, other] = keptTheirs ? [c.theirs, c.mine] : [c.mine, c.theirs]
    return el('div', { class: 'verse', 'data-conflict': c.id }, [
      el('h3', {}, [c.kind === 'channel' ? S.dvChannelLink(S.chLabel[c.id as Channel]) : c.label]),
      c.mineAt === undefined ? null : el('p', { class: 'meta' }, [keptTheirs
        ? S.dvKeptLine(c.theirsBy ?? '?', h.when(c.theirsAt ?? 0), c.mineBy ?? '?', h.when(c.mineAt))
        : S.dvKeptLine(c.mineBy ?? '?', h.when(c.mineAt), c.theirsBy ?? '?', h.when(c.theirsAt ?? 0))]),
      el('p', {}, [`✓ ${summary(c, kept)}`]),
      el('p', {}, [summary(c, other)]),
    ])
  }

  function reviewSheet(): void {
    const s = h.peek()
    const list = s?.syncReview ?? []
    const dups = s ? possibleDuplicates(s.people).slice(0, 20) : []
    open('devices-review', [
      el('h3', {}, [S.dvReviewTitle]),
      el('p', { class: 'meta' }, [S.dvReviewLead]),
      ...(list.length ? list.map(conflictRow) : [el('p', { class: 'empty' }, [S.dvReviewNone])]),
      list.length ? el('button', { class: 'btn btn-ghost btn-sm', 'data-dismiss-review': '1', onclick: () => { if (s) { delete s.syncReview; h.save() } reviewSheet() } }, [S.dvDismiss]) : null,
      dups.length ? el('h4', { class: 'eyebrow' }, [S.dvDupTitle]) : null,
      dups.length ? el('p', { class: 'meta' }, [S.dvDupLead]) : null,
      ...dups.map(([a, b]) => el('div', { class: 'verse', 'data-duplicate': `${a.id},${b.id}` }, [
        el('p', {}, [`${S.dvSameSummary(a.name, a.lines.length, !!a.peerId)} / ${S.dvSameSummary(b.name, b.lines.length, !!b.peerId)}`]),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => samePersonSheet(a.id, b.id, reviewSheet) }, [S.dvSamePerson]),
      ])),
      el('button', { class: 'btn btn-electric', onclick: devicesSheet }, [S.dvTitle]),
    ])
  }

  /** Both summaries, the person picks which entry to keep; a snapshot first, then the two become one. */
  function samePersonSheet(aId: string, bId: string, back: () => void): void {
    const people = h.peek()?.people ?? []
    const pair = [people.find((p) => p.id === aId), people.find((p) => p.id === bId)]
    if (!pair[0] || !pair[1]) { back(); return }
    const [a, b] = pair as [Person, Person]
    const keep = async (kept: Person, dropped: Person): Promise<void> => {
      await h.snapshots.take(S.snReasonSame)
      const s = h.state()
      if (mergePersons(s, kept.id, dropped.id)) {
        h.save()
        h.changed()
        h.toast([S.dvSameDone(kept.name), h.snapshots.note()].filter(Boolean).join(' '))
      }
      back()
    }
    open('devices-same', [
      el('h3', {}, [S.dvSameTitle]),
      el('p', { class: 'meta' }, [S.dvSameLead]),
      ...[[a, b], [b, a]].map(([kept, dropped]) => el('button', { class: 'radio', 'data-same-keep': kept.id, onclick: () => void keep(kept, dropped) }, [
        el('b', {}, [S.dvSameSummary(kept.name, kept.lines.length, !!kept.peerId)]),
        el('small', {}, [`${S.dvSameKeep}${kept.context ? ' · ' + kept.context : ''}`]),
      ])),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: back }, [S.dvCancel]),
    ])
  }

  function samePersonPicker(personId: string): void {
    const others = (h.peek()?.people ?? []).filter((p) => p.id !== personId)
    const input = el('input', { class: 'field', placeholder: S.dvSamePh, 'aria-label': S.dvSamePh, autocomplete: 'off', 'data-same-search': '1' })
    const list = el('div', {})
    const draw = (): void => list.replaceChildren(...matchPeople(others, input.value, 8).map((p) => el('button', {
      class: 'radio', 'data-same-pick': p.id, onclick: () => samePersonSheet(personId, p.id, h.closeSheet),
    }, [el('b', {}, [p.name]), el('small', {}, [p.context])])))
    input.addEventListener('input', draw)
    draw()
    open('devices-same', [el('h3', {}, [S.dvSameAs]), input, list, el('button', { class: 'btn btn-ghost btn-sm', onclick: h.closeSheet }, [S.dvCancel])])
  }

  function start(): void {
    if (started) return
    started = true
    void link.start()
  }

  return {
    settingsGroup: () => [
      el('button', { class: 'radio', 'data-open-devices': '1', onclick: devicesSheet }, [el('b', {}, [S.dvOpen]), el('small', {}, [S.dvOpenHint])]),
    ],
    start,
    open: devicesSheet,
    samePersonPicker,
  }
}
