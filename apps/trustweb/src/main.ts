/**
 * TrustWeb: the one merged demo app (app.idea2.site/trustweb/).
 *
 * Substance from apps/demo (relay-mode consent flow, via net.ts); look and
 * nav chrome from apps/mobile-ui (the rings, bottom bar with a raised
 * button); the notes flow from the owner's note-taking mockup.
 *
 * Nav (owner, 2026-10-05): Web | Record | Inventory, Record raised in the
 * middle. Querying happens ON the Web screen (a Query button bottom right
 * opens a dock under the rings), because you always see your web when you
 * ask it. Tapping empty space in the web adds someone. Web's Curate (top
 * right) lists the connections. The QR button in every header opens Meet
 * (QR, NFC); Meet is also offered when a meeting ends.
 *
 * Record is solo by default and laid out like Tana mobile's voice memo
 * (circle and clock, then discard / pause / send). Its top-right Meeting
 * button opens the meeting view: who and where, consent, and a Tana-style
 * speaker transcript fed by TalkWeave (desktop) or on-device speech.
 * No chat, no unread badges, notifications off by default.
 */
import './styles.css'
import { el, clear } from '../../demo/src/ui/dom'
import { renderQr } from '../../demo/src/ui/qr'
import { parseConnectLinkParams } from '../../demo/src/connect_link'
import { randomId } from '../../demo/src/crypto'
import { ANSWER_WINDOW_MS, Net } from './net'
import type { AskResult, IncomingAsk, RelayStatus } from './net'
import {
  AUDIENCES, Audience, CHANNELS, Channel, LineStatus, QueryStyle, RINGS, Ring, TAGS, TabOrder, Tag, ageLabel, coarseWhen,
} from './model'
import { channelLink, normalizeHandle } from './channel'
import type { AppState, NoteLine, Person } from './model'
import { extractLines } from './notes'
import { S } from './strings'
import { clearState, isEphemeral, loadState, saveState } from './store'
import { DemoContext, Persona, isDemoContext, isPersona, seedState } from './seed'
import { MeetingRecorder, RecorderSupport, audioExtension, clock, recorderSupport } from './recorder'
import type { Recording } from './recorder'
import { nfcWriteSupported, writeLinkToTag } from './nfc'
import { TranscriberEngine, TranscriberStatus, createTranscriber, detectEngine } from './meeting_transcriber'
import type { MeetingTranscriber, Segment } from './meeting_transcriber'
import { meetingToNoteText, meetingToText } from './sensemeet'
import { BackupNotFound, backupNow, keyFromPassphrase, newRandomKey, parseKeyText, restore } from './backup'
import type { BackupKey } from './backup'

enum Screen {
  Start = 'start',
  Web = 'web',
  Curate = 'curate',
  Inventory = 'inventory',
  Record = 'record',
  Meeting = 'meeting',
  Meet = 'meet',
  Review = 'review',
  Place = 'place',
  StillTrue = 'still',
}

/** Recording by myself is the default; a meeting recording needs the other person's yes. */
enum RecordMode {
  Solo = 'solo',
  Meeting = 'meeting',
}

interface Point {
  id: string
  text: string
  done: boolean
}

interface DraftLine {
  id: string
  text: string
  tag: Tag
  customTag?: string
  audience: Audience
}

interface Draft {
  personId?: string
  name: string
  context: string
  text: string
  mode: RecordMode
  /** Only meaningful for a meeting recording: the other person agreed. */
  consent: boolean
  /** Parked with the old Record fields (2026-10-05); kept so a later view can bring points back. */
  points: Point[]
  /** The meeting transcript, one entry per utterance, in order. */
  segments: Segment[]
  lines: DraftLine[]
  ring: Ring
}

interface Review {
  personId: string
  verdict: Map<string, 'true' | 'changed' | 'gone'>
  edits: Map<string, string>
}

// ---------------------------------------------------------------------------
// boot parameters
// ---------------------------------------------------------------------------

const APP_URL = location.origin + import.meta.env.BASE_URL
const params = new URLSearchParams(location.search)
const personaParam = params.get('persona')
const persona: string = isPersona(personaParam) ? personaParam : 'me'
const solo = params.get('solo') === '1' && persona !== 'me'
// Which of the three seeded demo networks (seed.ts DemoContext) to show,
// passed in by solo.ts from its own page path. Only meaningful (and only
// ever read/written into storage) when solo: a real visitor at the app root
// (persona 'me') must keep using the original, context-less storage key --
// see store.ts's own module doc for why.
const ctxParam = params.get('ctx')
const ctx: DemoContext = isDemoContext(ctxParam) ? ctxParam : DemoContext.Generic
const storeCtx = solo ? ctx : undefined
let pendingConnect = parseConnectLinkParams(location.search)
// Notes shared by a Meet code ride in the URL FRAGMENT (#n=...), which a
// browser never sends to the server, so they stay out of access logs.
const sharedNotes = (new URLSearchParams(location.hash.slice(1)).get('n') ?? '').slice(0, 600)
// Keep only what a reload needs; the connect parameters are consumed once.
history.replaceState(null, '', location.pathname + (solo ? `?persona=${persona}&solo=1&ctx=${ctx}` : ''))

let state: AppState | null = loadState(persona, storeCtx)
// Side-by-side demo phones start like a real phone, with "Your first name"
// (owner 2026-10-05); the name field is prefilled from ?device_name= and the
// demo content (web, inventory) is seeded under the name typed in createMe().
// Not ?name=: a connect link already carries the inviter's name there.
const defaultName = solo ? (params.get('device_name') ?? '').slice(0, 40) : ''

