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
 * ask it. Web's Manage (top right) lists the connections; Meet (QR, NFC) is
 * reached from there and offered after a shared recording. No chat, no
 * unread badges, notifications off by default.
 */
import './styles.css'
import { el, clear } from '../../demo/src/ui/dom'
import { renderQr } from '../../demo/src/ui/qr'
import { parseConnectLinkParams } from '../../demo/src/connect_link'
import { randomId } from '../../demo/src/crypto'
import { ANSWER_WINDOW_MS, Net } from './net'
import type { AskResult, IncomingAsk, RelayStatus } from './net'
import {
  AUDIENCES, Audience, LineStatus, RINGS, Ring, TAGS, TabOrder, Tag, ageLabel, coarseWhen,
} from './model'
import type { AppState, NoteLine, Person } from './model'
import { extractLines, guessTag } from './notes'
import { S } from './strings'
import { clearState, isEphemeral, loadState, saveState } from './store'
import { DemoContext, Persona, isDemoContext, seedState } from './seed'
import { VoiceSupport, installVoice, startDictation, voiceApiPresent, voiceSupport } from './speech'
import { MeetingRecorder, RecorderSupport, audioExtension, clock, recorderSupport } from './recorder'
import type { Recording } from './recorder'
import { nfcWriteSupported, writeLinkToTag } from './nfc'

enum Screen {
  Start = 'start',
  Web = 'web',
  Manage = 'manage',
  Inventory = 'inventory',
  Record = 'record',
  Meet = 'meet',
  Review = 'review',
  Place = 'place',
  StillTrue = 'still',
}

