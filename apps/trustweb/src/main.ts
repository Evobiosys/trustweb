/**
 * TrustWeb: the one merged demo app (app.idea2.site/trustweb/).
 *
 * Substance from apps/demo (relay-mode consent flow, via net.ts); look and
 * nav chrome from apps/mobile-ui (the rings, Rings/People toggle, bottom bar
 * with a raised Meet button); a new notes flow in place of the Meet ceremony.
 *
 * Nav: Web | Inventory | Meet | Query. Meet: first tap opens a blank note,
 * a second tap on the note screen shows this phone's code (QR). No chat, no
 * unread badges, notifications off by default.
 */
import './styles.css'
import { el, clear } from '../../demo/src/ui/dom'
import { renderQr } from '../../demo/src/ui/qr'
import { parseConnectLinkParams } from '../../demo/src/connect_link'
import { randomId } from '../../demo/src/crypto'
import { Net } from './net'
import type { AskResult, IncomingAsk, RelayStatus } from './net'
import {
  AUDIENCES, Audience, LineStatus, RINGS, Ring, TAGS, Tag, ageLabel, coarseWhen,
} from './model'
import type { AppState, NoteLine, Person } from './model'
import { extractLines } from './notes'
import { S } from './strings'
import { clearState, isEphemeral, loadState, saveState } from './store'
import { Persona, seedState } from './seed'
import { VoiceSupport, installVoice, startDictation, voiceApiPresent, voiceSupport } from './speech'