function st(): AppState {
  if (!state) throw new Error('no state yet')
  return state
}
function save(): void {
  if (state) saveState(persona, state, storeCtx)
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

let screen: Screen = state ? Screen.Web : Screen.Start
let relayStatus: RelayStatus = 'connecting'
let draft: Draft = freshDraft()
let review: Review | null = null
let queryOpen = false
let searchOpen = false
let searchText = ''
let queryText = ''
let askRun: {
  text: string; asked: number; askedPeerIds: string[]; startedAt: number; results: AskResult[] | null
} | null = null
const askQueue: IncomingAsk[] = []
let askShowing: IncomingAsk | null = null
let askDecision: boolean | null = null
// Where Meet's back arrow returns to (Manage, Record, or Web).
let meetFrom: Screen = Screen.Web
// The recording belongs to the current draft; it is dropped with it.
const recorder = new MeetingRecorder()
// Every take of the current draft, oldest first: a new take never overwrites one.
let takes: Recording[] = []
let recNotice = ''
let recTicker: ReturnType<typeof setInterval> | undefined
let wakeLock: WakeLockSentinel | null = null
// Meeting transcription: the engine is probed once, the transcriber lives per meeting.
let transcriber: MeetingTranscriber | null = null
let engine: TranscriberEngine | null = null
let transcribing = true
let speaker = 1
// Meet shares the current draft's notes only when opened from that draft
// (after a shared recording), never from Manage: notes about one person must
// not ride into the code shown to the next.
let meetNotes = ''

function freshDraft(personId?: string): Draft {
  const p = personId ? state?.people.find((x) => x.id === personId) : undefined
  return {
    personId, name: p?.name ?? '', context: p?.context ?? '', text: '',
    mode: RecordMode.Solo, consent: false, points: [], segments: [], lines: [],
    ring: p?.ring ?? Ring.Acquaintance,
  }
}

/** Starts a new draft, dropping any recording that belonged to the old one. */
function newDraft(personId?: string): void {
  dropRecording()
  draft = freshDraft(personId)
}

// ---------------------------------------------------------------------------
// network
// ---------------------------------------------------------------------------

const net = new Net({
  state: st,
  save,
  onStatus: (s) => { relayStatus = s; updateStatusPill() },
  onAsk: (ask) => {
    askQueue.push(ask)
    notify(S.notifBodyAsk(ask.fromName))
    if (!askShowing) showNextAsk()
  },
  onPeerConnected: (peer) => {
    const s = st()
    const byName = draft.name.trim()
    let person = s.people.find((p) => p.peerId === peer.id)
      ?? (byName ? s.people.find((p) => p.name.toLowerCase() === byName.toLowerCase()) : undefined)
    if (!person) {
      if (screen === Screen.Meet && !byName) draft.name = peer.displayName
      person = { id: randomId(8), name: peer.displayName, context: draft.context, ring: peer.ring, metAt: Date.now(), lines: [] }
      s.people.push(person)
    }
    person.peerId = peer.id
    save()
    closeSheet()
    toast(S.peerConnectedToast(peer.displayName, S.ringLabel[peer.ring]))
    render()
  },
  ringForNewPeer: () => (solo ? Ring.Friend : Ring.Acquaintance),
  onLogChanged: () => { if (screen === Screen.Inventory) render() },
})

function notify(body: string): void {
  if (!state?.notificationsOn || !document.hidden || typeof Notification === 'undefined') return
  if (Notification.permission === 'granted') {
    try { new Notification(S.appName, { body }) } catch { /* some browsers only allow this from a service worker */ }
  }
}

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

const root = document.getElementById('app') as HTMLElement
const phone = el('div', { class: 'phone' + (solo ? ' embedded' : '') })
const host = el('div', { class: 'screen on' })
const tabs = el('nav', { class: 'tabs', 'aria-label': 'Main' })
const veil = el('div', { class: 'sheet-veil', onclick: () => closeSheet() })
const sheet = el('div', { class: 'sheet', role: 'dialog', inert: true })
const overlay = el('div', { class: 'overlay cosmic', role: 'alertdialog' })
const toastEl = el('div', { class: 'toast', role: 'status' })
let statusPill: HTMLElement | null = null
phone.append(host, tabs, veil, sheet, overlay, toastEl)
root.replaceChildren(phone)
// On a wide screen, outside the phone: open the side-by-side demo (not inside
// the demo's own iframes, and not on a real phone, where the app is full screen).
if (!solo && window.top === window) {
  const add = el('a', { class: 'add-device', href: APP_URL + 'demo/', title: S.addDevice }, [
    el('span', { class: 'add-device-plus', 'aria-hidden': 'true' }, ['+']),
    el('span', {}, [S.addDevice]),
  ])
  root.append(add)
}

// Icons: web, inventory and query are this app's own; mic, pause, play, send,
// x, qr, handshake, settings (a cog, never a sun-like icon: owner 2026-10-05),
// users and info are Lucide icons (lucide.dev, ISC licence).
const ICONS: Record<string, string> = {
  web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="7" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="10.5" stroke-dasharray="2 3"/></svg>',
  inventory: '<svg viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/></svg>',
  query: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M6 3l14 9-14 9z"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M3.7 3.05a.5.5 0 0 0-.68.63l2.84 7.62a2 2 0 0 1 0 1.4l-2.84 7.62a.5.5 0 0 0 .68.63l18-8.5a.5.5 0 0 0 0-.9z"/><path d="M6 12h16"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  qr: '<svg viewBox="0 0 24 24"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>',
  handshake: '<svg viewBox="0 0 24 24"><path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/></svg>',
  users: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
  // "Call into your web": only the sound waves (owner 2026-10-05: "simpler and
  // less confusing"), the call going out and the resonance coming back.
  call: '<svg viewBox="0 0 24 24"><path d="M5.5 8.5a5 5 0 0 1 0 7"/><path d="M9.5 5.5a9.5 9.5 0 0 1 0 13"/><path d="M13.5 2.8a13.5 13.5 0 0 1 0 18.4"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/></svg>',
}

/** Which query button the owner chose in Settings (default: call into your web). */

function queryStyle(): QueryStyle {
  return state?.queryStyle ?? QueryStyle.Call
}

function icon(name: string): string {
  return ICONS[name]
}

function tabButton(target: Screen, label: string, name: string): HTMLElement {
  const b = el('button', { class: 'tab', 'data-go': target, onclick: () => go(target) })
  b.innerHTML = icon(name)
  b.append(label)
  return b
}

function recordButton(): HTMLElement {
  const b = el('button', { class: 'tab-record', 'data-go': Screen.Record, 'aria-label': S.navRecord, onclick: onRecordTap })
  b.innerHTML = icon('mic')
  b.append(el('span', {}, [S.navRecord]))
  return b
}

function renderTabs(): void {
  const web = tabButton(Screen.Web, S.navWeb, 'web')
  const inv = tabButton(Screen.Inventory, S.navInventory, 'inventory')
  const invLeft = state?.tabOrder === TabOrder.InventoryLeft
  tabs.replaceChildren(invLeft ? inv : web, recordButton(), invLeft ? web : inv)
}
renderTabs()

/** The screen that belongs to the draft's mode: Record (solo) or Meeting. */
function recordScreen(): Screen {
  return draft.mode === RecordMode.Meeting ? Screen.Meeting : Screen.Record
}

function onRecordTap(): void {
  // The Record tab never wipes a draft in progress (audio, transcript,
  // who/where); it only starts fresh when nothing is in flight.
  if (!draftInProgress()) newDraft()
  go(recordScreen())
}

/**
 * A new note never silently replaces one in progress (a live recording is one
 * tap away from here via the pill): it returns to that draft instead, where
 * discarding is the one deliberate way to drop it.
 */
function startDraftFor(personId?: string): void {
  if (draftInProgress()) {
    toast(S.recBusy)
    go(recordScreen())
    return
  }
  newDraft(personId)
  go(Screen.Record)
}

function draftInProgress(): boolean {
  return recorder.live || takes.length > 0
    || Boolean(draft.name.trim() || draft.text.trim() || draft.segments.length || draft.lines.length)
}

function go(s: Screen): void {
  screen = s
  closeSheet()
  render()
}

/**
 * Every header: title left; right, the screen's own button and then the
 * QR button that opens Meet (with a tiny relay-status dot on it). While a
 * take is open the QR gives way to the "Recording" pill, on every screen.
 */
function header(title: string, opts: { back?: () => void; right?: Node | null; qr?: boolean; more?: boolean } = {}): HTMLElement {
  statusPill = el('button', { class: 'status-pill' })
  updateStatusPill(opts.qr !== false)
  return el('div', { class: 'hdr' }, [
    el('div', { class: 'hdr-left' }, [
      opts.back ? el('button', { class: 'back', 'aria-label': S.back, onclick: opts.back }, ['‹']) : null,
      el('h2', {}, [title]),
    ]),
    el('div', { class: 'hdr-right' }, [opts.right ?? null, statusPill, opts.more ? moreButton() : null]),
  ])
}

function iconButton(name: string, label: string, onclick: () => void, extra = ''): HTMLElement {
  const b = el('button', { class: 'hdr-btn icon-only' + (extra ? ' ' + extra : ''), 'aria-label': label, title: label, onclick })
  b.innerHTML = icon(name)
  return b
}

function moreButton(): HTMLElement {
  return iconButton('more', S.moreOpen, moreMenu, 'more')
}

/** The ⋮ menu (top right): settings, and curating the web. */
function moreMenu(): void {
  const item = (name: string, label: string, onclick: () => void): HTMLElement => {
    const b = el('button', { class: 'menu-item', onclick })
    b.innerHTML = icon(name)
    b.append(el('span', {}, [label]))
    return b
  }
  openSheet([
    item('settings', S.moreSettings, settingsSheet),
    item('users', S.searchCurate, () => go(Screen.Curate)),
  ])
}

function relayLabel(): string {
  return relayStatus === 'connected' ? S.statusConnected
    : relayStatus === 'connecting' ? S.statusConnecting : S.statusDisconnected
}

/** Re-applies the pill for the current state; `withQr` false hides the idle QR (Meet, Record). */
function updateStatusPill(withQr: boolean = statusPill?.dataset.qr !== '0'): void {
  const p = statusPill
  if (!p) return
  p.dataset.qr = withQr ? '1' : '0'
  p.onclick = null
  p.removeAttribute('title')
  if (recorder.live) {
    const meeting = draft.mode === RecordMode.Meeting
    p.className = 'status-pill rec' + (recorder.paused ? ' paused' : '')
    p.textContent = recorder.paused ? S.statusPaused : meeting ? S.statusRecordingMeeting : S.statusRecording
    p.removeAttribute('aria-label')
    p.hidden = false
    p.onclick = (): void => go(recordScreen())
    return
  }
  p.hidden = !withQr
  p.className = 'status-pill qr ' + relayStatus
  p.innerHTML = icon('qr')
  p.append(el('span', { class: 'relay-dot', 'aria-hidden': 'true' }))
  p.setAttribute('aria-label', `${S.qrOpen} (${relayLabel()})`)
  p.title = `${S.qrOpen} · ${relayLabel()}`
  p.onclick = (): void => openMeet(screen === Screen.Meet ? meetFrom : screen)
}

function render(): void {
  const showTabs = screen !== Screen.Start
  tabs.style.display = showTabs ? 'flex' : 'none'
  tabs.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => {
    const target = b.getAttribute('data-go')
    const on = target === screen
      || (target === Screen.Record && (screen === Screen.Meeting || screen === Screen.Review || screen === Screen.Place))
      || (target === Screen.Web && (screen === Screen.StillTrue || screen === Screen.Curate))
    b.classList.toggle('on', on)
  })
  tabs.querySelector('.tab-record')?.classList.toggle('live', recorder.live && !recorder.paused)
  host.className = 'screen on ' + screen + (screen === Screen.Web && queryOpen ? ' querying' : '')
  const body = (() => {
    switch (screen) {
      case Screen.Start: return screenStart()
      case Screen.Web: return screenWeb()
      case Screen.Curate: return screenCurate()
      case Screen.Inventory: return screenInventory()
      case Screen.Record: return screenRecord()
      case Screen.Meeting: return screenMeeting()
      case Screen.Meet: return screenMeet()
      case Screen.Review: return screenReview()
      case Screen.Place: return screenPlace()
      case Screen.StillTrue: return screenStillTrue()
    }
  })()
  host.replaceChildren(...body)
  if (screen === Screen.Web) requestAnimationFrame(fitRings)
}

// ---------------------------------------------------------------------------
// sheet, toast
// ---------------------------------------------------------------------------

function openSheet(children: (Node | null)[]): void {
  sheet.replaceChildren(el('div', { class: 'grab' }), ...children.filter((c): c is Node => c !== null))
  sheet.classList.add('on')
  sheet.inert = false
  veil.classList.add('on')
}

function closeSheet(): void {
  // A closed sheet keeps its last content off-screen; inert takes it out of
  // the tab order and the accessibility tree.
  sheet.inert = true
  sheet.classList.remove('on')
  veil.classList.remove('on')
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
function toast(msg: string): void {
  toastEl.textContent = msg
  toastEl.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 3200)
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

function createMe(name: string): void {
  const displayName = name.trim().slice(0, 40)
  state = solo
    ? { ...seedState(persona as Persona, Date.now(), ctx), me: { id: randomId(12), displayName } }
    : { v: 1, me: { id: randomId(12), displayName }, peers: [], people: [], inventory: [], log: [], notificationsOn: false }
  save()
}

/** In the side-by-side demo, the first phone hands its connect link to the page for the others. */
function announceLink(): void {
  if (solo && persona === Persona.Holder && window.parent !== window) {
    window.parent.postMessage({ type: 'trustweb-connect-link', url: net.connectLink(APP_URL) }, location.origin)
  }
}

async function completePendingConnect(): Promise<void> {
  const link = pendingConnect
  if (!link || !state) return
  pendingConnect = null
  const ring = solo ? Ring.Friend : Ring.Acquaintance
  const peer = await net.completeConnect(link, ring)
  const s = st()
  let person = s.people.find((p) => p.peerId === peer.id)
  if (!person) {
    person = { id: randomId(8), name: peer.displayName, context: '', ring, metAt: Date.now(), lines: [], peerId: peer.id }
    s.people.push(person)
  }
  if (sharedNotes) {
    const now = Date.now()
    person.context = S.notesReceivedContext(peer.displayName)
    for (const l of extractLines(sharedNotes)) {
      person.lines.push({ id: randomId(8), text: l.text, tag: l.tag, audience: Audience.OnlyMe, status: LineStatus.Current, notedAt: now, checkedAt: now })
    }
  }
  save()
  toast(S.peerConnectedToast(peer.displayName, S.ringLabel[ring]))
  render()
}

function screenStart(): Node[] {
  const name = el('input', { class: 'field', placeholder: S.yourName, autocomplete: 'given-name', maxlength: '40', 'aria-label': S.yourName, value: defaultName })
  const submit = (): void => {
    if (!name.value.trim()) { name.focus(); return }
    createMe(name.value)
    screen = Screen.Web
    render()
    void net.start().then(announceLink)
    void completePendingConnect()
  }
  name.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') submit() })
  const invite = pendingConnect
  return [el('div', { class: 'start' }, [
    el('div', { class: 'logo' }, ['◎']),
    el('h1', {}, [S.appName]),
    el('p', { class: 'tagline' }, [S.tagline]),
    invite
      ? el('div', { class: 'invite' }, [
          el('b', {}, [S.connectInvite(invite.from.displayName || 'Someone')]),
          sharedNotes ? el('p', {}, [S.connectInviteNotes(invite.from.displayName || 'Someone')]) : null,
        ])
      : el('p', { class: 'lead' }, [S.startLead]),
    !invite && window.top === window
      ? el('a', { class: 'solo-card', href: APP_URL + 'demo/' }, [
          el('b', {}, [S.startSolo]),
          el('span', {}, [S.startSoloSub]),
        ])
      : null,
    el('div', { class: 'start-form' }, [
      name,
      el('button', { class: 'btn btn-electric', onclick: submit }, [invite ? S.connectJoin : S.startOwn]),
    ]),
    el('p', { class: 'foot' }, [S.startFoot]),
  ])]
}

// ---------------------------------------------------------------------------
// web (rings / people)
// ---------------------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg'
const RADIUS: Record<Ring, number> = { [Ring.Close]: 72, [Ring.Friend]: 114, [Ring.Acquaintance]: 152, [Ring.Intending]: 168 }
const GRADS = [
  'linear-gradient(135deg,#FF715B,#9A37F0)', 'linear-gradient(135deg,#4FD7A0,#12A8E3)',
  'linear-gradient(135deg,#12A8E3,#9A37F0)', 'linear-gradient(135deg,#F2B544,#FF715B)',
  'linear-gradient(135deg,#9A37F0,#4FD7A0)',
]

function gradFor(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return GRADS[h % GRADS.length]
}

function avatar(name: string, id: string, cls = 'ava'): HTMLElement {
  const a = el('div', { class: cls }, [name.charAt(0).toUpperCase() || '?'])
  a.style.background = gradFor(id)
  return a
}

function ringsView(s: AppState, marks: Map<string, 'asked' | 'shared'> = new Map()): HTMLElement {
  const C = 176
  const wrap = el('div', { class: 'rings-wrap', title: S.webTapToAdd })
  wrap.addEventListener('click', (e) => onRingsTap(e as MouseEvent, wrap))
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 352 352')
  svg.innerHTML = '<defs><linearGradient id="th" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4FD7A0"/><stop offset="1" stop-color="#12A8E3"/></linearGradient></defs>'
  for (const r of RINGS) {
    const c = document.createElementNS(NS, 'circle')
    c.setAttribute('cx', String(C)); c.setAttribute('cy', String(C)); c.setAttribute('r', String(RADIUS[r]))
    c.setAttribute('fill', 'none'); c.setAttribute('stroke', 'rgba(154,55,240,.22)')
    c.setAttribute('stroke-width', r === Ring.Close ? '2.2' : r === Ring.Intending ? '1' : '1.4')
    c.setAttribute('stroke-dasharray', r === Ring.Intending ? '1 6' : r === Ring.Acquaintance ? '2 5' : r === Ring.Friend ? '6 4' : '')
    svg.appendChild(c)
  }
  wrap.appendChild(svg)
  for (const ring of RINGS) {
    const inRing = s.people.filter((p) => p.ring === ring)
    inRing.forEach((p, i) => {
      const deg = (360 / inRing.length) * i + (ring === Ring.Close ? 200 : ring === Ring.Friend ? 65 : ring === Ring.Acquaintance ? 30 : 10)
      const a = ((deg - 90) * Math.PI) / 180
      const x = C + RADIUS[ring] * Math.cos(a)
      const y = C + RADIUS[ring] * Math.sin(a)
      const path = document.createElementNS(NS, 'path')
      const mx = (C + x) / 2 + (y - C) * 0.12
      const my = (C + y) / 2 + (C - x) * 0.12
      path.setAttribute('d', `M${C} ${C} Q${mx} ${my} ${x} ${y}`)
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'url(#th)')
      path.setAttribute('stroke-width', ring === Ring.Close ? '2.6' : ring === Ring.Friend ? '1.8' : ring === Ring.Acquaintance ? '1.2' : '0.8')
      path.setAttribute('opacity', p.peerId ? '0.85' : '0.35')
      if (!p.peerId) path.setAttribute('stroke-dasharray', '3 4')
      svg.appendChild(path)
      const mark = p.peerId ? marks.get(p.peerId) : undefined
      const b = el('button', { class: 'node' + (mark ? ' ' + mark : ''), onclick: () => personSheet(p.id) }, [
        avatar(p.name, p.id),
        el('span', {}, [p.name]),
        el('em', { class: 'lvl' }, [S.ringLabel[p.ring]]),
      ])
      b.style.left = x + 'px'
      b.style.top = y + 'px'
      wrap.appendChild(b)
    })
  }
  const you = el('div', { class: 'node you' }, [avatar(s.me.displayName, s.me.id), el('span', {}, [s.me.displayName])])
  you.style.left = C + 'px'
  you.style.top = C + 'px'
  wrap.appendChild(you)
  return wrap
}

