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
import { heldNames, namesOf } from './names_sync'
import type { NamesOutcome } from './names_sync'
import type { ConnectRecord } from './connect_code'
import { opensOn } from './sync_code'
import type { CodeMerge } from './sync_code'
import { dropCode, makePrimary, moveHere, openHere, pickCode, refreshAll, releaseName, rotateCodes, settleCodes } from './sync_codes'
import type { CodeOpsDeps } from './sync_codes'
import { createSyncLink } from './sync_link'
import type { Incoming, PairRequest, Pairing } from './sync_link'
import type { Conflict } from './sync_core'
import { SCHEMA_VERSION } from './schema_version'
import { linkButton } from './link_change_view'
import { S } from './strings'
import { setDeviceNameSource } from './device_name'

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
  /** Wave 15: the DID this device asks with (its public link carries it); undefined until it has one. */
  askDid: () => string | undefined
  /** Wave 15: what the username actions need (fetch, clock, the record); null where this page may not talk to the service. */
  codeDeps: () => Omit<CodeOpsDeps, 'log'> | null
  /** Wave 15: this device's own long connect link, for "Open on this device". */
  connectLink: () => Promise<string>
  /** Opens the sheet that changes the main name; the shown link becomes a tappable text. */
  editLink?: () => void
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

  const addLog = (line: string): void => {
    log.unshift(`${new Date().toLocaleTimeString()}  ${line}`)
    log.length = Math.min(log.length, LOG_MAX)
    if (showing()) logBox()?.replaceWith(logList())
  }
  /** What the username actions run with: the host's deps and this view's log. */
  const codeDeps = (): CodeOpsDeps | null => { const d = h.codeDeps(); return d && { ...d, log: addLog } }

  setDeviceNameSource(() => deviceNameOf(nameKey))
  const link = createSyncLink({
    persona: h.persona, storeCtx: h.storeCtx, state: h.state, save: h.save, deviceName: () => deviceNameOf(nameKey), snapshot: h.snapshots.take,
    onLog: (line) => addLog(line),
    onChange: () => { if (showing()) devicesSheet() },
    askDid: h.askDid,
    settleCodes: async (merge) => { const deps = codeDeps(); if (deps) await settleCodes(deps, merge) },
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
      shareToggle(p),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { if (confirm(S.dvUnlinkConfirm)) void unlinkDevice(p) } }, [S.dvUnlink]),
    ]))
    const name = el('input', { class: 'field', value: deviceNameOf(nameKey), maxlength: '40', 'aria-label': S.dvDeviceName, 'data-device-name': '1' })
    open(SHEET_KIND, [
      el('h3', {}, [S.dvTitle]),
      el('p', { class: 'meta' }, [S.dvLead]),
      el('p', { class: 'meta', 'data-un-honesty': '1' }, [S.unHonesty]),
      el('label', { class: 'meta' }, [S.dvDeviceName]),
      name,
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { const v = name.value.trim(); if (v) { try { localStorage.setItem(nameKey, v.slice(0, 40)) } catch { /* kept this visit only */ } } devicesSheet() } }, [S.dvDeviceNameSave]),
      ...(rows.length ? rows : [el('p', { class: 'empty' }, [S.dvNone])]),
      ...usernameBlock(s),
      el('button', { class: 'btn btn-electric', 'data-link-device': '1', onclick: () => void linkSheet() }, [S.dvLink]),
      el('button', { class: 'btn btn-ghost', 'data-enter-code': '1', onclick: enterSheet }, [S.dvEnter]),
      reviewing || (s && possibleDuplicates(s.people).length) ? el('button', { class: 'btn btn-ghost', 'data-open-review': '1', onclick: reviewSheet }, [reviewing ? `${S.dvReview} (${reviewing})` : S.dvReview]) : null,
      ...h.snapshots.block(devicesSheet),
      ...orphanChats(s),
      el('h4', { class: 'eyebrow' }, [S.dvLogTitle]),
      logList(),
    ])
  }

  /** The tick "Shares my username" per pairing (D1); switching it off renews the secret of the codes this device owns, so the other side's copy dies. */
  function shareToggle(p: Pairing): HTMLElement {
    const box = el('input', { type: 'checkbox', checked: p.shareCode !== false, 'data-share-toggle': p.did }) as HTMLInputElement
    box.onchange = () => {
      const was = p.shareCode !== false
      link.setShare(p.did, box.checked)
      const deps = codeDeps()
      if (was && !box.checked && deps) void rotateCodes(deps).then(() => { if (showing()) devicesSheet() })
    }
    return el('label', { class: 'consent' }, [box, el('span', {}, [S.unSharesToggle])])
  }

  /**
   * Unlink. When the public link opens on the device being unlinked, it is first moved to this device ("Open on this device"); if that fails the unlink is
   * refused with the reason (F5). Afterwards the secrets of the codes this device owns are renewed when the pairing shared them.
   */
  async function unlinkDevice(p: Pairing): Promise<void> {
    const main = h.peek()?.connectCode
    const deps = codeDeps()
    if (main && !main.stale) {
      const on = opensOn(main.url, h.askDid(), link.pairings())
      if (on.kind === 'device' && on.did === p.did) {
        const ok = deps ? await openHere(deps, await h.connectLink()).catch(() => false) : false
        if (!ok) { h.toast(S.unUnlinkRefused); return }
        h.toast(S.unOpenedFirst)
      }
    }
    const shared = p.shareCode !== false
    link.unlink(p.did)
    if (deps && shared) await rotateCodes(deps)
    devicesSheet()
  }

  /** The device a record came from, by its pairing's name; this device when it minted the code itself. */
  function deviceOf(r: ConnectRecord): string {
    if (!r.fromDid) return S.unThisDevice
    return link.pairings().find((p) => p.did === r.fromDid)?.name ?? S.unAnother
  }

  /** Where the public link opens, in words. */
  function opensLabel(url: string): string {
    const on = opensOn(url, h.askDid(), link.pairings())
    return on.kind === 'this' ? S.unThisDevice : on.kind === 'device' ? link.pairings().find((p) => p.did === on.did)?.name ?? S.unAnother : S.unAnother
  }

  /** Runs one username action, says why when it fails, and draws the sheet again. */
  async function act(run: (deps: CodeOpsDeps) => Promise<NamesOutcome | boolean>): Promise<void> {
    const deps = codeDeps()
    if (!deps) return
    const out = await run(deps)
    if (typeof out === 'boolean') h.toast(out ? S.unOpenHereDone : S.unOpenHereFailed)
    else if (!out.ok) h.toast(S.usernameFailed[out.error])
    h.changed()
    devicesSheet()
  }

  function nameRow(r: ConnectRecord, name: string, primary: boolean, main: boolean): HTMLElement {
    const locked = namesOf(r).locked.includes(name)
    return el('div', { class: 'verse', 'data-un-name': name }, [
      el('b', {}, [`@${name}`]),
      locked ? el('button', { class: 'btn-ghost', 'data-un-lock': name, title: S.unLockedWhy, 'aria-label': S.unLockedWhy, onclick: () => h.toast(S.unLockedWhy) }, ['🔒']) : null,
      primary ? el('span', { class: 'meta', 'data-un-primary-hint': name }, [S.unPrimaryHint]) : null,
      el('p', { class: 'meta' }, [S.unOnDevice(deviceOf(r))]),
      !main ? el('button', { class: 'btn btn-ghost btn-sm', 'data-un-move': name, onclick: () => void act((d) => moveHere(d, name, r)) }, [S.unMoveHere(name)]) : null,
      !primary ? el('button', { class: 'btn btn-ghost btn-sm', 'data-un-primary': name, onclick: () => void act((d) => makePrimary(d, name, main ? null : r)) }, [S.unMakePrimary(name)]) : null,
      !main && !locked ? el('button', { class: 'btn btn-ghost btn-sm', 'data-un-release': name, onclick: () => void act((d) => releaseName(d, name, r)) }, [S.unRelease(name)]) : null,
    ])
  }

  /** Settings > My devices > "My username": every name this account holds (this device's code and the others), where the link opens, and the four actions. */
  function usernameBlock(s: AppState | null): (HTMLElement | null)[] {
    const main = s?.connectCode
    const others = s?.otherCodes ?? []
    if (!main && !others.length) return []
    const mainNames = main ? heldNames(namesOf(main)) : []
    const opens = main && !main.stale && mainNames.length ? opensLabel(main.url) : null
    const movable = main && !main.stale && opensOn(main.url, h.askDid(), link.pairings()).kind !== 'this'
    return [
      el('h4', { class: 'eyebrow', 'data-my-username': '1' }, [S.unTitle]),
      main?.stale ? el('p', { class: 'warn', 'data-un-stale': '1' }, [main.owner === 'other' ? S.unStale : S.unStaleThis]) : null,
      opens ? el('p', { 'data-un-opens': '1' }, [S.unOpensOn(mainNames[0], opens)]) : null,
      opens ? el('p', { class: 'meta' }, [S.unNewOn(opens)]) : null,
      ...(main && !main.stale ? mainNames.map((n, i) => nameRow(main, n, i === 0, true)) : []),
      movable ? el('button', { class: 'btn btn-electric btn-sm', 'data-un-open-here': '1', onclick: () => void act(async (d) => openHere(d, await h.connectLink())) }, [S.unOpenHere]) : null,
      others.some((r) => heldNames(namesOf(r)).length) ? el('p', { class: 'meta' }, [S.unLeft]) : null,
      ...others.flatMap((r) => (r.stale ? [] : heldNames(namesOf(r)).map((n) => nameRow(r, n, false, false)))),
      ...others.filter((r) => !r.stale && !heldNames(namesOf(r)).length).map((r) => el('div', { class: 'verse', 'data-un-old': r.code }, [
        el('p', { class: 'meta' }, [S.unOldLink]),
        el('button', { class: 'btn btn-ghost btn-sm', 'data-un-drop': r.code, onclick: () => { const s = h.peek(); if (s) dropCode(s, h.save, r.code); devicesSheet() } }, [S.unReleaseOld]),
      ])),
    ]
  }

  /** The one-time sheet after the owner kept one link for all devices. */
  function mergedSheet(): void {
    const name = h.peek()?.connectCode?.name
    if (!name) return devicesSheet()
    open('devices-merged', [
      el('h3', {}, [S.unTitle]),
      el('p', { 'data-un-merged': '1' }, [S.unMerged(name)]),
      el('button', { class: 'btn btn-electric', onclick: devicesSheet }, [S.unMergedOk]),
    ])
  }

  /** Two links met and this device's would lose names: the owner picks which to keep; nothing has moved yet, "Later" leaves it for the next sync (F1, D2). */
  function choiceSheet(c: NonNullable<CodeMerge['choice']>): void {
    const names = (r: ConnectRecord): string[] => heldNames(namesOf(r))
    const side = (r: ConnectRecord, who: 'mine' | 'theirs'): HTMLElement => el('div', { class: 'verse', 'data-un-choice': who }, [
      el('b', {}, [`trustweb.one/${names(r)[0]}`]),
      el('p', { class: 'meta' }, [`${S.unOnDevice(deviceOf(r))}: ${names(r).map((n) => '@' + n).join(', ')}`]),
      el('button', { class: 'btn btn-electric btn-sm', 'data-un-keep': who, onclick: () => void pick(c, who) }, [S.unKeep(names(r)[0])]),
    ])
    open('devices-choice', [
      el('h3', {}, [S.unTitle]),
      el('p', {}, [S.unChoose(names(c.mine)[0], names(c.theirs)[0], deviceOf(c.theirs))]),
      side(c.mine, 'mine'), side(c.theirs, 'theirs'),
      el('button', { class: 'btn btn-ghost', 'data-un-later': '1', onclick: devicesSheet }, [S.unLater]),
    ])
  }

  async function pick(c: NonNullable<CodeMerge['choice']>, keep: 'mine' | 'theirs'): Promise<void> {
    const deps = codeDeps()
    if (!deps) { h.toast(S.unOpenHereFailed); return }
    await pickCode(deps, c, keep)
    h.changed()
    mergedSheet()
  }

  async function syncNow(p: Pairing): Promise<void> {
    try { await link.syncNow(p.did); failed.delete(p.did); h.toast(S.dvSent) } catch (e) {
      failed.set(p.did, { version: S.dvUpdate(p.name), offline: S.dvOffline, 'too large': S.dvTooLarge }[(e as Error).message] ?? S.dvSendFailed)
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
    const share = el('input', { type: 'checkbox', id: 'dv-share-code', checked: true, 'data-share-code': '1' }) as HTMLInputElement
    open('devices-confirm', [
      el('h3', {}, [S.dvConfirmTitle]),
      el('p', { class: 'meta' }, [S.dvConfirmLead(r.name)]),
      el('code', { class: 'recovery-key', 'data-fingerprint': r.fp }, [r.fp]),
      el('label', { class: 'consent' }, [share, el('span', {}, [S.unShareTick])]),
      el('button', { class: 'btn btn-electric', 'data-pair-confirm': '1', onclick: () => { r.confirm({ shareCode: share.checked }); h.toast(S.dvLinked(r.name)); devicesSheet() } }, [S.dvConfirm]),
      el('button', { class: 'btn btn-ghost', onclick: () => { r.cancel(); devicesSheet() } }, [S.dvCancel]),
    ])
  }

  function incomingSheet(i: Incoming): void {
    if (i.newer) {
      open('devices-incoming', [el('h3', {}, [S.dvReceiveTitle(i.from.name)]), el('p', { 'data-schema-newer': String(i.newer) }, [S.schemaNewer(i.newer, SCHEMA_VERSION)]), el('button', { class: 'btn btn-ghost', onclick: () => { i.decline(); devicesSheet() } }, [S.dvNotNow])])
      return
    }
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
    if (res.codes?.choice) choiceSheet(res.codes.choice)
    else if (res.conflicts.length) reviewSheet()
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

  /** Opens the sheet and reads the names of every code again, so what the server holds is on show (silent when it cannot be reached). */
  function openDevices(): void {
    devicesSheet()
    const deps = codeDeps()
    if (deps && h.peek()?.connectCode) void refreshAll(deps).then(() => { if (showing()) devicesSheet() })
  }

  function start(): void {
    if (started) return
    started = true
    void link.start()
  }

  return {
    settingsGroup: () => {
      const row = el('button', { class: 'radio', 'data-open-devices': '1', onclick: openDevices }, [el('b', {}, [S.dvOpen]), el('small', {}, [S.dvOpenHint])])
      const code = h.peek()?.connectCode
      return code?.name && !code.stale ? [row, el('p', { class: 'meta', 'data-settings-username': '1' }, [`${S.unTitle}: `, h.editLink ? linkButton(code.name, h.editLink) : `trustweb.one/${code.name}`])] : [row]
    },
    start,
    open: openDevices,
    samePersonPicker,
  }
}