/** Recording by myself is the default; a shared recording needs the other person's yes. */
enum RecordMode {
  Solo = 'solo',
  Shared = 'shared',
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
  /** Only meaningful for a shared recording: the other person agreed. */
  consent: boolean
  points: Point[]
  /** Live on-device transcript phrases, if the owner turned that on. */
  transcript: string[]
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
const persona: string = personaParam === Persona.Holder || personaParam === Persona.Seeker ? personaParam : 'me'
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
if (!state && solo) {
  state = seedState(persona as Persona, Date.now(), ctx)
  saveState(persona, state, storeCtx)
}

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
let queryText = ''
let askRun: {
  text: string; asked: number; askedPeerIds: string[]; startedAt: number; results: AskResult[] | null
} | null = null
const askQueue: IncomingAsk[] = []
let askShowing: IncomingAsk | null = null
let askDecision: boolean | null = null
// Where Meet's back arrow returns to (Manage, Record, or Web).
let meetFrom: Screen = Screen.Manage
// The recording belongs to the current draft; it is dropped with it.
const recorder = new MeetingRecorder()
// Every take of the current draft, oldest first: a new take never overwrites one.
let takes: Recording[] = []
let recNotice = ''
let recTicker: ReturnType<typeof setInterval> | undefined
let wakeLock: WakeLockSentinel | null = null
let stopDictation: (() => void) | null = null
// Meet shares the current draft's notes only when opened from that draft
// (after a shared recording), never from Manage: notes about one person must
// not ride into the code shown to the next.
let meetNotes = ''

function freshDraft(personId?: string): Draft {
  const p = personId ? state?.people.find((x) => x.id === personId) : undefined
  return {
    personId, name: p?.name ?? '', context: p?.context ?? '', text: '',
    mode: RecordMode.Solo, consent: false, points: [], transcript: [], lines: [],
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
const sheet = el('div', { class: 'sheet', role: 'dialog' })
const overlay = el('div', { class: 'overlay cosmic', role: 'alertdialog' })
const toastEl = el('div', { class: 'toast', role: 'status' })
let statusPill: HTMLElement | null = null
phone.append(host, tabs, veil, sheet, overlay, toastEl)
root.replaceChildren(phone)

const ICONS: Record<string, string> = {
  web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="7" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="10.5" stroke-dasharray="2 3"/></svg>',
  inventory: '<svg viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  query: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
}

function tabButton(target: Screen, label: string, icon: string): HTMLElement {
  const b = el('button', { class: 'tab', 'data-go': target, onclick: () => go(target) })
  b.innerHTML = ICONS[icon]
  b.append(label)
  return b
}

function recordButton(): HTMLElement {
  const b = el('button', { class: 'tab-record', 'data-go': Screen.Record, 'aria-label': S.navRecord, onclick: onRecordTap })
  b.innerHTML = ICONS.mic
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

function onRecordTap(): void {
  // The Record tab never wipes a draft in progress (notes, points, audio);
  // it only starts fresh when nothing is in flight.
  if (!draftInProgress()) newDraft()
  go(Screen.Record)
}

/**
 * A new note never silently replaces one in progress (a live recording is one
 * tap away from here via the pill): it returns to that draft instead, where
 * "Start over" is the one deliberate way to drop it.
 */
function startDraftFor(personId?: string): void {
  if (draftInProgress()) {
    toast(S.recBusy)
    go(Screen.Record)
    return
  }
  newDraft(personId)
  go(Screen.Record)
}

function draftInProgress(): boolean {
  return recorder.live || takes.length > 0 || Boolean(draft.name.trim() || draft.text.trim() || draft.points.length || draft.lines.length)
}

function go(s: Screen): void {
  screen = s
  closeSheet()
  render()
}

function header(title: string, opts: { back?: () => void; right?: Node | null } = {}): HTMLElement {
  statusPill = el('button', { class: 'status-pill', onclick: () => { if (recorder.live) go(Screen.Record) } })
  updateStatusPill()
  return el('div', { class: 'hdr' }, [
    el('div', { class: 'hdr-left' }, [
      opts.back ? el('button', { class: 'back', 'aria-label': S.back, onclick: opts.back }, ['‹']) : null,
      el('h2', {}, [title]),
    ]),
    el('div', { class: 'hdr-right' }, [opts.right ?? null, statusPill]),
  ])
}

/**
 * The top-right pill. Idle: a quiet dot that only carries the relay state in
 * its label (no "Online" text, owner 2026-10-05). Recording: "Recording
 * meeting", on every screen, and tapping it returns to the recording.
 */
function updateStatusPill(): void {
  if (!statusPill) return
  if (recorder.live) {
    statusPill.className = 'status-pill rec'
    statusPill.textContent = S.statusRecording
    statusPill.removeAttribute('aria-label')
    statusPill.removeAttribute('title')
    statusPill.removeAttribute('tabindex')
    return
  }
  const label = relayStatus === 'connected' ? S.statusConnected
    : relayStatus === 'connecting' ? S.statusConnecting : S.statusDisconnected
  statusPill.className = 'status-pill dot ' + relayStatus
  statusPill.textContent = ''
  statusPill.title = label
  statusPill.setAttribute('aria-label', label)
  statusPill.setAttribute('tabindex', '-1')
}

function render(): void {
  const showTabs = screen !== Screen.Start
  tabs.style.display = showTabs ? 'flex' : 'none'
  tabs.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => {
    const target = b.getAttribute('data-go')
    const on = target === screen
      || (target === Screen.Record && (screen === Screen.Review || screen === Screen.Place || screen === Screen.Meet))
      || (target === Screen.Web && (screen === Screen.StillTrue || screen === Screen.Manage))
    b.classList.toggle('on', on)
  })
  tabs.querySelector('.tab-record')?.classList.toggle('live', recorder.live)
  host.className = 'screen on ' + screen + (screen === Screen.Web && queryOpen ? ' querying' : '')
  const body = (() => {
    switch (screen) {
      case Screen.Start: return screenStart()
      case Screen.Web: return screenWeb()
      case Screen.Manage: return screenManage()
      case Screen.Inventory: return screenInventory()
      case Screen.Record: return screenRecord()
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
  veil.classList.add('on')
}

function closeSheet(): void {
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
  state = {
    v: 1, me: { id: randomId(12), displayName: name.trim().slice(0, 40) },
    peers: [], people: [], inventory: [], log: [], notificationsOn: false,
  }
  save()
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
  const name = el('input', { class: 'field', placeholder: S.yourName, autocomplete: 'given-name', maxlength: '40', 'aria-label': S.yourName })
  const submit = (): void => {
    if (!name.value.trim()) { name.focus(); return }
    createMe(name.value)
    screen = Screen.Web
    render()
    void net.start()
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
  const wrap = el('div', { class: 'rings-wrap' })
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

function peopleView(s: AppState): HTMLElement {
  const order = (r: Ring): number => RINGS.indexOf(r)
  const list = [...s.people].sort((a, b) => order(a.ring) - order(b.ring) || a.name.localeCompare(b.name))
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

function screenWeb(): Node[] {
  const s = st()
  const connected = s.people.filter((p) => p.peerId).length
  const manage = el('button', { class: 'hdr-btn', onclick: () => go(Screen.Manage) })
  manage.innerHTML = ICONS.list
  manage.append(S.webManage)
  return [
    header(S.webTitle, { right: manage }),
    el('div', { class: 'scroll' }, [
      el('p', { class: 'sub' }, [S.webWelcome + ' ' + S.webCount(s.people.length, connected)]),
      s.people.length === 0 ? el('p', { class: 'empty' }, [S.webEmpty]) : null,
      ringsView(s, askMarks()),
      queryOpen ? null : el('p', { class: 'web-cap' }, [S.webCap]),
      isEphemeral() ? el('p', { class: 'warn' }, [S.storageEphemeral]) : null,
    ]),
    queryOpen ? queryDock(s) : queryFab(),
  ]
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
  const b = el('button', { class: 'query-fab', onclick: () => { queryOpen = true; render() } })
  b.innerHTML = ICONS.query
  b.append(S.webQuery)
  return b
}

function screenManage(): Node[] {
  const s = st()
  const connect = el('button', { class: 'btn btn-electric', onclick: () => openMeet(Screen.Manage) }, [S.manageConnect])
  const add = el('button', { class: 'btn btn-ghost', onclick: () => startDraftFor() }, ['+ ' + S.manageAddPerson])
  return [
    header(S.manageTitle, { back: () => go(Screen.Web) }),
    el('div', { class: 'scroll' }, [
      el('p', { class: 'sub' }, [S.manageLead + ' ' + S.webCount(s.people.length, s.people.filter((p) => p.peerId).length)]),
      el('div', { class: 'manage-actions' }, [connect, add]),
      s.people.length === 0 ? el('p', { class: 'empty' }, [S.manageEmpty]) : peopleView(s),
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
// record: the raised middle tab. Mic at the top, then who/where, points to
// cover and notes, all usable while the recording runs.
// ---------------------------------------------------------------------------

function startTicker(): void {
  clearInterval(recTicker)
  recTicker = setInterval(() => {
    const t = document.getElementById('rec-clock')
    if (t) t.textContent = clock(recorder.elapsed())
  }, 500)
}

function dropRecording(): void {
  recorder.discard()
  endLiveExtras()
  takes = []
  recNotice = ''
}

/** Everything that only lives while a take is running. */
function endLiveExtras(): void {
  clearInterval(recTicker)
  stopDictation?.()
  void wakeLock?.release().catch(() => {})
  wakeLock = null
}

/** Every take lands here, whether the owner stopped it or the system did. */
function onTake(take: Recording, expected: boolean): void {
  takes.push(take)
  endLiveExtras()
  if (!expected) recNotice = S.recInterrupted
  updateStatusPill()
  if (screen === Screen.Record || !expected) render()
}

async function toggleRecording(): Promise<void> {
  if (recorder.live) { await stopRecording(); return }
  if (draft.mode === RecordMode.Shared && !draft.consent) { recNotice = S.recNeedsConsent; render(); return }
  const support = recorderSupport()
  if (support !== RecorderSupport.Ready) {
    recNotice = support === RecorderSupport.NeedsSecurePage ? S.recInsecure : S.recUnavailable
    render()
    return
  }
  try {
    await recorder.start(onTake)
  } catch {
    recNotice = S.recDenied
    render()
    return
  }
  recNotice = ''
  startTicker()
  // Keep the screen on: a phone that locks mid-meeting ends the recording.
  wakeLock = await navigator.wakeLock?.request('screen').catch(() => null) ?? null
  render()
}

async function stopRecording(): Promise<void> {
  await recorder.stop()
  if (draft.mode === RecordMode.Shared && screen === Screen.Record) connectPrompt()
}

/** After a shared recording: offer the connection, the same Meet flow. */
function connectPrompt(): void {
  const name = draft.name.trim() || 'them'
  openSheet([
    el('h3', {}, [S.recConnectTitle(name)]),
    el('p', { class: 'meta' }, [S.recConnectLead]),
    el('button', { class: 'btn btn-electric', onclick: () => openMeet(Screen.Record, draft.text.trim()) }, [S.recConnectYes]),
    el('button', { class: 'btn btn-ghost', onclick: closeSheet }, [S.recConnectLater]),
  ])
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

async function toggleLiveTranscript(): Promise<void> {
  if (stopDictation) { stopDictation(); transcriptSheet(); return }
  const v = voiceApiPresent() ? await voiceSupport() : VoiceSupport.Unavailable
  if (v === VoiceSupport.Unavailable || (v === VoiceSupport.NeedsDownload && !(await installVoice()))) {
    toast(S.trLiveUnavailable)
    return
  }
  stopDictation = startDictation((phrase) => {
    draft.transcript.push(phrase)
    const list = document.getElementById('tr-lines')
    if (list) list.append(el('p', {}, [phrase]))
  }, () => { stopDictation = null })
  transcriptSheet()
}

/** Top right of Record: the local transcript and the audio file for later transcription. */
function saveButtons(cls: string): HTMLElement[] {
  return takes.map((t, i) => el('button', { class: cls, onclick: () => saveAudio(t) }, [
    takes.length > 1 ? `${S.trSave} ${i + 1} (${clock(t.durationMs)})` : `${S.trSave} (${clock(t.durationMs)})`,
  ]))
}

function transcriptSheet(): void {
  openSheet([
    el('h3', {}, [S.trTitle]),
    el('p', { class: 'meta' }, [S.trLead]),
    ...saveButtons('btn btn-electric'),
    takes.length ? null : el('p', { class: 'meta' }, [recorder.live ? S.recLive : S.trNone]),
    voiceApiPresent()
      ? el('button', { class: 'btn btn-ghost', onclick: () => void toggleLiveTranscript() }, [stopDictation ? S.trLiveStop : S.trLive])
      : el('p', { class: 'meta' }, [S.trLiveUnavailable]),
    stopDictation ? el('p', { class: 'meta' }, [S.trLiveOn]) : null,
    el('div', { class: 'tr-lines', id: 'tr-lines' },
      draft.transcript.length ? draft.transcript.map((t) => el('p', {}, [t])) : [el('p', { class: 'meta' }, [S.trEmpty])]),
  ])
}

function pointsView(): HTMLElement {
  const add = el('input', { class: 'field', placeholder: S.recPointPh, maxlength: '120', 'aria-label': S.recPointPh })
  const addPoint = (): void => {
    const v = add.value.trim()
    if (!v) { add.focus(); return }
    draft.points.push({ id: randomId(8), text: v, done: false })
    render()
    document.querySelector<HTMLInputElement>('.points .add-row input')?.focus()
  }
  add.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') addPoint() })
  return el('div', { class: 'points' }, [
    ...draft.points.map((pt) => {
      const box = el('input', { type: 'checkbox', 'aria-label': S.recPointDone })
      box.checked = pt.done
      const text = el('input', { class: 'point-text', value: pt.text, maxlength: '120', 'aria-label': S.recPoints })
      // Checking a point off never locks it: it stays editable (owner, 2026-10-05).
      box.addEventListener('change', () => { pt.done = box.checked; row.classList.toggle('done', pt.done) })
      text.addEventListener('input', () => { pt.text = text.value })
      const row = el('label', { class: 'point' + (pt.done ? ' done' : '') }, [box, text])
      return row
    }),
    el('div', { class: 'add-row' }, [add, el('button', { class: 'btn btn-electric btn-sm', onclick: addPoint }, [S.recPointAdd])]),
  ])
}

function screenRecord(): Node[] {
  const live = recorder.live
  const who = el('input', { class: 'field', placeholder: S.recWhoPh, value: draft.name, 'aria-label': S.recWho, maxlength: '40' })
  const where = el('input', { class: 'field', placeholder: S.recWherePh, value: draft.context, 'aria-label': S.recWhere, maxlength: '80' })
  const notes = el('textarea', { class: 'field note', placeholder: S.recNotesPh, rows: '5', 'aria-label': S.recNotes })
  notes.value = draft.text
  const consentText = el('span', {}, [S.recConsent(draft.name.trim() || 'They')])
  who.addEventListener('input', () => { draft.name = who.value; consentText.textContent = S.recConsent(draft.name.trim() || 'They') })
  where.addEventListener('input', () => { draft.context = where.value })
  notes.addEventListener('input', () => { draft.text = notes.value })

  const mic = el('button', {
    class: 'rec-mic' + (live ? ' live' : ''),
    'aria-label': live ? S.recStop : S.recStart,
    onclick: () => void toggleRecording(),
  })
  mic.innerHTML = live ? ICONS.stop : ICONS.mic
  const status = live ? S.recLive : takes.length ? S.recDone(clock(totalMs()), takes.length) : S.recIdle

  const mode = (m: RecordMode, label: string): HTMLElement => el('button', {
    class: draft.mode === m ? 'on' : '',
    disabled: live,
    onclick: () => { draft.mode = m; recNotice = ''; render() },
  }, [label])

  const consentBox = el('input', { type: 'checkbox', id: 'consent' })
  consentBox.checked = draft.consent
  consentBox.addEventListener('change', () => { draft.consent = consentBox.checked; if (draft.consent) { recNotice = ''; render() } })
  const infoHint = el('p', { class: 'info-hint', hidden: true }, [S.recInfoHint])
  const info = el('button', { class: 'info', 'aria-label': S.recInfo, onclick: (e: Event) => { e.preventDefault(); infoHint.hidden = !infoHint.hidden } })
  info.innerHTML = ICONS.info

  const transcriptBtn = el('button', { class: 'hdr-btn', onclick: transcriptSheet })
  transcriptBtn.innerHTML = ICONS.doc
  transcriptBtn.append(S.recTranscript)

  return [
    header(S.recTitle, { right: transcriptBtn }),
    el('div', { class: 'scroll pad' }, [
      el('div', { class: 'rec-hero' }, [
        mic,
        live || takes.length ? el('span', { class: 'rec-clock', id: 'rec-clock' }, [clock(live ? recorder.elapsed() : totalMs())]) : null,
        el('p', { class: 'rec-status' }, [status]),
        recNotice ? el('p', { class: 'warn' }, [recNotice]) : null,
      ]),
      el('div', { class: 'seg rec-mode' }, [mode(RecordMode.Solo, S.recModeSolo), mode(RecordMode.Shared, S.recModeShared)]),
      draft.mode === RecordMode.Shared
        ? el('div', {}, [
            el('div', { class: 'consent-row' }, [el('label', { class: 'consent' }, [consentBox, consentText]), info]),
            infoHint,
          ])
        : el('p', { class: 'hint' }, [S.recSoloHint]),
      el('label', { class: 'lbl' }, [S.recWho]), who,
      el('label', { class: 'lbl' }, [S.recWhere]), where,
      el('label', { class: 'lbl' }, [S.recPoints]), pointsView(),
      el('label', { class: 'lbl' }, [S.recNotes]), notes,
      draftInProgress() && !live
        ? el('button', {
            class: 'btn btn-ghost btn-sm start-over',
            onclick: () => { if (confirm(S.recStartOverConfirm)) { newDraft(); render() } },
          }, [S.recStartOver])
        : null,
    ]),
    el('div', { class: 'cta' }, [el('button', { class: 'btn btn-teal', onclick: () => void makeNotes() }, [S.recMake])]),
  ]
}

async function makeNotes(): Promise<void> {
  if (!draft.name.trim()) { document.querySelector<HTMLInputElement>(`input[aria-label="${S.recWho}"]`)?.focus(); return }
  if (recorder.live) await recorder.stop()
  stopDictation?.()
  if (!draft.lines.length) {
    const fromNotes = extractLines(draft.text)
    const fromPoints = draft.points.filter((p) => p.text.trim()).map((p) => ({ text: p.text.trim(), tag: guessTag(p.text) }))
    draft.lines = [...fromPoints, ...fromNotes].map((l) => ({ id: randomId(8), text: l.text, tag: l.tag, audience: Audience.Friends }))
  }
  go(Screen.Review)
}

// ---------------------------------------------------------------------------
// meet: this phone's code (QR), NFC where the browser can, a link to copy
// ---------------------------------------------------------------------------

function openMeet(from: Screen, notes = ''): void {
  meetFrom = from
  meetNotes = notes
  go(Screen.Meet)
}

function screenMeet(): Node[] {
  const notes = meetNotes
  const name = meetFrom === Screen.Record ? draft.name.trim() : ''
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
  return [
    header(name ? S.meetTitleWith(name) : S.meetTitle, { back: () => go(meetFrom) }),
    el('div', { class: 'scroll pad' }, [
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
      el('p', { class: 'meta center' }, [S.meetNoChat]),
    ]),
  ]
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
    header(S.reviewTitle(draft.name.trim()), { back: () => { draft.lines = []; go(Screen.Record) } }),
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
    notificationsCard(s),
    solo ? null : el('button', {
      class: 'btn btn-ghost',
      onclick: () => { if (confirm(S.resetConfirm)) { dropRecording(); clearState(persona, storeCtx); location.reload() } },
    }, [S.resetPhone]),
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
  gear.innerHTML = ICONS.gear
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
      el('h3', {}, [S.queryTitle]),
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
  void net.start().then(() => {
    if (solo && persona === Persona.Holder && window.parent !== window) {
      window.parent.postMessage({ type: 'trustweb-connect-link', url: net.connectLink(APP_URL) }, location.origin)
    }
  })
  void completePendingConnect()
}