function peopleView(s: AppState, only?: Person[]): HTMLElement {
  const order = (r: Ring): number => RINGS.indexOf(r)
  const list = [...(only ?? s.people)].sort((a, b) => order(a.ring) - order(b.ring) || a.name.localeCompare(b.name))
  return el('div', { class: 'ppl' }, list.map((p) => el('button', { class: 'prow', onclick: () => personSheet(p.id) }, [
    avatar(p.name, p.id),
    el('div', { class: 'who' }, [
      el('b', {}, [p.name]),
      el('i', {}, [p.lines.filter((l) => l.status === LineStatus.Current).length + ' notes · ' + (p.peerId ? S.sheetConnected : S.sheetNotesOnly)]),
    ]),
    el('span', { class: 'shield ring-' + p.ring }, [S.ringLabel[p.ring]]),
  ])))
}

function notificationsCard(s: AppState): HTMLElement {
  const toggle = async (): Promise<void> => {
    if (!s.notificationsOn && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission)
      if (p !== 'granted') { toast(S.notifBlocked); return }
    }
    s.notificationsOn = !s.notificationsOn
    save()
    settingsSheet()
  }
  return el('div', { class: 'verse notif' }, [
    el('h3', {}, [s.notificationsOn ? S.notifOnTitle : S.notifTitle]),
    el('p', {}, [S.notifBody]),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => void toggle() }, [s.notificationsOn ? S.notifTurnOff : S.notifTurnOn]),
  ])
}

/** How each connected person shows on the rings while an ask is out or answered. */
function askMarks(): Map<string, 'asked' | 'shared'> {
  const marks = new Map<string, 'asked' | 'shared'>()
  const run = askRun
  if (!run) return marks
  if (!run.results) {
    for (const id of run.askedPeerIds) marks.set(id, 'asked')
    return marks
  }
  for (const r of run.results) if (r.decoded?.outcome === 'shared' && r.decoded.shared) marks.set(r.peerId, 'shared')
  return marks
}

function toggleSearch(): void {
  searchOpen = !searchOpen
  if (searchOpen) queryOpen = false
  else searchText = ''
  render()
  if (searchOpen) document.querySelector<HTMLInputElement>('.search-field')?.focus()
}

function matchesSearch(p: Person, q: string): boolean {
  const needle = q.trim().toLowerCase()
  return !needle || p.name.toLowerCase().includes(needle) || p.context.toLowerCase().includes(needle)
}

/** Search: contacts only, filtered live in place (a re-render would wipe the typing). */
function searchPanel(s: AppState): HTMLElement {
  const input = el('input', { class: 'field search-field', type: 'search', placeholder: S.searchPh, 'aria-label': S.searchPh, value: searchText, autocomplete: 'off' })
  const results = el('div', { id: 'search-results', 'aria-live': 'polite' })
  const fill = (): void => {
    const hits = s.people.filter((p) => matchesSearch(p, searchText))
    results.replaceChildren(hits.length ? peopleView(s, hits) : el('p', { class: 'empty' }, [S.searchNone]))
  }
  input.addEventListener('input', () => { searchText = input.value; fill() })
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') toggleSearch() })
  fill()
  const curate = el('button', { class: 'menu-item curate-row', onclick: () => go(Screen.Curate) })
  curate.innerHTML = icon('users')
  curate.append(el('span', {}, [el('b', {}, [S.searchCurate]), el('small', {}, [S.searchCurateSub])]))
  return el('div', { class: 'scroll pad search' }, [input, curate, results])
}

function screenWeb(): Node[] {
  const s = st()
  // Call style: a contact search top right (the magnifier is free). Query
  // style: the magnifier means querying, so the top shows the Curate list.
  const search = queryStyle() === QueryStyle.Call
    ? iconButton(searchOpen ? 'x' : 'search', searchOpen ? S.searchClose : S.searchOpen, toggleSearch, 'search-btn' + (searchOpen ? ' on' : ''))
    : ((): HTMLElement => {
        // "the list item like you had with Manage": icon plus label
        const b = el('button', { class: 'hdr-btn', onclick: () => go(Screen.Curate) })
        b.innerHTML = icon('list')
        b.append(S.curateTitle)
        return b
      })()
  if (searchOpen) return [header(S.webTitle, { right: search, more: true }), searchPanel(s)]
  return [
    header(S.webTitle, { right: search, more: true }),
    el('div', { class: 'scroll' }, [
      s.people.length === 0 ? el('p', { class: 'empty' }, [S.webEmpty]) : null,
      ringsView(s, askMarks()),
      isEphemeral() ? el('p', { class: 'warn' }, [S.storageEphemeral]) : null,
    ]),
    queryOpen ? queryDock(s) : queryFab(),
  ]
}

/**
 * Tap on empty space in the web: "Add someone to your web?". The ring is
 * preselected by how far from you the tap landed. Works while the rings are
 * scaled for the query dock, because it measures the rendered box.
 */
function onRingsTap(e: MouseEvent, wrap: HTMLElement): void {
  if ((e.target as HTMLElement).closest('.node')) return
  const box = wrap.getBoundingClientRect()
  const scale = box.width / RINGS_SIZE
  const dx = (e.clientX - box.left) / scale - RINGS_SIZE / 2
  const dy = (e.clientY - box.top) / scale - RINGS_SIZE / 2
  const dist = Math.hypot(dx, dy)
  const ring = RINGS.reduce((best, r) => (Math.abs(RADIUS[r] - dist) < Math.abs(RADIUS[best] - dist) ? r : best), Ring.Acquaintance)
  addPersonSheet(ring)
}

function addPersonSheet(ring: Ring): void {
  let picked = ring
  const name = el('input', { class: 'field', placeholder: S.addNamePh, maxlength: '40', 'aria-label': S.addNamePh })
  const where = el('input', { class: 'field', placeholder: S.recWherePh, maxlength: '80', 'aria-label': S.addWhere })
  const radios = el('div', { class: 'add-rings' })
  const drawRadios = (): void => {
    radios.replaceChildren(...RINGS.map((r) => el('button', {
      class: 'radio' + (picked === r ? ' on' : ''),
      onclick: () => { picked = r; drawRadios() },
    }, [el('b', {}, [S.ringLabel[r]]), el('small', {}, [S.ringHint[r]])])))
  }
  drawRadios()
  const add = (): void => {
    const n = name.value.trim()
    if (!n) { name.focus(); return }
    const s = st()
    s.people.push({ id: randomId(8), name: n.slice(0, 40), context: where.value.trim().slice(0, 80), ring: picked, metAt: Date.now(), lines: [] })
    save()
    closeSheet()
    toast(S.savedToast(n, S.ringLabel[picked]))
    render()
  }
  name.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') add() })
  openSheet([
    el('h3', {}, [S.addTitle]),
    el('p', { class: 'meta' }, [S.addLead]),
    name,
    where,
    radios,
    el('button', { class: 'btn btn-electric', onclick: add }, [S.addSave]),
    el('button', { class: 'btn btn-ghost', onclick: closeSheet }, [S.addCancel]),
  ])
  setTimeout(() => name.focus(), 320)
}

const RINGS_SIZE = 352

/**
 * While the query dock is open, shrink the rings to the space left above it,
 * so every person, and above all the ones who answer, stays in view: you
 * always see your web while you ask it. Runs after layout, on every Web
 * render and on resize.
 */