enum Screen {
  Start = 'start',
  Web = 'web',
  Inventory = 'inventory',
  Meet = 'meet',
  Review = 'review',
  Place = 'place',
  StillTrue = 'still',
  Query = 'query',
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
  consent: boolean
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
let pendingConnect = parseConnectLinkParams(location.search)
const sharedNotes = (params.get('n') ?? '').slice(0, 600)
// Keep only what a reload needs; the connect parameters are consumed once.
history.replaceState(null, '', location.pathname + (solo ? `?persona=${persona}&solo=1` : ''))

let state: AppState | null = loadState(persona)
if (!state && solo) {
  state = seedState(persona as Persona, Date.now())
  saveState(persona, state)
}

function st(): AppState {
  if (!state) throw new Error('no state yet')
  return state
}
function save(): void {
  if (state) saveState(persona, state)
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

let screen: Screen = state ? Screen.Web : Screen.Start
let webSeg: 'rings' | 'people' = 'rings'
let relayStatus: RelayStatus = 'connecting'
let draft: Draft = freshDraft()
let review: Review | null = null
let queryText = ''
let askRun: { text: string; asked: number; startedAt: number; results: AskResult[] | null } | null = null
const askQueue: IncomingAsk[] = []
let askShowing: IncomingAsk | null = null
let askDecision: boolean | null = null

function freshDraft(personId?: string): Draft {
  const p = personId ? state?.people.find((x) => x.id === personId) : undefined
  return {
    personId, name: p?.name ?? '', context: p?.context ?? '', text: '', consent: false, lines: [],
    ring: p?.ring ?? Ring.Acquaintance,
  }
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
  meet: '<svg viewBox="0 0 24 24"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>',
  query: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/></svg>',
}

function tabButton(target: Screen, label: string, icon: string): HTMLElement {
  const b = el('button', { class: 'tab', 'data-go': target, onclick: () => go(target) })
  b.innerHTML = ICONS[icon]
  b.append(label)
  return b
}

function meetButton(): HTMLElement {
  const b = el('button', { class: 'tab-meet', 'data-go': Screen.Meet, 'aria-label': S.navMeet, onclick: onMeetTap })
  b.innerHTML = ICONS.meet
  b.append(el('span', {}, [S.navMeet]))
  return b
}

tabs.append(
  tabButton(Screen.Web, S.navWeb, 'web'),
  tabButton(Screen.Inventory, S.navInventory, 'inventory'),
  meetButton(),
  tabButton(Screen.Query, S.navQuery, 'query'),
)

function onMeetTap(): void {
  if (screen === Screen.Meet) { void showQrSheet(); return }
  draft = freshDraft()
  go(Screen.Meet)
}

function go(s: Screen): void {
  screen = s
  closeSheet()
  render()
}

function header(title: string, opts: { back?: () => void; right?: Node | null } = {}): HTMLElement {
  statusPill = el('span', { class: 'status-pill' })
  updateStatusPill()
  return el('div', { class: 'hdr' }, [
    el('div', { class: 'hdr-left' }, [
      opts.back ? el('button', { class: 'back', 'aria-label': S.back, onclick: opts.back }, ['‹']) : null,
      el('h2', {}, [title]),
    ]),
    opts.right ?? statusPill,
  ])
}

function updateStatusPill(): void {
  if (!statusPill) return
  statusPill.className = 'status-pill ' + relayStatus
  statusPill.textContent = relayStatus === 'connected' ? S.statusConnected
    : relayStatus === 'connecting' ? S.statusConnecting : S.statusDisconnected
}

function render(): void {
  const showTabs = screen !== Screen.Start
  tabs.style.display = showTabs ? 'flex' : 'none'
  tabs.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => {
    const target = b.getAttribute('data-go')
    const on = target === screen
      || (target === Screen.Meet && (screen === Screen.Review || screen === Screen.Place))
      || (target === Screen.Web && screen === Screen.StillTrue)
    b.classList.toggle('on', on)
  })
  host.className = 'screen on ' + screen
  const body = (() => {
    switch (screen) {
      case Screen.Start: return screenStart()
      case Screen.Web: return screenWeb()
      case Screen.Inventory: return screenInventory()
      case Screen.Meet: return screenMeet()
      case Screen.Review: return screenReview()
      case Screen.Place: return screenPlace()
      case Screen.StillTrue: return screenStillTrue()
      case Screen.Query: return screenQuery()
    }
  })()
  host.replaceChildren(...body)
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
      ? el('a', { class: 'solo-card', href: APP_URL + 'solo.html' }, [
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
const RADIUS: Record<Ring, number> = { [Ring.Close]: 72, [Ring.Friend]: 114, [Ring.Acquaintance]: 152 }
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

function ringsView(s: AppState): HTMLElement {
  const C = 176
  const wrap = el('div', { class: 'rings-wrap' })
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 352 352')
  svg.innerHTML = '<defs><linearGradient id="th" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4FD7A0"/><stop offset="1" stop-color="#12A8E3"/></linearGradient></defs>'
  for (const r of RINGS) {
    const c = document.createElementNS(NS, 'circle')
    c.setAttribute('cx', String(C)); c.setAttribute('cy', String(C)); c.setAttribute('r', String(RADIUS[r]))
    c.setAttribute('fill', 'none'); c.setAttribute('stroke', 'rgba(154,55,240,.22)')
    c.setAttribute('stroke-width', r === Ring.Close ? '2.2' : '1.4')
    c.setAttribute('stroke-dasharray', r === Ring.Acquaintance ? '2 5' : r === Ring.Friend ? '6 4' : '')
    svg.appendChild(c)
  }
  wrap.appendChild(svg)
  for (const ring of RINGS) {
    const inRing = s.people.filter((p) => p.ring === ring)
    inRing.forEach((p, i) => {
      const deg = (360 / inRing.length) * i + (ring === Ring.Close ? 200 : ring === Ring.Friend ? 65 : 30)
      const a = ((deg - 90) * Math.PI) / 180
      const x = C + RADIUS[ring] * Math.cos(a)
      const y = C + RADIUS[ring] * Math.sin(a)
      const path = document.createElementNS(NS, 'path')
      const mx = (C + x) / 2 + (y - C) * 0.12
      const my = (C + y) / 2 + (C - x) * 0.12
      path.setAttribute('d', `M${C} ${C} Q${mx} ${my} ${x} ${y}`)
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'url(#th)')
      path.setAttribute('stroke-width', ring === Ring.Close ? '2.6' : ring === Ring.Friend ? '1.8' : '1.2')
      path.setAttribute('opacity', p.peerId ? '0.85' : '0.35')
      if (!p.peerId) path.setAttribute('stroke-dasharray', '3 4')
      svg.appendChild(path)
      const b = el('button', { class: 'node', onclick: () => personSheet(p.id) }, [
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
    render()
  }
  return el('div', { class: 'verse notif' }, [
    el('h3', {}, [s.notificationsOn ? S.notifOnTitle : S.notifTitle]),
    el('p', {}, [S.notifBody]),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => void toggle() }, [s.notificationsOn ? S.notifTurnOff : S.notifTurnOn]),
  ])
}

function screenWeb(): Node[] {
  const s = st()
  const connected = s.people.filter((p) => p.peerId).length
  const seg = el('div', { class: 'seg' }, [
    el('button', { class: webSeg === 'rings' ? 'on' : '', onclick: () => { webSeg = 'rings'; render() } }, [S.segRings]),
    el('button', { class: webSeg === 'people' ? 'on' : '', onclick: () => { webSeg = 'people'; render() } }, [S.segPeople]),
  ])
  return [
    header(S.webTitle),
    el('div', { class: 'scroll' }, [
      el('p', { class: 'sub' }, [S.webCount(s.people.length, connected)]),
      seg,
      s.people.length === 0 ? el('p', { class: 'empty' }, [S.webEmpty]) : null,
      webSeg === 'rings' ? ringsView(s) : peopleView(s),
      webSeg === 'rings' ? el('p', { class: 'web-cap' }, [S.webCap]) : null,
      isEphemeral() ? el('p', { class: 'warn' }, [S.storageEphemeral]) : null,
      notificationsCard(s),
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
  openSheet([
    el('h3', {}, [p.name]),
    el('div', { class: 'meta' }, [S.ringLabel[p.ring] + ' · ' + S.sheetMet(p.context, coarseWhen(p.metAt))]),
    el('div', { class: 'path' }, [p.peerId ? S.sheetConnected : S.sheetNotesOnly]),
    current.length
      ? el('div', { class: 'sheet-lines' }, current.map((l) => el('div', { class: 'sline' }, [
          tagChip(l.tag, l.customTag), el('span', {}, [l.text]), el('em', {}, [S.audienceLabel[l.audience]]),
        ])))
      : el('p', { class: 'meta' }, [S.sheetNoNotes]),
    current.length ? el('button', { class: 'btn btn-electric', onclick: () => startReview(p.id) }, [S.sheetStillTrue]) : null,
    el('button', { class: 'btn btn-ghost', onclick: () => { draft = freshDraft(p.id); go(Screen.Meet) } }, [S.sheetAddNote]),
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
// meet: step 1, the note
// ---------------------------------------------------------------------------

let stopDictation: (() => void) | null = null

function screenMeet(): Node[] {
  const who = el('input', { class: 'field', placeholder: S.meetWhoPh, value: draft.name, 'aria-label': S.meetWho, maxlength: '40' })
  const where = el('input', { class: 'field', placeholder: S.meetWherePh, value: draft.context, 'aria-label': S.meetWhere, maxlength: '80' })
  const text = el('textarea', { class: 'field note', placeholder: S.meetTypePh, rows: '6', 'aria-label': S.meetOrType })
  text.value = draft.text
  who.addEventListener('input', () => { draft.name = who.value; consentText.textContent = S.meetConsent(draft.name.trim() || 'They') })
  where.addEventListener('input', () => { draft.context = where.value })
  text.addEventListener('input', () => { draft.text = text.value })

  const consentBox = el('input', { type: 'checkbox', id: 'consent' })
  consentBox.checked = draft.consent
  consentBox.addEventListener('change', () => { draft.consent = consentBox.checked })
  const consentText = el('span', {}, [S.meetConsent(draft.name.trim() || 'They')])

  const micStatus = el('p', { class: 'mic-status' })
  const mic = el('button', { class: 'mic', 'aria-label': S.meetMic, disabled: true })
  mic.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>'
  // Probed only on a tap, never on render: SpeechRecognition.available()
  // crashed the renderer outright in headless Chromium 153 during testing, and
  // a note screen must never be able to take the whole app down with it.
  if (!voiceApiPresent()) {
    micStatus.textContent = S.meetMicUnavailable
  } else {
    mic.removeAttribute('disabled')
    micStatus.textContent = S.meetMicTap
    mic.onclick = async () => {
      if (stopDictation) { stopDictation(); return }
      if (!draft.consent) { micStatus.textContent = S.meetMicNeedsConsent; return }
      const v = await voiceSupport()
      if (v === VoiceSupport.Unavailable || (v === VoiceSupport.NeedsDownload && !(await installVoice()))) {
        mic.setAttribute('disabled', '')
        micStatus.textContent = S.meetMicUnavailable
        return
      }
      mic.classList.add('live')
      micStatus.textContent = S.meetMicListening
      stopDictation = startDictation((phrase) => {
        draft.text = (draft.text ? draft.text.trimEnd() + '. ' : '') + phrase
        text.value = draft.text
      }, () => {
        stopDictation = null
        mic.classList.remove('live')
        micStatus.textContent = ''
      })
    }
  }

  const make = (): void => {
    stopDictation?.()
    if (!draft.name.trim()) { who.focus(); return }
    const existing = draft.lines.length ? draft.lines : []
    draft.lines = existing.length ? existing : extractLines(draft.text).map((l) => ({
      id: randomId(8), text: l.text, tag: l.tag, audience: Audience.Friends,
    }))
    go(Screen.Review)
  }

  return [
    header(S.meetTitle, { back: () => go(Screen.Web) }),
    el('div', { class: 'scroll pad' }, [
      el('label', { class: 'lbl' }, [S.meetWho]), who,
      el('label', { class: 'lbl' }, [S.meetWhere]), where,
      el('div', { class: 'mic-row' }, [mic, micStatus]),
      el('label', { class: 'consent' }, [consentBox, consentText]),
      el('label', { class: 'lbl' }, [S.meetOrType]), text,
      el('p', { class: 'hint' }, [S.meetQrHint]),
    ]),
    el('div', { class: 'cta' }, [el('button', { class: 'btn btn-teal', onclick: make }, [S.meetMake])]),
  ]
}

async function showQrSheet(): Promise<void> {
  await net.start()
  let url = net.connectLink(APP_URL)
  const notes = draft.text.trim()
  if (notes) url += '&n=' + encodeURIComponent(notes.slice(0, 300))
  const qr = el('div', { class: 'qrwrap', 'data-payload': url })
  openSheet([
    el('h3', {}, [S.qrTitle]),
    el('p', { class: 'meta' }, [S.qrLead]),
    qr,
    el('dl', { class: 'qr-facts' }, [
      el('dt', {}, [S.qrRing]), el('dd', {}, [S.qrRingValue]),
      el('dt', {}, [S.qrShared]), el('dd', {}, [notes ? S.qrSharedValue : S.qrSharedNoNotes]),
    ]),
    el('button', { class: 'btn btn-ghost', disabled: true }, [`${S.qrAdvanced} · ${S.qrSoon}`]),
    el('p', { class: 'meta center' }, [S.qrNoChat]),
  ])
  await renderQr(qr, url)
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
    header(S.reviewTitle(draft.name.trim()), { back: () => go(Screen.Meet) }),
    el('div', { class: 'scroll pad' }, [
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
  draft = freshDraft()
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
  return [
    header(S.invTitle),
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
      solo ? null : el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: () => { if (confirm(S.resetConfirm)) { clearState(persona); location.reload() } },
      }, [S.resetPhone]),
    ]),
  ]
}

// ---------------------------------------------------------------------------
// query
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  'Does anyone have a motorbike I could borrow?',
  'Who is hiring?',
  'Any new animal welfare funding?',
  'Who has a spare room in Vienna?',
]

let countdownTimer: ReturnType<typeof setInterval> | undefined

async function runAsk(text: string): Promise<void> {
  const t = text.trim()
  if (!t) return
  const peers = st().peers.length
  askRun = { text: t, asked: peers, startedAt: Date.now(), results: null }
  clearInterval(countdownTimer)
  countdownTimer = setInterval(() => { if (screen === Screen.Query && askRun && !askRun.results) render() }, 1000)
  render()
  const results = await net.ask(t)
  clearInterval(countdownTimer)
  if (askRun && askRun.text === t) askRun.results = results
  if (screen === Screen.Query) render()
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

function screenQuery(): Node[] {
  const s = st()
  const box = el('textarea', { class: 'field', rows: '3', placeholder: S.queryPh, maxlength: '200', 'aria-label': S.queryTitle })
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
          : el('p', { class: 'wait' }, [el('span', { class: 'spin' }), ' ' + S.queryWaiting(Math.max(0, Math.ceil((run.startedAt + 30_000 - Date.now()) / 1000)))]),
      ])
    : null
  return [
    header(S.queryTitle),
    el('div', { class: 'scroll pad' }, [
      el('p', { class: 'hint' }, [S.queryLead]),
      s.peers.length === 0 ? el('p', { class: 'warn' }, [S.queryNoPeers]) : null,
      box,
      el('div', { class: 'chips' }, [
        el('span', { class: 'chips-lbl' }, [S.queryTry]),
        ...SUGGESTIONS.map((q) => el('button', { class: 'chip', onclick: () => { queryText = q; render() } }, [q])),
      ]),
      el('button', {
        class: 'btn btn-electric wide', disabled: busy || s.peers.length === 0,
        onclick: () => void runAsk(queryText),
      }, [S.querySend]),
      inFlight,
    ]),
  ]
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