function fitRings(): void {
  const wrap = host.querySelector<HTMLElement>('.rings-wrap')
  const scroll = host.querySelector<HTMLElement>('.scroll')
  if (!wrap || !scroll) return
  if (!queryOpen) { wrap.style.transform = ''; wrap.style.marginBottom = ''; return }
  const top = wrap.offsetTop - scroll.offsetTop
  const room = scroll.clientHeight - top - 8
  const scale = Math.max(0.4, Math.min(1, room / RINGS_SIZE))
  wrap.style.transform = `scale(${scale})`
  wrap.style.marginBottom = `${-(1 - scale) * RINGS_SIZE}px`
  scroll.scrollTop = 0
}
window.addEventListener('resize', () => { if (screen === Screen.Web) fitRings() })

function queryFab(): HTMLElement {
  const call = queryStyle() === QueryStyle.Call
  const b = el('button', {
    class: 'query-fab' + (call ? ' call' : ''), 'aria-label': call ? S.webCall : S.webQuery,
    onclick: () => { queryOpen = true; searchOpen = false; render() },
  })
  b.innerHTML = icon(call ? 'call' : 'query')
  if (call) b.title = S.callHover
  b.append(call
    ? el('span', { class: 'fab-two' }, [el('span', {}, [S.webCallTop]), el('span', {}, [S.webCallBottom])])
    : el('span', {}, [S.webQuery]))
  return b
}

function screenCurate(): Node[] {
  const s = st()
  const add = el('button', { class: 'btn btn-ghost', onclick: () => addPersonSheet(Ring.Acquaintance) }, ['+ ' + S.curateAdd])
  return [
    header(S.curateTitle, { back: () => go(Screen.Web) }),
    el('div', { class: 'scroll' }, [
      el('p', { class: 'sub' }, [S.curateLead + ' ' + S.webCount(s.people.length, s.people.filter((p) => p.peerId).length)]),
      el('div', { class: 'manage-actions' }, [add]),
      s.people.length === 0 ? el('p', { class: 'empty' }, [S.curateEmpty]) : peopleView(s),
    ]),
  ]
}

function tagChip(tag: Tag, custom?: string): HTMLElement {
  return el('span', { class: 'tagpill tag-' + tag }, [tag === Tag.Custom && custom ? custom : S.tagLabel[tag]])
}

function personSheet(personId: string): void {
  const p = st().people.find((x) => x.id === personId)
  if (!p) return
  const current = p.lines.filter((l) => l.status === LineStatus.Current)
  const metaLine = p.ring === Ring.Intending ? S.sheetPlanned(p.context) : S.sheetMet(p.context, coarseWhen(p.metAt))
  openSheet([
    el('h3', {}, [p.name]),
    el('div', { class: 'meta' }, [S.ringLabel[p.ring] + ' · ' + metaLine]),
    el('div', { class: 'path' }, [p.peerId ? S.sheetConnected : S.sheetNotesOnly]),
    current.length
      ? el('div', { class: 'sheet-lines' }, current.map((l) => el('div', { class: 'sline' }, [
          tagChip(l.tag, l.customTag), el('span', {}, [l.text]), el('em', {}, [S.audienceLabel[l.audience]]),
        ])))
      : el('p', { class: 'meta' }, [S.sheetNoNotes]),
    current.length ? el('button', { class: 'btn btn-electric', onclick: () => startReview(p.id) }, [S.sheetStillTrue]) : null,
    el('button', { class: 'btn btn-ghost', onclick: () => startDraftFor(p.id) }, [S.sheetAddNote]),
    el('button', { class: 'btn btn-ghost', onclick: () => ringSheet(p) }, [S.sheetChangeRing]),
    channelsView(personChannels(p), { title: S.chTitle, add: S.chAddOther, hint: S.chHint }),
  ])
}

/** Where a set of messenger handles lives: a person's card, or my own contact info. */
interface ChannelOwner {
  get(): Partial<Record<Channel, string>>
  set(ch: Channel, value: string | null): void
}

function personChannels(p: Person): ChannelOwner {
  return {
    get: () => p.channels ?? {},
    set: (ch, value) => {
      const next = { ...(p.channels ?? {}) }
      if (value) next[ch] = value; else delete next[ch]
      p.channels = next
      save()
    },
  }
}

function myChannels(): ChannelOwner {
  return {
    get: () => st().myChannels ?? {},
    set: (ch, value) => {
      const s = st()
      const next = { ...(s.myChannels ?? {}) }
      if (value) next[ch] = value; else delete next[ch]
      s.myChannels = next
      save()
    },
  }
}

/**
 * Contact info, collapsed (owner 2026-10-05): the messengers already known
 * show as "Open in ..." links; "Add other ways to contact them" expands the
 * full list, in the owner's order. Kept on this phone.
 */
function channelsView(owner: ChannelOwner, labels: { title: string; add: string; hint: string }): HTMLElement {
  const box = el('div', { class: 'channels' })
  let expanded = false
  const draw = (edit?: Channel): void => {
    const known = owner.get()
    const shown = expanded || edit ? CHANNELS : CHANNELS.filter((ch) => known[ch])
    box.replaceChildren(
      el('h4', { class: 'eyebrow' }, [labels.title]),
      ...shown.map((ch) => channelRow(owner, ch, edit === ch, (next) => draw(next))),
      expanded || edit
        ? el('p', { class: 'meta' }, [labels.hint])
        : el('button', { class: 'btn btn-ghost btn-sm ch-more', 'aria-expanded': 'false', onclick: () => { expanded = true; draw() } }, ['+ ' + labels.add]),
    )
  }
  draw()
  return box
}

function channelRow(owner: ChannelOwner, ch: Channel, edit: boolean, redraw: (edit?: Channel) => void): HTMLElement {
  const value = owner.get()[ch]
  const label = el('span', { class: 'ch-name ch-' + ch }, [S.chLabel[ch]])
  if (edit) {
    const input = el('input', { class: 'field', placeholder: S.chPh[ch], value: value ?? '', 'aria-label': S.chPh[ch], autocomplete: 'off' })
    const msg = el('p', { class: 'meta ch-msg' })
    const saveIt = (): void => {
      if (!input.value.trim()) { owner.set(ch, null); redraw(); return }
      const v = normalizeHandle(ch, input.value)
      if (!v) { msg.textContent = S.chInvalid[ch]; input.focus(); return }
      owner.set(ch, v)
      redraw()
    }
    input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') saveIt() })
    setTimeout(() => input.focus(), 0)
    return el('div', { class: 'ch-row editing' }, [
      label, input, msg,
      el('div', { class: 'rec-saves' }, [
        el('button', { class: 'btn btn-electric btn-sm', onclick: saveIt }, [S.chSave]),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => redraw() }, [S.chCancel]),
      ]),
    ])
  }
  if (!value) {
    return el('div', { class: 'ch-row' }, [label, el('button', { class: 'mini', onclick: () => redraw(ch) }, ['+ ' + S.chAdd])])
  }
  return el('div', { class: 'ch-row' }, [
    label,
    el('a', { class: 'ch-open', href: channelLink(ch, value), target: '_blank', rel: 'noopener noreferrer' }, [S.chOpen(S.chLabel[ch])]),
    el('button', { class: 'mini', 'aria-label': S.chEdit(S.chLabel[ch]), onclick: () => redraw(ch) }, [S.chEditShort]),
  ])
}

function ringSheet(p: Person): void {
  openSheet([
    el('h3', {}, [S.sheetRingPick(p.name)]),
    ...RINGS.map((r) => el('button', {
      class: 'radio' + (p.ring === r ? ' on' : ''),
      onclick: () => {
        p.ring = r
        const peer = st().peers.find((x) => x.id === p.peerId)
        if (peer) peer.ring = r
        save()
        personSheet(p.id)
        render()
      },
    }, [el('b', {}, [S.ringLabel[r]]), el('small', {}, [S.ringHint[r]])])),
  ])
}

// ---------------------------------------------------------------------------
// record: the raised middle tab. Solo by default, laid out like Tana mobile's
// voice memo: circle and clock, an "About" row where Tana shows Destination,
// then discard / pause / send. Top right: Meeting.
// ---------------------------------------------------------------------------

function startTicker(): void {
  clearInterval(recTicker)
  recTicker = setInterval(() => {
    const t = document.getElementById('rec-clock')
    if (t) t.textContent = clock(totalMs() + recorder.elapsed())
  }, 250)
}

function dropRecording(): void {
  recorder.discard()
  void transcriber?.stop()
  transcriber = null
  endLiveExtras()
  takes = []
  recNotice = ''
}

/** Everything that only lives while a take is open. */
function endLiveExtras(): void {
  clearInterval(recTicker)
  void wakeLock?.release().catch(() => {})
  wakeLock = null
}

/** Every take lands here, whether the owner stopped it or the system did. */
function onTake(take: Recording, expected: boolean): void {
  takes.push(take)
  endLiveExtras()
  if (!expected) {
    recNotice = S.recInterrupted
    transcriber?.pause()
  }
  updateStatusPill()
  if (screen === Screen.Record || screen === Screen.Meeting || !expected) render()
}

async function keepScreenOn(): Promise<void> {
  wakeLock = await navigator.wakeLock?.request('screen').catch(() => null) ?? null
}

// A wake lock is dropped whenever the page is hidden; take it again on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && recorder.live && !recorder.paused) void keepScreenOn()
})

/** Starts a take. Meetings need the other person's yes first. */
async function startRecording(): Promise<boolean> {
  if (draft.mode === RecordMode.Meeting && !draft.consent) { recNotice = S.recNeedsConsent; render(); return false }
  const support = recorderSupport()
  if (support !== RecorderSupport.Ready) {
    recNotice = support === RecorderSupport.NeedsSecurePage ? S.recInsecure : S.recUnavailable
    render()
    return false
  }
  try {
    await recorder.start(onTake)
  } catch {
    recNotice = S.recDenied
    render()
    return false
  }
  recNotice = ''
  startTicker()
  void keepScreenOn()
  render()
  return true
}

function togglePause(): void {
  if (!recorder.live) return
  if (recorder.paused) {
    recorder.resume()
    transcriber?.resume()
    void keepScreenOn()
  } else {
    recorder.pause()
    transcriber?.pause()
    void wakeLock?.release().catch(() => {})
    wakeLock = null
  }
  render()
}

function totalMs(): number {
  return takes.reduce((sum, t) => sum + t.durationMs, 0)
}

function saveAudio(r: Recording): void {
  const a = el('a', {
    href: URL.createObjectURL(r.blob),
    download: `trustweb-${(draft.name.trim() || 'meeting').replace(/[^\w-]+/g, '_')}-${new Date(r.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${audioExtension(r.mimeType)}`,
  })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

function saveButtons(cls: string): HTMLElement[] {
  return takes.map((t, i) => el('button', { class: cls, onclick: () => saveAudio(t) }, [
    takes.length > 1 ? `${S.trSave} ${i + 1} (${clock(t.durationMs)})` : `${S.trSave} (${clock(t.durationMs)})`,
  ]))
}

function roundButton(name: string, label: string, onclick: () => void, opts: { disabled?: boolean; cls?: string } = {}): HTMLElement {
  const b = el('button', { class: 'round' + (opts.cls ? ' ' + opts.cls : ''), 'aria-label': label, title: label, disabled: Boolean(opts.disabled), onclick })
  b.innerHTML = icon(name)
  return b
}

/** "Who was this about?": an existing person or a new name. Then `next`. */
function aboutSheet(next?: () => void): void {
  const input = el('input', { class: 'field', placeholder: S.recWhoPh, value: draft.name, maxlength: '40', 'aria-label': S.aboutTitle })
  const done = (): void => {
    const v = input.value.trim()
    if (!v) { input.focus(); return }
    const match = st().people.find((p) => p.name.toLowerCase() === v.toLowerCase())
    draft.name = match?.name ?? v
    draft.personId = match?.id
    if (match) draft.ring = match.ring
    closeSheet()
    if (next) next(); else render()
  }
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') done() })
  const people = [...st().people].sort((a, b) => b.metAt - a.metAt).slice(0, 6)
  openSheet([
    el('h3', {}, [S.aboutTitle]),
    input,
    people.length ? el('div', { class: 'chips' }, people.map((p) => el('button', {
      class: 'chip', onclick: () => { input.value = p.name; done() },
    }, [p.name]))) : null,
    el('button', { class: 'btn btn-electric', onclick: done }, [S.aboutOk]),
  ])
  setTimeout(() => input.focus(), 320)
}

function discardDraft(): void {
  if (draftInProgress() && !confirm(S.recDiscardConfirm)) return
  newDraft()
  render()
}

/** Solo is transcription too, like Tana's voice memo: same engine as a meeting, one speaker. */
async function startSolo(): Promise<void> {
  if (!(await startRecording())) return
  speaker = 1
  await startTranscriber()
  render()
}

async function sendSolo(): Promise<void> {
  if (recorder.live) await recorder.stop()
  if (!takes.length) return
  if (!draft.name.trim()) { aboutSheet(() => void makeNotes()); return }
  await makeNotes()
}

function screenRecord(): Node[] {
  const live = recorder.live
  const paused = recorder.paused
  const meeting = el('button', { class: 'hdr-btn', onclick: () => { if (!live) { draft.mode = RecordMode.Meeting; recNotice = ''; go(Screen.Meeting) } else toast(S.recSwitchWhileLive) } })
  meeting.innerHTML = icon('handshake')
  meeting.append(S.recMeeting)
  const has = takes.length > 0
  const circle = el('button', {
    class: 'rec-circle' + (live && !paused ? ' live' : '') + (paused ? ' paused' : ''),
    'aria-label': live ? (paused ? S.recResume : S.recPause) : S.recStart,
    onclick: () => { if (live) togglePause(); else void startSolo() },
  })
  const status = live ? (paused ? S.recPausedHint : S.recLive) : has ? S.recDone(clock(totalMs()), takes.length) : S.recIdle
  return [
    header(S.recTitle, { right: meeting, qr: false }),
    el('div', { class: 'scroll pad memo' }, [
      el('div', { class: 'memo-hero' }, [
        circle,
        el('span', { class: 'rec-clock', id: 'rec-clock' }, [clock(totalMs() + recorder.elapsed())]),
      ]),
      el('p', { class: 'rec-status center' }, [status]),
      recNotice ? el('p', { class: 'warn' }, [recNotice]) : null,
      el('button', { class: 'memo-row', onclick: () => aboutSheet() }, [
        el('span', {}, [S.aboutRow]),
        el('b', {}, [draft.name.trim() || S.aboutNobody]),
      ]),
      engine !== null && (live || has) ? el('p', { class: 'tr-engine center' }, [engineLabel()]) : null,
      draft.segments.length || transcriber
        ? el('div', { class: 'tr-list memo-tr', id: 'tr-list', 'aria-live': 'polite' },
            draft.segments.length ? draft.segments.map(transcriptRow) : [el('p', { class: 'tr-empty' }, [S.trEmpty])])
        : el('p', { class: 'hint center' }, [S.recSoloHint]),
    ]),
    el('div', { class: 'memo-controls' }, [
      roundButton('x', S.recDiscard, discardDraft, { disabled: !live && !has && !draft.name.trim() }),
      roundButton(paused || !live ? 'play' : 'pause', paused || !live ? (live ? S.recResume : S.recStart) : S.recPause,
        () => { if (live) togglePause(); else void startSolo() }, { cls: 'main' }),
      roundButton('send', S.recSend, () => void sendSolo(), { disabled: !live && !has }),
    ]),
  ]
}

/*
 * PARKED 2026-10-05 (owner: "comment out what we have right now"): the
 * earlier Record screen with who/where, points to cover that stay editable
 * after ticking, and a notes field. Who/where and consent moved to the
 * Meeting view; points and notes wait here until a view wants them back.
 *
 * function pointsView(): HTMLElement {
 *   const add = el('input', { class: 'field', placeholder: S.recPointPh, maxlength: '120' })
 *   ... draft.points rows: checkbox (pt.done) + editable text, an "Add" row
 * }
 * Record body (old): rec-hero mic, Just me / Shared segment, consent row,
 *   who, where, pointsView(), notes textarea, "Start over".
 */

// ---------------------------------------------------------------------------
// meeting: who and where, consent, the speaker transcript (Tana-style), and
// an active-transcribing switch. TalkWeave transcribes on a desktop where it
// runs; on a phone, on-device speech or nothing ("transcribed later").
// ---------------------------------------------------------------------------

async function ensureEngine(): Promise<TranscriberEngine> {
  engine ??= await detectEngine().catch(() => TranscriberEngine.None)
  return engine
}

function onSegment(seg: Segment): void {
  const i = draft.segments.findIndex((x) => x.id === seg.id)
  if (i >= 0) draft.segments[i] = seg; else draft.segments.push(seg)
  if (screen !== Screen.Meeting && screen !== Screen.Record) return
  const list = document.getElementById('tr-list')
  if (!list) return
  const row = transcriptRow(seg)
  const old = list.querySelector(`[data-seg="${CSS.escape(seg.id)}"]`)
  if (old) old.replaceWith(row); else list.append(row)
  list.querySelector('.tr-empty')?.remove()
  row.scrollIntoView({ block: 'nearest' })
}

async function startTranscriber(): Promise<void> {
  if (!transcribing) return
  const eng = await ensureEngine()
  if (eng === TranscriberEngine.None) return
  const t = createTranscriber(eng)
  t.onSegment(onSegment)
  t.onStatus((st) => { if (st === TranscriberStatus.Error || st === TranscriberStatus.Offline) recNotice = S.trOffline })
  t.setSpeaker(speaker)
  try {
    await t.start()
    transcriber = t
  } catch {
    recNotice = S.trOffline
  }
}

async function startMeeting(): Promise<void> {
  if (!(await startRecording())) return
  await startTranscriber()
  render()
}

async function toggleTranscribing(): Promise<void> {
  transcribing = !transcribing
  if (!transcribing) { await transcriber?.stop(); transcriber = null }
  else if (recorder.live) await startTranscriber()
  render()
}

function setSpeaker(n: number): void {
  speaker = n
  transcriber?.setSpeaker(n)
  render()
}

async function endMeeting(): Promise<void> {
  if (recorder.live) await recorder.stop()
  await transcriber?.stop()
  transcriber = null
  render()
  endMeetingSheet()
}

function meetingText(): string {
  return meetingToText({ who: draft.name.trim(), where: draft.context.trim(), startedAt: takes[0]?.startedAt ?? Date.now() }, draft.segments)
}

async function sendAsIs(): Promise<void> {
  const text = meetingText()
  const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> }
  if (nav.share) {
    try { await nav.share({ title: S.meetingShareTitle(draft.name.trim() || 'meeting'), text }); return } catch { /* cancelled: fall through to copy */ }
  }
  await navigator.clipboard?.writeText(text).then(() => toast(S.meetingCopied), () => toast(S.meetingCopyFailed))
}

/** End meeting: send it as it is, or meet the other person (QR with these notes), or make notes. */
function endMeetingSheet(): void {
  const name = draft.name.trim() || S.meetingThem
  const notes = meetingToNoteText(draft.segments) || draft.text.trim()
  openSheet([
    el('h3', {}, [S.meetingEnded]),
    el('p', { class: 'meta' }, [S.meetingEndedLead]),
    el('button', { class: 'btn btn-electric', onclick: () => void sendAsIs() }, [S.meetingSendAsIs]),
    el('button', { class: 'btn btn-teal', onclick: () => openMeet(Screen.Meeting, notes) }, [S.meetingMeet(name)]),
    el('button', { class: 'btn btn-ghost', onclick: () => void makeNotes() }, [S.recMake]),
    takes.length ? el('div', { class: 'rec-saves' }, saveButtons('btn btn-ghost btn-sm')) : null,
    el('p', { class: 'meta' }, [S.meetingSendHonest]),
  ])
}

function transcriptRow(seg: Segment): HTMLElement {
  return el('div', { class: 'tr-row' + (seg.final ? '' : ' interim'), 'data-seg': seg.id }, [
    el('span', { class: 'tr-dot', 'aria-hidden': 'true' }),
    el('div', { class: 'tr-body' }, [
      el('p', {}, [seg.text]),
      el('div', { class: 'tr-meta' }, [el('span', {}, [S.speaker(seg.speaker)]), el('span', {}, [clockLong(seg.atMs)])]),
    ]),
  ])
}

/** "00:00:17", like Tana's transcript. */
function clockLong(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

function engineLabel(): string {
  if (!transcribing) return S.trOff
  switch (engine) {
    case TranscriberEngine.TalkWeave: return S.trTalkWeave
    case TranscriberEngine.OnDevice: return S.trOnDevice
    case TranscriberEngine.None: return S.trLater
    default: return S.trChecking
  }
}

function screenMeeting(): Node[] {
  // The engine is probed on the Start tap only, never on render: the on-device
  // check (SpeechRecognition.available) has crashed headless Chromium's
  // renderer outright, and a screen must never take the app down with it.
  const live = recorder.live
  const paused = recorder.paused
  const name = draft.name.trim()
  const who = el('input', { class: 'field', placeholder: S.recWhoPh, value: draft.name, 'aria-label': S.recWho, maxlength: '40' })
  const where = el('input', { class: 'field', placeholder: S.recWherePh, value: draft.context, 'aria-label': S.recWhere, maxlength: '80' })
  const consentText = el('span', {}, [S.recConsent(name || S.meetingThey)])
  who.addEventListener('input', () => { draft.name = who.value; consentText.textContent = S.recConsent(draft.name.trim() || S.meetingThey) })
  where.addEventListener('input', () => { draft.context = where.value })
  const consentBox = el('input', { type: 'checkbox', id: 'consent' })
  consentBox.checked = draft.consent
  consentBox.addEventListener('change', () => { draft.consent = consentBox.checked; if (draft.consent && recNotice === S.recNeedsConsent) { recNotice = ''; render() } })
  const infoHint = el('p', { class: 'info-hint', hidden: true }, [S.recInfoHint])
  const info = el('button', { class: 'info', 'aria-label': S.recInfo, onclick: (e: Event) => { e.preventDefault(); infoHint.hidden = !infoHint.hidden } })
  info.innerHTML = icon('info')

  const mic = el('button', {
    class: 'rec-circle small' + (live && !paused ? ' live' : '') + (paused ? ' paused' : ''),
    'aria-label': live ? (paused ? S.recResume : S.recPause) : S.recStart,
    onclick: () => { if (live) togglePause(); else void startMeeting() },
  })
  mic.innerHTML = icon(live && !paused ? 'pause' : 'mic')
  const trToggle = el('button', {
    class: 'tr-toggle' + (transcribing ? ' on' : ''), role: 'switch', 'aria-checked': String(transcribing),
    onclick: () => void toggleTranscribing(),
  }, [el('span', { class: 'tr-led', 'aria-hidden': 'true' }), S.trToggle])
  const speakers = el('div', { class: 'speakers', role: 'group', 'aria-label': S.speakerPick }, [1, 2, 3].map((n) => el('button', {
    class: 'chip' + (speaker === n ? ' on' : ''), 'aria-pressed': String(speaker === n), onclick: () => setSpeaker(n),
  }, [S.speaker(n)])))

  return [
    header(S.meetingTitle, {
      back: () => { if (live) { toast(S.recSwitchWhileLive); return } draft.mode = RecordMode.Solo; go(Screen.Record) },
      qr: false,
    }),
    el('div', { class: 'scroll pad' }, [
      el('label', { class: 'lbl' }, [S.recWho]), who,
      el('label', { class: 'lbl' }, [S.recWhere]), where,
      el('div', { class: 'consent-row' }, [el('label', { class: 'consent' }, [consentBox, consentText]), info]),
      infoHint,
      el('div', { class: 'meeting-bar' }, [
        mic,
        el('div', { class: 'meeting-clock' }, [
          el('span', { class: 'rec-clock', id: 'rec-clock' }, [clock(totalMs() + recorder.elapsed())]),
          el('small', {}, [live ? (paused ? S.recPausedHint : S.recLiveMeeting) : S.recIdleMeeting]),
        ]),
        trToggle,
      ]),
      el('p', { class: 'tr-engine' }, [engineLabel()]),
      recNotice ? el('p', { class: 'warn' }, [recNotice]) : null,
      speakers,
      el('div', { class: 'tr-list', id: 'tr-list', 'aria-live': 'polite' },
        draft.segments.length ? draft.segments.map(transcriptRow) : [el('p', { class: 'tr-empty' }, [transcribing ? S.trEmpty : S.trOffHint])]),
    ]),
    el('div', { class: 'cta' }, [el('button', {
      class: 'btn btn-teal', disabled: !live && !takes.length, onclick: () => void endMeeting(),
    }, [S.meetingEnd])]),
  ]
}

async function makeNotes(): Promise<void> {
  if (!draft.name.trim()) { aboutSheet(() => void makeNotes()); return }
  if (recorder.live) await recorder.stop()
  await transcriber?.stop()
  transcriber = null
  if (!draft.lines.length) {
    const prose = [meetingToNoteText(draft.segments), draft.text].filter((t) => t.trim()).join('. ')
    draft.lines = extractLines(prose).map((l) => ({ id: randomId(8), text: l.text, tag: l.tag, audience: Audience.Friends }))
    // Nothing transcribed here: keep the memo itself as a line, so saving
    // never dead-ends; the audio is transcribed later on the computer.
    if (!draft.lines.length && takes.length) {
      draft.lines = [{ id: randomId(8), text: S.memoLine(clock(totalMs())), tag: Tag.Note, audience: Audience.OnlyMe }]
    }
  }
  go(Screen.Review)
}

// ---------------------------------------------------------------------------
// meet: this phone's code (QR), NFC where the browser can, a link to copy
// ---------------------------------------------------------------------------

/** The pages of Meet: the TrustWeb code first, then my Signal code, then my Matrix code once set. */
enum MeetPage {
  TrustWeb = 'trustweb',
  Signal = 'signal',
  Matrix = 'matrix',
}

let meetPage: MeetPage = MeetPage.TrustWeb

function meetPages(): MeetPage[] {
  // Tana, 2026-08-24: "on the same page that one shows one's QR code, one should
  // also show one's Signal code, and once that is ready, one's Matrix code."
  const mine = st().myChannels ?? {}
  return [MeetPage.TrustWeb, MeetPage.Signal, ...(mine[Channel.Matrix] ? [MeetPage.Matrix] : [])]
}

function openMeet(from: Screen, notes = ''): void {
  meetFrom = from
  meetNotes = notes
  meetPage = MeetPage.TrustWeb
  go(Screen.Meet)
}

function screenMeet(): Node[] {
  const name = meetFrom === Screen.Meeting ? draft.name.trim() : ''
  const pages = meetPages()
  if (!pages.includes(meetPage)) meetPage = MeetPage.TrustWeb
  const tabs = el('div', { class: 'seg meet-tabs', role: 'tablist', 'aria-label': S.meetPagesLabel }, pages.map((pg) => el('button', {
    class: meetPage === pg ? 'on' : '', role: 'tab', 'aria-selected': String(meetPage === pg),
    onclick: () => { meetPage = pg; render() },
  }, [S.meetPage[pg]])))
  const body = meetPage === MeetPage.TrustWeb ? meetTrustWebPage() : meetMessengerPage(meetPage === MeetPage.Signal ? Channel.Signal : Channel.Matrix)
  // Swipe between the pages, like a second page under the QR code.
  let startX = 0
  body.addEventListener('pointerdown', (e) => { startX = e.clientX })
  body.addEventListener('pointerup', (e) => {
    const dx = e.clientX - startX
    if (Math.abs(dx) < 60) return
    const k = pages.indexOf(meetPage) + (dx < 0 ? 1 : -1)
    if (k >= 0 && k < pages.length) { meetPage = pages[k]; render() }
  })
  return [
    header(name ? S.meetTitleWith(name) : S.meetTitle, { back: () => go(meetFrom), qr: false }),
    el('div', { class: 'scroll pad' }, [tabs, body]),
  ]
}

function meetTrustWebPage(): HTMLElement {
  const notes = meetNotes
  const qr = el('div', { class: 'qrwrap' })
  const nfcStatus = el('p', { class: 'meta' }, [nfcWriteSupported() ? '' : S.meetNfcOff])
  let link = ''
  const copy = el('button', {
    class: 'btn btn-ghost', disabled: true,
    onclick: () => { void navigator.clipboard?.writeText(link).then(() => toast(S.meetCopied), () => toast(link)) },
  }, [S.meetCopy])
  const nfc = nfcWriteSupported()
    ? el('button', {
        class: 'btn btn-ghost', disabled: true,
        onclick: () => {
          nfcStatus.textContent = S.meetNfcWaiting
          writeLinkToTag(link).then(() => { nfcStatus.textContent = S.meetNfcDone }, () => { nfcStatus.textContent = S.meetNfcFailed })
        },
      }, [S.meetNfcWrite])
    : null
  void (async () => {
    await net.start()
    link = net.connectLink(APP_URL)
    if (notes) link += '#n=' + encodeURIComponent(notes.slice(0, 300))
    qr.setAttribute('data-payload', link)
    await renderQr(qr, link)
    copy.removeAttribute('disabled')
    nfc?.removeAttribute('disabled')
  })()
  return el('div', { class: 'meet-page' }, [
    el('p', { class: 'hint' }, [S.meetLead]),
    qr,
    el('dl', { class: 'qr-facts' }, [
      el('dt', {}, [S.meetRing]), el('dd', {}, [S.meetRingValue]),
      el('dt', {}, [S.meetShared]), el('dd', {}, [notes ? S.meetSharedValue : S.meetSharedNoNotes]),
    ]),
    notes ? el('blockquote', { class: 'shared-notes' }, [notes.slice(0, 300)]) : null,
    copy,
    el('h4', { class: 'eyebrow' }, [S.meetNfc]),
    nfc,
    nfcStatus,
    el('p', { class: 'meta center' }, [S.meetSwipe]),
  ])
}

/** My own Signal (or Matrix) code, so they can also reach me there; or a field to add it. */
function meetMessengerPage(ch: Channel): HTMLElement {
  const mine = st().myChannels ?? {}
  const value = mine[ch]
  if (!value) {
    return el('div', { class: 'meet-page' }, [
      el('p', { class: 'hint' }, [S.meetAddMine(S.chLabel[ch])]),
      singleChannelEditor(ch, () => render()),
      el('p', { class: 'meta' }, [S.meetMineHint]),
    ])
  }
  const link = channelLink(ch, value)
  const qr = el('div', { class: 'qrwrap', 'data-payload': link })
  void renderQr(qr, link)
  return el('div', { class: 'meet-page' }, [
    el('p', { class: 'hint' }, [S.meetMineLead(S.chLabel[ch])]),
    qr,
    el('a', { class: 'btn btn-ghost', href: link, target: '_blank', rel: 'noopener noreferrer' }, [S.chOpen(S.chLabel[ch])]),
    el('button', { class: 'btn btn-ghost', onclick: () => editMineSheet(ch) }, [S.meetChangeMine(S.chLabel[ch])]),
    ch === Channel.Signal && /^\+/.test(value) ? el('p', { class: 'meta' }, [S.meetSignalNumberNote]) : null,
  ])
}

/** One of my own channels, straight in edit mode; `done` runs after save or cancel. */
function singleChannelEditor(ch: Channel, done: () => void): HTMLElement {
  return channelRow(myChannels(), ch, true, () => done())
}

function editMineSheet(ch: Channel): void {
  openSheet([
    el('h3', {}, [S.meetYour(S.chLabel[ch])]),
    singleChannelEditor(ch, () => { closeSheet(); render() }),
    el('p', { class: 'meta' }, [S.meetMineHint]),
  ])
}

// ---------------------------------------------------------------------------
// meet: step 2, review and tag
// ---------------------------------------------------------------------------

function tagPicker(line: DraftLine): void {
  const custom = el('input', { class: 'field', placeholder: S.tagCustomPh, value: line.customTag ?? '', maxlength: '24' })
  openSheet([
    el('h3', {}, [S.tagPickTitle]),
    el('div', { class: 'tag-grid' }, TAGS.filter((t) => t !== Tag.Custom).map((t) => el('button', {
      class: 'tagpick tag-' + t + (line.tag === t ? ' on' : ''),
      onclick: () => { line.tag = t; line.customTag = undefined; closeSheet(); render() },
    }, [S.tagLabel[t]]))),
    custom,
    el('button', {
      class: 'btn btn-electric',
      onclick: () => {
        const v = custom.value.trim()
        if (!v) { custom.focus(); return }
        line.tag = Tag.Custom
        line.customTag = v
        closeSheet()
        render()
      },
    }, [S.tagCustomOk]),
  ])
}

function longPress(target: HTMLElement, onLong: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = (): void => { clearTimeout(timer); timer = undefined }
  target.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return
    cancel()
    timer = setTimeout(() => { timer = undefined; navigator.vibrate?.(15); onLong() }, 500)
  })
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'pointermove']) {
    target.addEventListener(ev, (e) => {
      if (ev === 'pointermove' && Math.hypot((e as PointerEvent).movementX, (e as PointerEvent).movementY) < 4) return
      cancel()
    })
  }
  target.addEventListener('contextmenu', (e) => { e.preventDefault(); onLong() })
}

/** The audio for the debrief: save it before the notes are saved, which drops TrustWeb's copy. */
function recordingCard(): HTMLElement {
  return el('div', { class: 'rec-card' }, [
    el('b', {}, [S.reviewRecording(clock(totalMs()), takes.length)]),
    el('p', {}, [S.reviewRecordingSub]),
    el('div', { class: 'rec-saves' }, saveButtons('btn btn-electric btn-sm')),
  ])
}

function screenReview(): Node[] {
  const rows = draft.lines.map((line) => {
    const input = el('textarea', { class: 'line-text', rows: '2', 'aria-label': S.tagLabel[line.tag] })
    input.value = line.text
    input.addEventListener('input', () => { line.text = input.value })
    const row = el('div', { class: 'line-card' }, [
      el('div', { class: 'line-head' }, [
        el('button', { class: 'tagbtn', onclick: () => tagPicker(line) }, [tagChip(line.tag, line.customTag)]),
        el('button', { class: 'x', 'aria-label': S.remove, onclick: () => { draft.lines = draft.lines.filter((l) => l !== line); render() } }, ['×']),
      ]),
      input,
    ])
    longPress(row, () => tagPicker(line))
    return row
  })
  return [
    header(S.reviewTitle(draft.name.trim()), { back: () => { draft.lines = []; go(recordScreen()) } }),
    el('div', { class: 'scroll pad' }, [
      takes.length ? recordingCard() : null,
      el('p', { class: 'hint' }, [S.reviewLead]),
      rows.length ? el('div', { class: 'lines' }, rows) : el('p', { class: 'empty' }, [S.reviewEmpty]),
      el('button', {
        class: 'btn btn-ghost',
        onclick: () => { draft.lines.push({ id: randomId(8), text: '', tag: Tag.Note, audience: Audience.Friends }); render() },
      }, ['+ ' + S.reviewAdd]),
      el('p', { class: 'foot' }, [S.reviewFoot]),
    ]),
    el('div', { class: 'cta' }, [el('button', {
      class: 'btn btn-teal',
      onclick: () => {
        draft.lines = draft.lines.filter((l) => l.text.trim())
        if (!draft.lines.length) { render(); return }
        go(Screen.Place)
      },
    }, [S.reviewOk])]),
  ]
}

// ---------------------------------------------------------------------------
// meet: step 3, place in a ring, choose who can ask
// ---------------------------------------------------------------------------

function nextAudience(a: Audience): Audience {
  return AUDIENCES[(AUDIENCES.indexOf(a) + 1) % AUDIENCES.length]
}

function audiencePill(current: Audience, onChange: (a: Audience) => void): HTMLElement {
  return el('button', {
    class: 'aud aud-' + current,
    title: 'Tap to change',
    onclick: () => onChange(nextAudience(current)),
  }, [S.audienceLabel[current]])
}

function saveDraft(): void {
  const s = st()
  const now = Date.now()
  let p = draft.personId ? s.people.find((x) => x.id === draft.personId) : undefined
  p ??= s.people.find((x) => x.name.toLowerCase() === draft.name.trim().toLowerCase())
  if (!p) {
    p = { id: randomId(8), name: draft.name.trim(), context: draft.context.trim(), ring: draft.ring, metAt: now, lines: [] }
    s.people.push(p)
  }
  p.ring = draft.ring
  if (draft.context.trim()) p.context = draft.context.trim()
  const peer = s.peers.find((x) => x.id === p.peerId)
  if (peer) peer.ring = draft.ring
  for (const l of draft.lines) {
    p.lines.push({
      id: l.id, text: l.text.trim(), tag: l.tag, customTag: l.customTag, audience: l.audience,
      status: LineStatus.Current, notedAt: now, checkedAt: now,
    })
  }
  save()
  toast(S.savedToast(p.name, S.ringLabel[p.ring]))
  newDraft()
  go(Screen.Web)
}

function screenPlace(): Node[] {
  return [
    header(S.placeTitle(draft.name.trim()), { back: () => go(Screen.Review) }),
    el('div', { class: 'scroll pad' }, [
      ...RINGS.map((r) => el('button', {
        class: 'radio' + (draft.ring === r ? ' on' : ''),
        onclick: () => { draft.ring = r; render() },
      }, [el('b', {}, [S.ringLabel[r]]), el('small', {}, [S.ringHint[r]])])),
      el('h4', { class: 'eyebrow' }, [S.placeWho]),
      el('div', { class: 'aud-list' }, draft.lines.map((l) => el('div', { class: 'aud-row' }, [
        el('span', {}, [l.text]),
        audiencePill(l.audience, (a) => { l.audience = a; render() }),
      ]))),
      el('p', { class: 'foot' }, [S.placeFoot]),
    ]),
    el('div', { class: 'cta' }, [el('button', { class: 'btn btn-teal', onclick: saveDraft }, [S.placeSave])]),
  ]
}

// ---------------------------------------------------------------------------
// step 4: still true?
// ---------------------------------------------------------------------------

function startReview(personId: string): void {
  review = { personId, verdict: new Map(), edits: new Map() }
  go(Screen.StillTrue)
}

function screenStillTrue(): Node[] {
  const r = review
  const p = r ? st().people.find((x) => x.id === r.personId) : undefined
  if (!r || !p) { screen = Screen.Web; return screenWeb() }
  const now = Date.now()
  const cards = p.lines.filter((l) => l.status === LineStatus.Current).map((l: NoteLine) => {
    const v = r.verdict.get(l.id)
    const choice = (value: 'true' | 'changed' | 'gone', label: string): HTMLElement => el('button', {
      class: 'choice' + (v === value ? ' on' : ''),
      onclick: () => { r.verdict.set(l.id, value); render() },
    }, [label])
    const text = v === 'changed'
      ? (() => {
          const t = el('textarea', { class: 'line-text', rows: '2' })
          t.value = r.edits.get(l.id) ?? l.text
          t.addEventListener('input', () => r.edits.set(l.id, t.value))
          return t
        })()
      : el('p', { class: v === 'gone' ? 'gone' : '' }, [l.text])
    return el('div', { class: 'still-card' + (v === 'changed' ? ' changed' : '') }, [
      el('div', { class: 'line-head' }, [el('small', {}, [S.stillNoted(ageLabel(l.notedAt, now))]), tagChip(l.tag, l.customTag)]),
      text,
      el('div', { class: 'choices' }, [choice('true', S.stillTrue), choice('changed', S.stillChanged), choice('gone', S.stillGone)]),
    ])
  })
  const apply = (): void => {
    for (const l of p.lines) {
      const v = r.verdict.get(l.id)
      if (v === 'true') l.checkedAt = now
      if (v === 'gone') { l.status = LineStatus.Gone; l.checkedAt = now }
      if (v === 'changed') {
        const t = (r.edits.get(l.id) ?? l.text).trim()
        if (t) { l.text = t; l.notedAt = now; l.checkedAt = now }
      }
    }
    save()
    review = null
    toast(S.stillToast)
    go(Screen.Web)
  }
  return [
    header(S.stillTitle, { back: () => { review = null; go(Screen.Web) } }),
    el('div', { class: 'scroll pad' }, [
      el('div', { class: 'still-head' }, [avatar(p.name, p.id), el('div', {}, [
        el('b', {}, [p.name + ' · ' + S.ringLabel[p.ring]]),
        el('small', {}, [p.context]),
      ])]),
      ...cards,
    ]),
    el('div', { class: 'cta' }, [el('button', { class: 'btn btn-teal', onclick: apply }, [S.stillUpdate])]),
  ]
}

// ---------------------------------------------------------------------------
// inventory (+ the local log)
// ---------------------------------------------------------------------------

function settingsSheet(): void {
  const s = st()
  const order = s.tabOrder ?? TabOrder.WebLeft
  const pick = (o: TabOrder, label: string): HTMLElement => el('button', {
    class: 'radio' + (order === o ? ' on' : ''),
    onclick: () => { s.tabOrder = o; save(); renderTabs(); render(); settingsSheet() },
  }, [el('b', {}, [label])])
  openSheet([
    el('h3', {}, [S.setTitle]),
    el('h4', { class: 'eyebrow' }, [S.setTabs]),
    pick(TabOrder.WebLeft, S.setTabsWebLeft),
    pick(TabOrder.InventoryLeft, S.setTabsInvLeft),
    el('p', { class: 'meta' }, [S.setTabsHint]),
    channelsView(myChannels(), { title: S.myTitle, add: S.myAdd, hint: S.myHint }),
    el('h4', { class: 'eyebrow' }, [S.setQuery]),
    ...[QueryStyle.Call, QueryStyle.Search].map((q) => el('button', {
      class: 'radio' + (queryStyle() === q ? ' on' : ''),
      onclick: () => { s.queryStyle = q; searchOpen = false; save(); render(); settingsSheet() },
    }, [el('b', {}, [S.setQueryLabel[q]]), el('small', {}, [S.setQueryHint[q]])])),
    notificationsCard(s),
    solo ? null : el('button', {
      class: 'btn btn-ghost',
      onclick: () => { if (confirm(S.resetConfirm)) { dropRecording(); clearState(persona, storeCtx); location.reload() } },
    }, [S.resetPhone]),
  ])
}

// ---------------------------------------------------------------------------
// backup: the whole phone record, end-to-end encrypted, to a Swiss server
// (questhub, Infomaniak). The key is made on this phone (or derived from a
// passphrase the person chooses) and never sent; the server only ever sees
// ciphertext. backup.ts holds the crypto; this is the UI around it.
// ---------------------------------------------------------------------------

interface BackupInfo { keyText: string; fromPassphrase: boolean; lastAt: number; lastBytes: number }

function backupStoreKey(): string {
  return `trustweb.backup.${persona}${storeCtx ? '.' + storeCtx : ''}`
}

function loadBackupInfo(): BackupInfo | null {
  try {
    const raw = localStorage.getItem(backupStoreKey())
    return raw ? JSON.parse(raw) as BackupInfo : null
  } catch { return null }
}

function saveBackupInfo(info: BackupInfo | null): void {
  try {
    if (info) localStorage.setItem(backupStoreKey(), JSON.stringify(info))
    else localStorage.removeItem(backupStoreKey())
  } catch { /* storage blocked: the backup still works this visit */ }
}

async function runBackup(key: BackupKey): Promise<void> {
  try {
    const r = await backupNow(key, st())
    saveBackupInfo({ keyText: key.text, fromPassphrase: key.fromPassphrase, lastAt: r.at, lastBytes: r.bytes })
    toast(S.bkDone(Math.max(1, Math.round(r.bytes / 1024))))
  } catch {
    toast(S.bkFailed)
  }
  if (screen === Screen.Inventory) render()
}

/** Shows a fresh recovery key; the backup only runs after "I saved it". */
function recoveryKeySheet(key: BackupKey): void {
  const saved = el('input', { type: 'checkbox', id: 'bk-saved' })
  const go2 = el('button', { class: 'btn btn-electric', disabled: true, onclick: () => { closeSheet(); void runBackup(key) } }, [S.bkBackUpNow])
  saved.addEventListener('change', () => { if (saved.checked) go2.removeAttribute('disabled'); else go2.setAttribute('disabled', '') })
  const download = (): void => {
    const a = el('a', { href: URL.createObjectURL(new Blob([S.bkKeyFile(key.text)], { type: 'text/plain' })), download: 'trustweb-recovery-key.txt' })
    document.body.append(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }
  openSheet([
    el('h3', {}, [S.bkKeyTitle]),
    el('p', { class: 'meta' }, [key.fromPassphrase ? S.bkKeyLeadPass : S.bkKeyLead]),
    el('code', { class: 'recovery-key' }, [key.text]),
    el('div', { class: 'rec-saves' }, [
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { void navigator.clipboard?.writeText(key.text).then(() => toast(S.bkCopied), () => toast(S.meetingCopyFailed)) } }, [S.bkCopy]),
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
  openSheet([el('h3', {}, [S.bkPassTitle]), msg, pass, el('button', { class: 'btn btn-electric', onclick: () => void ok() }, [S.bkPassOk])])
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
      const data = await restore(key) as Partial<AppState> | null
      if (!data || data.v !== 1 || !data.me) { msg.textContent = S.bkBadData; return }
      if (!confirm(S.bkRestoreConfirm)) return
      state = data as AppState
      save()
      saveBackupInfo({ keyText: key.text, fromPassphrase: key.fromPassphrase, lastAt: Date.now(), lastBytes: 0 })
      location.reload()
    } catch (e) {
      msg.textContent = e instanceof BackupNotFound ? S.bkNotFound : S.bkFailed
    }
  }
  openSheet([el('h3', {}, [S.bkRestoreTitle]), msg, input, el('button', { class: 'btn btn-electric', onclick: () => void run() }, [S.bkRestoreOk])])
}

// The card only shows where the backup service answers: a static deploy
// without it must not offer a backup that can only fail.
let backupAvailable: boolean | null = null

let backupProbe: Promise<void> | null = null

/**
 * Probed once. When the answer arrives it fills the card's slot in place, never
 * a full re-render: that would wipe whatever is being typed on the screen.
 */
function probeBackup(): Promise<void> {
  backupProbe ??= (async (): Promise<void> => {
    try {
      const r = await fetch('/backup/health', { cache: 'no-store' })
      backupAvailable = r.ok && (await r.text()).trim() === 'ok'
    } catch {
      backupAvailable = false
    }
    const slot = document.getElementById('backup-slot')
    if (slot) slot.replaceChildren(...[backupCardInner()].filter((c): c is HTMLElement => c !== null))
  })()
  return backupProbe
}

function backupCard(): HTMLElement {
  if (backupAvailable === null) void probeBackup()
  const inner = backupCardInner()
  return el('div', { id: 'backup-slot' }, inner ? [inner] : [])
}

function backupCardInner(): HTMLElement | null {
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
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { if (confirm(S.bkForgetConfirm)) { saveBackupInfo(null); render() } } }, [S.bkForget]),
  ])
}

function screenInventory(): Node[] {
  const s = st()
  const input = el('input', { class: 'field', placeholder: S.invAddPh, maxlength: '160', 'aria-label': S.invAddPh })
  const add = (): void => {
    const v = input.value.trim()
    if (!v) { input.focus(); return }
    s.inventory.unshift({ id: randomId(8), text: v, audience: Audience.FriendsOfFriends, included: true, createdAt: Date.now() })
    save()
    render()
  }
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') add() })
  const gear = el('button', { class: 'hdr-btn icon-only', 'aria-label': S.invSettings, title: S.invSettings, onclick: settingsSheet })
  gear.innerHTML = icon('settings')
  return [
    header(S.invTitle, { right: gear }),
    el('div', { class: 'scroll pad' }, [
      el('p', { class: 'hint' }, [S.invLead]),
      el('div', { class: 'add-row' }, [input, el('button', { class: 'btn btn-electric btn-sm', onclick: add }, [S.invAdd])]),
      s.inventory.length === 0 ? el('p', { class: 'empty' }, [S.invEmpty]) : null,
      ...s.inventory.map((item) => el('div', { class: 'inv' + (item.included ? '' : ' off') }, [
        el('span', { class: 'inv-text' }, [item.text]),
        el('div', { class: 'inv-actions' }, [
          audiencePill(item.audience, (a) => { item.audience = a; save(); render() }),
          el('button', { class: 'mini', onclick: () => { item.included = !item.included; save(); render() } }, [item.included ? S.invOn : S.invOff]),
          el('button', { class: 'x', 'aria-label': S.remove, onclick: () => { s.inventory = s.inventory.filter((x) => x !== item); save(); render() } }, ['×']),
        ]),
      ])),
      el('h4', { class: 'eyebrow' }, [S.logTitle]),
      s.log.length === 0 ? el('p', { class: 'empty' }, [S.logEmpty]) : null,
      ...s.log.slice(0, 12).map((e) => el('div', { class: 'log' }, [
        el('b', {}, [e.from + ': ']), el('span', {}, ['"' + e.text + '"']),
        el('em', {}, [S.logOutcome[e.outcome]]),
      ])),
      el('p', { class: 'foot' }, [S.logFoot]),
      backupCard(),
    ]),
  ]
}

// ---------------------------------------------------------------------------
// query: a dock on the Web screen, under the rings, so the web stays in view
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  'Does anyone have a motorbike I could borrow?',
  'Who is hiring?',
  'Any new animal welfare funding?',
  'Who has a spare room in Vienna?',
]

let countdownTimer: ReturnType<typeof setInterval> | undefined

function secondsLeft(startedAt: number): number {
  return Math.max(0, Math.ceil((startedAt + ANSWER_WINDOW_MS - Date.now()) / 1000))
}

async function runAsk(text: string): Promise<void> {
  const t = text.trim()
  if (!t) return
  const peers = st().peers
  askRun = { text: t, asked: peers.length, askedPeerIds: peers.map((p) => p.id), startedAt: Date.now(), results: null }
  clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    const w = document.getElementById('tw-wait')
    if (w && askRun && !askRun.results) w.textContent = ' ' + S.queryWaiting(secondsLeft(askRun.startedAt))
  }, 1000)
  render()
  const results = await net.ask(t)
  clearInterval(countdownTimer)
  if (askRun && askRun.text === t) askRun.results = results
  if (screen === Screen.Web) render()
}

function resultsView(results: AskResult[]): HTMLElement[] {
  const shared = results.filter((r) => r.decoded?.outcome === 'shared' && r.decoded.shared)
  if (!shared.length) {
    return [el('div', { class: 'outcome nothing' }, [el('b', {}, [S.resultNothing]), el('span', {}, [S.resultNothingSub])])]
  }
  return shared.map((r) => el('div', { class: 'outcome shared' }, [
    el('b', {}, [S.resultShared(r.decoded?.shared?.from || r.peerName)]),
    ...(r.decoded?.shared?.items ?? []).map((it) => el('div', { class: 'shared-item' }, [
      el('span', {}, [it.text]), el('small', {}, [it.context + ' · ' + it.when]),
    ])),
  ]))
}

function queryDock(s: AppState): HTMLElement {
  const box = el('textarea', { class: 'field', rows: '2', placeholder: S.queryPh, maxlength: '200', 'aria-label': S.queryTitle })
  box.value = queryText
  box.addEventListener('input', () => { queryText = box.value })
  const busy = Boolean(askRun && !askRun.results)
  const run = askRun
  const inFlight = run
    ? el('div', { class: 'card asked' }, [
        el('p', { class: 'q' }, ['"' + run.text + '"']),
        el('p', {}, [S.queryAsked(run.asked)]),
        el('p', { class: 'hint' }, [S.queryWindow]),
        run.results
          ? el('div', {}, resultsView(run.results))
          : el('p', { class: 'wait' }, [el('span', { class: 'spin' }), el('span', { id: 'tw-wait' }, [' ' + S.queryWaiting(secondsLeft(run.startedAt))])]),
      ])
    : null
  return el('section', { class: 'query-dock', 'aria-label': S.queryTitle }, [
    el('div', { class: 'dock-head' }, [
      el('h3', {}, [queryStyle() === QueryStyle.Call ? S.webCall : S.queryTitle]),
      el('button', { class: 'x', 'aria-label': S.queryClose, onclick: () => { queryOpen = false; render() } }, ['×']),
    ]),
    el('div', { class: 'dock-body' }, [
      run ? null : el('p', { class: 'hint' }, [S.queryLead]),
      s.peers.length === 0 ? el('p', { class: 'warn' }, [S.queryNoPeers]) : null,
      box,
      run ? null : el('div', { class: 'chips' }, [
        el('span', { class: 'chips-lbl' }, [S.queryTry]),
        ...SUGGESTIONS.map((q) => el('button', { class: 'chip', onclick: () => { queryText = q; render() } }, [q])),
      ]),
      el('button', {
        class: 'btn btn-electric wide', disabled: busy || s.peers.length === 0,
        onclick: () => void runAsk(queryText),
      }, [S.querySend]),
      inFlight,
    ]),
  ])
}

// ---------------------------------------------------------------------------
// the consent prompt, shown wherever the person is
// ---------------------------------------------------------------------------

function showNextAsk(): void {
  askShowing = askQueue.shift() ?? null
  askDecision = null
  renderAsk()
}

function renderAsk(): void {
  const a = askShowing
  if (!a) { overlay.classList.remove('on'); overlay.replaceChildren(); return }
  overlay.classList.add('on')
  const decided = askDecision
  clear(overlay)
  overlay.append(
    el('div', { class: 'orb orb1' }), el('div', { class: 'orb orb2' }),
    el('div', { class: 'ask' }, [
      el('span', { class: 'eyebrow' }, [S.askEyebrow]),
      el('h2', {}, [S.askFrom(a.fromName)]),
      el('p', { class: 'ask-q' }, ['"' + a.text + '"']),
      decided === null
        ? el('div', {}, [
            el('p', { class: 'ask-lbl' }, [S.askMatches]),
            ...a.matches.map((m) => el('div', { class: 'ask-line' }, [el('span', {}, [m.text]), el('small', {}, [m.context])])),
            el('button', { class: 'btn btn-mint', onclick: () => decide(true) }, [S.askShare]),
            el('button', { class: 'btn btn-ghost', onclick: () => decide(false) }, [S.askDecline]),
            el('p', { class: 'ask-foot' }, [S.askFoot(a.fromName)]),
          ])
        : el('div', {}, [
            el('p', { class: 'ask-done' }, [decided ? S.askSent : S.askNotSent]),
            el('p', { class: 'ask-foot' }, [S.askSentSub]),
            el('button', { class: 'btn btn-ghost', onclick: showNextAsk }, [S.askClose]),
          ]),
    ]),
  )
}

function decide(share: boolean): void {
  const a = askShowing
  if (!a || askDecision !== null) return
  askDecision = share
  renderAsk()
  void a.decide(share)
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

render()
if (state) {
  void net.start().then(announceLink)
  void completePendingConnect()
}
