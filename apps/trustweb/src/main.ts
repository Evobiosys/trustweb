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
import { createShortLinker } from './short_link'
import type { ShortLinker } from './short_link'
import { createLinkChooser } from './short_link_view'
import type { LinkChooser } from './short_link_view'
import { parseConnectLinkParams } from '../../demo/src/connect_link'
import { randomId } from '../../demo/src/crypto'
import { ANSWER_WINDOW_MS, Net } from './net'
import type { AskResult, IncomingAsk, RelayStatus } from './net'
import { AboutKind, ageLabel, askDirectOnly, Audience, AUDIENCES, Channel, CHANNELS, coarseWhen, DEFAULT_RECORDINGS, DefaultRecording, defaultRecording, demoAccountScope, demoOnlyForDemoAccounts, enginePlan, feedOn, HintId, HINTS, isDemoItem, isDemoPerson, LineStatus, pastMeetings, ProvenanceState, QueryStyle, Ring, RINGS, ServerJobState, TabOrder, Tag, TAGS, threadIsDemo, ENGINE_CHOICES, TranscriptionChoice, transcriptionChoice } from './model'
import { ScanAdvice, qrPayload, scanAdvice, signalLabelKey, channelLink, normalizeHandle } from './channel'
import type { SignalProvider } from './channel'
import { contactToSend, holdContact, primaryReachable, receiveContactText, settleDefaultTick, takeContact } from './contact_share'
import type { HeldContacts, Reachable } from './contact_share'
import { TextKind, migrateChats, peersWithPending, receiveText, routeText } from './chat'
import type { ChatBook } from './chat'
import { flushPending, renderChat, renderShareControls } from './chat_view'
import type { ChatIo, ChatStrings, ShareStrings } from './chat_view'
import type { AppState, DemoAccount, Found, InventoryItem, ItemSource, NoteLine, PastMeeting, Peer, Person, ReceivedShare } from './model'
import { parseShareFragment, parseShareText, SHARE_PARAM, shareFragment, shareUrl } from './share'
import type { MeetingPack, ShareLink } from './share'
import { extractLines } from './notes'
import { S } from './strings'
import { clearState, isEphemeral, loadState, saveState, wasUnreadable } from './store'
import { DemoContext, Persona, isDemoContext, isPersona, seedState } from './seed'
import { MeetingRecorder, RecorderSupport, audioExtension, clock, recorderSupport } from './recorder'
import type { Recording } from './recorder'
import { webSearchRow } from './web_search'
import type { WebResultsHooks } from './web_search'
import { giveWebConsent, webConsents } from './web_results'
import { nfcWriteSupported, writeLinkToTag } from './nfc'
import { TranscriberEngine, TranscriberStatus, createTranscriber, detectEngine } from './meeting_transcriber'
import type { MeetingTranscriber, Segment } from './meeting_transcriber'
import { meetingToNoteText, meetingToText } from './sensemeet'
import { backupNow, newRandomKey, parseKeyText, restore } from './backup'
import { createBackupView } from './backup_view'
import { RecordOrigin, recordModeFor } from './record_origin'
import { aboutGroup } from './about'
import { setUpInstall } from './install'
import { runsAsInstalledApp } from './standalone_app'
import { createInstallSheets } from './install_sheets'
import { DismissScope, removeDummyContent } from './demo_dismiss'
import { canEndDemoAccount } from './demo_devices'
import { GENERAL_NOTES_MAX, addContextLines, cleanGeneralNotes, contextOf, noteKey, normaliseNoteFields, travelsInPack } from './note_fields'
import { CarryPlan, carryPlan, demoContentForLivePhone, dropCarry, freshFromCarry, mergeCarryOver, readCarry } from './demo_to_live'
import type { CarryOver } from './demo_to_live'
import { KeepNotice, dueForTakeDown, guestAsk, guestAsked, guestEnded, guestGranted, guestKept, isKept, keepAccount, keepText, parseKeepText, unkeepAccount } from './account_keep'
import { asksMatchNotes, notesMatchDefault } from './notes_source'
import { focusFor, linesFromTranscript, markDemo, markReviewed, migrateSources, provenanceState, recordedSource, sharedSource, typedSource } from './provenance'
import { sourceView } from './provenance_view'
import { AudioStore, MAX_BYTES, MAX_RECORDINGS } from './audio_store'
import { megabytes } from './audio_plan'
import { createPastMeetings, whenLabel } from './past_meetings_view'
import { createSwissContext, readHosting } from './swiss_context'
import { createTranscriptionView } from './transcription_view'
import { createHostingView } from './hosting_view'
import { importGroup } from './import_view'
import { createFeedView } from './feed_view'
import { ImageStore } from './image_store'
import { PersistState, persistState } from './storage_persist'
import type { JobTake } from './server_transcription'
import { createPackView } from './pack_view'
import { addToOutbox, transcriptStillComing } from './late_pack'
import { ICONS } from './icons'
import type { PastFocus } from './past_meetings_view'
import { DEMO_LIFETIME_MS, DEMO_SUFFIX, demoAccountName, demoFragment, demoPersona, handoverFragment, isDemoPeerRef, isDemoPersona, parseDemoFragment, parseHandoverFragment, timeLeft } from './demo_account'
import type { DemoPeerRef, HandoverLink } from './demo_account'
import { askReachOf, askWaitMs, HOPS_DEFAULT, readVia } from './hops'
import { answerTitle, cascadeInfoButton, cascadeInfoContent, degreesChooser, degreesPill, onOffSwitch, passOnRow, reachChooser, throughTag } from './hops_view'
import { joinFrontDoor, mergeOneJakob, ownFrontDoor, passOnAllowed, personOfPeer, samePersonTarget } from './one_jakob'

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
  /** What people in your web shared with you, and what you share (wave 1733 round B). */
  Feed = 'feed',
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
  /** The moment in the recording it belongs to (provenance.ts): stamped during a take, or its transcript line's offset. */
  atMs?: number
  /** The transcript line it was picked from (index into draft.segments, as stored with the meeting). */
  line?: number
  /** Typed by hand under "General notes" (not said in the recording): its source is "typed". */
  typed?: boolean
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
  /** Who (a person) or what (a thing) the recording is about. */
  about: AboutKind
  /** Lines noted by hand under Record > Advanced; merged after the transcript is mined. */
  extraLines: DraftLine[]
  /** Where the recording was paused, for the transcript's pause dividers (from TalkWeave, 2026-10-06). */
  pauses: PauseMark[]
  /** The stored past meeting this draft already wrote (at End meeting); completed when its notes are saved. */
  meetingId?: string
  /** What is typed under "General notes" on Record (wave 5); it becomes one note line and rides on the stored meeting. */
  generalNotes: string
  /** "None of these": about neither a person nor a thing; saved as a plain note, no link (wave 5). */
  plain: boolean
  /** The inventory item picked under "what": the notes are added to it as context instead of making a new line (wave 5). */
  itemId?: string
}

/** A pause in the transcript: after how many segments, at which recording time, and for how long once resumed. */
interface PauseMark {
  afterSegments: number
  atMs: number
  startedAt: number
  forMs: number | null
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
// A demo account opened on the owner's own phone runs under its own persona
// (demo-<account id>): its own storage record and relay identity, next to his.
const persona: string = isPersona(personaParam) || isDemoPersona(personaParam) ? personaParam : 'me'
const solo = params.get('solo') === '1' && isPersona(persona)
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
// A demo-account link (QR > Demo account on the inviter's phone, 2026-10-06):
// the account name and, optionally, the demo inventory peer, also in the fragment.
const demoLink = pendingConnect ? parseDemoFragment(location.hash) : null
// A hand-over link (?handover=1#k=...): a demo account moves to this phone.
const handover: HandoverLink | null = params.get('handover') === '1' ? parseHandoverFragment(location.hash) : null
// A meeting sent inside TrustWeb (?share=1#k=...&t=...), or riding in a Meet
// code after a meeting (#n=...&k=...&t=...): opened once the app is up (share.ts).
let pendingShare: ShareLink | null = params.get(SHARE_PARAM) === '1' || pendingConnect ? parseShareFragment(location.hash) : null
// ?install=1 (the website's and the demo's Install button): open the Install sheet once the app is up (install.ts).
const wantInstall = params.get('install') === '1'
// Keep only what a reload needs; the connect parameters are consumed once.
history.replaceState(null, '', location.pathname + (solo ? `?persona=${persona}&solo=1&ctx=${ctx}` : isDemoPersona(persona) ? `?persona=${persona}` : ''))

let state: AppState | null = loadState(persona, storeCtx)
// A record that is there but unreadable was kept aside untouched (store.ts);
// nothing is merged over it, and the person is told.
const recordKeptAside = wasUnreadable(persona, storeCtx)
// The demo's carry-over (demo_to_live.ts): the demo page's Install button left
// the person's own content for the live app. Applied to the live app's own
// record only; at once where nothing would be overwritten, else after asking.
let pendingCarry: CarryOver | null = !solo && persona === 'me' && window.top === window && !recordKeptAside ? readCarry() : null
let carryNotice = ''
if (pendingCarry && carryPlan(state) !== CarryPlan.Ask) {
  try {
    const fresh = !state
    const next = state ? mergeCarryOver(state, pendingCarry) : freshFromCarry(pendingCarry, randomId(12))
    state = next
    save()
    carryNotice = fresh ? S.carryWelcome(next.me.displayName) : S.carryMerged
  } catch {
    // Never let a carry-over keep the app from starting: the live record stays as it was loaded.
  }
  dropCarry()
  pendingCarry = null
}
// Every item and note gets a source once (provenance.ts): demo content "demo", the rest "typed"
// or, where a stored meeting holds the same note, "recorded" with that meeting. Idempotent.
// A failure leaves the record exactly as loaded (nothing saved) and the app still starts.
try {
  if (state) {
    const sourced = migrateSources(state)
    const noted = normaliseNoteFields(state)
    // Wave 6 (N6): a demo account made before had its inviter and his front door as two people; now one (one_jakob.ts).
    const merged = mergeOneJakob(state, S.demoPeerContext)
    // Wave 6 (notes_source.ts): the side-by-side demo phones do not let asks match notes (their content is imaginary); stored once, so it also holds after "Add demo content" changes the default.
    const soloOff = solo && state.asksMatchNotes === undefined
    if (soloOff) state.asksMatchNotes = false
    // Wave 6 (chat.ts): a corrupted `chats` value is repaired, never thrown on.
    const chatsFixed = migrateChats(state)
    if (sourced || noted || merged || soloOff || chatsFixed) save()
  }
} catch {
  state = loadState(persona, storeCtx)
}
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
// The magnifier on Record and Meeting: past meetings and memos (search.ts).
let pastSearchOpen = false
let pastSearchText = ''
let queryText = ''
let askRun: {
  text: string; asked: number; askedPeerIds: string[]; startedAt: number; results: AskResult[] | null
  /** Wave 6: the reach it went out with (hops.ts), for the countdown. */
  reach: number
} | null = null
const askQueue: IncomingAsk[] = []
let askShowing: IncomingAsk | null = null
let askDecision: boolean | null = null
// Where Meet's back arrow returns to (Manage, Record, or Web).
let meetFrom: Screen = Screen.Web
// The recording belongs to the current draft; it is dropped with it, or kept with its stored meeting.
const recorder = new MeetingRecorder()
// Recordings kept on this phone with their meetings (audio_store.ts), per persona like the record.
const audioStore = new AudioStore(persona, storeCtx)
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
    ring: p?.ring ?? Ring.Acquaintance, about: AboutKind.Who, extraLines: [], pauses: [], generalNotes: '', plain: false,
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
  onStatus: (s) => { relayStatus = s; updateStatusPill(); updateConnectionRow(); if (s === 'connected') void flushAllChats() },
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
    sendContactTo(peer)
    applyHeldContact(peer, person)
    closeSheet()
    toast(S.peerConnectedToast(peer.displayName, S.ringLabel[peer.ring]))
    render()
  },
  // A phone opened one of this phone's demo-account codes: hold it until the
  // owner allows it in his own view (owner 2026-10-06). Matched by the name
  // the code carried; a second phone on the same code replaces the first.
  holdPeer: (peer) => {
    const acct = demoAccounts().find((t) => t.name === peer.displayName)
    if (!acct) return false
    acct.pending = peer
    save()
    notify(S.demoAcctAllowTitle(acct.name))
    showAllowCard(acct)
    return true
  },
  // The owner's phone allowed this demo account (its ack came back).
  onPeerConfirmed: (peer) => {
    const s = st()
    if (!s.testOf || s.testOf.approvedAt || s.testOf.name !== peer.displayName) return
    s.testOf.approvedAt = Date.now()
    save()
    toast(S.demoApprovedToast(peer.displayName))
    render()
  },
  ringForNewPeer: () => (solo ? Ring.Friend : Ring.Acquaintance),
  onLogChanged: () => { if (screen === Screen.Inventory) render() },
  // A demo account asks: while demo content is on this phone it is matched
  // against the dummy content only (owner 2026-10-06: Max is not part of the demo).
  askScope: (peer) => (demoAccounts().some((t) => t.peerId === peer.id) ? demoAccountScope(st()) : undefined),
  onText: (peer, text, ts) => onIncomingText(peer, text, ts),
  // Wave 6 (one_jakob.ts): this site's front door (demo-peer.json) counts as this phone's own when it carries this phone's name.
  mayPassOnFrom: (peer) => passOnAllowed(st(), peer, ownDoorDid()),
  samePerson: (target, sender) => samePersonTarget(st(), target, sender, ownDoorDid()),
})

/** The did of this site's front door when it is this phone's own (one_jakob.ts ownFrontDoor); null: none known. */
function ownDoorDid(): string | null {
  return solo || !state ? null : ownFrontDoor(state, demoPeer)
}

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
const friendsEl = el('div', { class: 'demo-friends', role: 'status', 'aria-live': 'polite', hidden: true })
/** Desktop, bottom left, outside the phone: add or remove the demo content. */
const demoToggle = el('button', { class: 'demo-toggle', hidden: true, onclick: () => (st().demo ? removeDemoContent() : addDemoContent()) })
let statusPill: HTMLElement | null = null
phone.append(host, tabs, veil, sheet, overlay, toastEl, friendsEl)
root.replaceChildren(phone)
// On a wide screen, outside the phone: open the side-by-side demo (not inside
// the demo's own iframes, and not on a real phone, where the app is full screen).
if (!solo && !isDemoPersona(persona) && window.top === window) {
  const add = el('a', { class: 'add-device', href: APP_URL + 'demo/', title: S.addDevice, 'aria-label': S.addDevice }, [
    el('span', { class: 'add-device-plus', 'aria-hidden': 'true' }, ['+']),
    el('span', {}, [S.addDeviceShort]),
  ])
  const see = el('button', { class: 'see-action', onclick: () => void openWalkthrough() }, [S.seeInAction])
  // The installed app is the personal version (owner 2026-10-07): no "Add a device" and no "Show demo content" in its dock; a browser tab keeps both.
  root.append(el('div', { class: 'page-dock' }, runsAsInstalledApp() ? [see] : [add, see]), demoToggle)
}

/**
 * Desktop, outside the phone: the scripted walkthrough of the demo page as an
 * overlay over this page (owner 2026-10-05: may be dropped if it does not look
 * good). Loaded on demand; Escape or Close ends it and pauses playback.
 */
async function openWalkthrough(): Promise<void> {
  const { mountWalkthrough } = await import('./walkthrough')
  const panel = el('div', { class: 'wt-panel' })
  const layer = el('div', { class: 'wt-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': S.seeInAction })
  const close = (): void => { stop(); layer.remove(); document.removeEventListener('keydown', onKey) }
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
  const closeBtn = el('button', { class: 'btn btn-ghost btn-sm wt-close', onclick: close }, [S.seeInActionClose])
  layer.addEventListener('click', (e) => { if (e.target === layer) close() })
  layer.append(panel)
  panel.append(closeBtn)
  const slot = el('div', {})
  panel.append(slot)
  const stop = mountWalkthrough(slot, { liveHint: S.seeInActionHint, directOnly: state ? askDirectOnly(state) : false })
  document.addEventListener('keydown', onKey)
  document.body.append(layer)
  closeBtn.focus()
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
  // Web | Record | Feed | Inventory (round B); with the Feed off, exactly as before.
  const feedTab = state && feedOn(state) ? [tabButton(Screen.Feed, S.navFeed, 'feed')] : []
  tabs.replaceChildren(invLeft ? inv : web, recordButton(), ...feedTab, invLeft ? web : inv)
  tabs.classList.toggle('four', feedTab.length > 0)
}
renderTabs()

/** The screen that belongs to the draft's mode: Record (solo) or Meeting. */
function recordScreen(): Screen {
  return draft.mode === RecordMode.Meeting ? Screen.Meeting : Screen.Record
}

/** The screen a Record tap came from, for record_origin.ts: Web's own sub-screens count as Web. */
function recordOriginOf(s: Screen): RecordOrigin {
  switch (s) {
    case Screen.Web:
    case Screen.Curate:
    case Screen.StillTrue:
      return RecordOrigin.Web
    case Screen.Inventory:
      return RecordOrigin.Inventory
    case Screen.Meet:
      return RecordOrigin.Meet
    default:
      return RecordOrigin.Other
  }
}

function onRecordTap(): void {
  // The Record tab never wipes a draft in progress (audio, transcript,
  // who/where), so a live take is never switched; it only starts fresh when
  // nothing is in flight, and then by where the tap came from (record_origin.ts):
  // Inventory or Meet -> a meeting, Web -> just me, else Settings > Recording.
  if (!draftInProgress()) {
    const origin = recordOriginOf(screen)
    newDraft()
    if (state && recordModeFor(origin, defaultRecording(state)) === DefaultRecording.Meeting) draft.mode = RecordMode.Meeting
  }
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
  // "Where" and the other person's yes count too (review P3): a Meeting draft with only those is not dropped by the next Record tap.
  return recorder.live || takes.length > 0 || draft.consent
    || draft.plain || Boolean(draft.name.trim() || draft.context.trim() || draft.text.trim() || draft.generalNotes.trim() || draft.segments.length || draft.lines.length || draft.extraLines.length)
}

function go(s: Screen): void {
  // Coming to Record from Inventory means "what", from Web "who" (owner
  // 2026-10-06), whichever of Record or Meeting the tap opens; only while
  // nothing has been named or recorded yet.
  if ((s === Screen.Record || s === Screen.Meeting) && !draftInProgress() && !draft.name.trim()) {
    if (screen === Screen.Inventory) draft.about = AboutKind.What
    else if (screen === Screen.Web) draft.about = AboutKind.Who
  }
  // The past-meeting search belongs to Record and Meeting; leaving them closes it.
  if (s !== Screen.Record && s !== Screen.Meeting) pastSearchOpen = false
  screen = s
  closeSheet()
  render()
}

/**
 * Every header: title left; right, the screen's own button and then the
 * QR button that opens Meet (with a tiny relay-status dot on it). While a
 * take is open the QR gives way to the "Recording" pill, on every screen.
 */
function header(title: string, opts: { back?: () => void; right?: Node | null; after?: Node | null; qr?: boolean; pill?: boolean; more?: boolean } = {}): HTMLElement {
  statusPill = el('button', { class: 'status-pill' })
  // Record and Meeting show their own recording state, so the QR stays put there (owner 2026-10-06).
  statusPill.dataset.pill = opts.pill === false ? '0' : '1'
  const qr = withHint(statusPill, HintId.Qr)
  updateStatusPill(opts.qr !== false)
  return el('div', { class: 'hdr' }, [
    el('div', { class: 'hdr-left' }, [
      opts.back ? el('button', { class: 'back', 'aria-label': S.back, onclick: opts.back }, ['‹']) : null,
      el('h2', {}, [title]),
    ]),
    el('div', { class: 'hdr-right' }, [opts.right ?? null, qr, opts.more ? moreButton() : opts.after ?? null]),
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

// ---------------------------------------------------------------------------
// hints: on desktop a tooltip, on a touch phone a small "i" at the top right
// of the thing (owner 2026-10-06). Tapping it explains; unticking "Show this
// hint again" hides that one; Settings > Tutorial brings all back, Settings >
// Advanced switches them one by one.
// ---------------------------------------------------------------------------

const touchUi = (): boolean => window.matchMedia('(hover: none)').matches
const hintHidden = (id: HintId): boolean => (state?.hiddenHints ?? []).includes(id)

function setHintHidden(id: HintId, hidden: boolean): void {
  const s = st()
  const rest = (s.hiddenHints ?? []).filter((h) => h !== id)
  s.hiddenHints = hidden ? [...rest, id] : rest
  if (!s.hiddenHints.length) delete s.hiddenHints
  save()
}

/** Gives `node` its explanation: a title on desktop, an "i" beside it on touch screens. */
function withHint(node: HTMLElement, id: HintId): HTMLElement {
  const text = S.hintText[id]
  node.title = text
  if (!touchUi() || hintHidden(id)) return node
  const i = el('button', {
    class: 'hint-i', 'aria-label': S.hintOpen(S.hintLabel[id]),
    onclick: (e: Event) => { e.stopPropagation(); e.preventDefault(); openHint(id) },
  }, ['i'])
  return el('span', { class: 'hint-wrap' }, [node, i])
}

function openHint(id: HintId): void {
  const again = el('input', { type: 'checkbox', checked: true })
  const ok = (): void => {
    hideNotice()
    if (!(again as HTMLInputElement).checked) { setHintHidden(id, true); render() }
  }
  showNotice(S.hintLabel[id], S.hintText[id], [
    el('label', { class: 'hint-again' }, [again, S.hintAgain]),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: ok }, [S.hintOk]),
  ])
}

/** The relay state, shown in Settings (moved there from the QR button, owner 2026-10-05). */
function connectionRow(): HTMLElement {
  return el('div', { class: 'conn-row ' + relayStatus, id: 'conn-row', role: 'status' }, [
    el('span', { class: 'relay-dot', 'aria-hidden': 'true' }),
    el('b', {}, [S.setConnection]),
    el('span', {}, [relayLabel()]),
  ])
}
function updateConnectionRow(): void {
  document.getElementById('conn-row')?.replaceWith(connectionRow())
}

/** Re-applies the pill for the current state; `withQr` false hides the idle QR (Meet, Record). */
function updateStatusPill(withQr: boolean = statusPill?.dataset.qr !== '0'): void {
  const p = statusPill
  if (!p) return
  p.dataset.qr = withQr ? '1' : '0'
  p.onclick = null
  p.removeAttribute('title')
  // The "i" beside the QR explains the code: gone while the pill stands there, or the QR is hidden.
  const hintOff = (off: boolean): void => { p.parentElement?.classList.toggle('hint-off', off) }
  if (recorder.live && p.dataset.pill !== '0') {
    hintOff(true)
    const meeting = draft.mode === RecordMode.Meeting
    p.className = 'status-pill rec' + (recorder.paused ? ' paused' : '')
    p.textContent = recorder.paused ? S.statusPaused : meeting ? S.statusRecordingMeeting : S.statusRecording
    p.removeAttribute('aria-label')
    p.hidden = false
    p.onclick = (): void => go(recordScreen())
    return
  }
  p.hidden = !withQr
  hintOff(!withQr)
  p.className = 'status-pill qr ' + relayStatus
  p.innerHTML = icon('qr')
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
    if (state?.testOf?.handedOverAt) return screenHandedOver()
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
      case Screen.Feed: return [header(S.feedTitle), feed.body()]
    }
  })()
  host.replaceChildren(...body)
  if (screen === Screen.Web) requestAnimationFrame(fitRings)
  updateDemoToggle()
}

// ---------------------------------------------------------------------------
// sheet, toast
// ---------------------------------------------------------------------------

/** Wave 6 (N8c): a visible way back to the app on every sheet, so nobody has to know the veil closes it. */
function sheetHomeBar(): HTMLElement {
  return el('div', { class: 'sheet-bar' }, [el('button', { class: 'sheet-home', 'data-sheet-home': '1', 'aria-label': S.sheetHome, onclick: closeSheet }, [el('span', { 'aria-hidden': 'true' }, ['×']), ' ' + S.sheetHome])])
}

function openSheet(children: (Node | null)[]): void {
  openChat = null
  // A past meeting's player stops whenever the sheet changes (past_meetings_view.ts).
  past.stopPlayer()
  delete sheet.dataset.kind
  delete sheet.dataset.meeting
  delete sheet.dataset.pack
  sheet.replaceChildren(el('div', { class: 'grab' }), sheetHomeBar(), ...children.filter((c): c is Node => c !== null))
  sheet.classList.add('on')
  sheet.inert = false
  veil.classList.add('on')
}

function closeSheet(): void {
  openChat = null
  // A closed sheet keeps its last content off-screen; inert takes it out of
  // the tab order and the accessibility tree.
  past.stopPlayer()
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

/**
 * Demo phones only, once, right after the name is typed: the web they see is
 * seeded, so say so (owner 2026-10-05). Non-blocking: it sits under the
 * header, only its own button takes taps, and it goes by itself.
 */
let friendsTimer: ReturnType<typeof setTimeout> | undefined
function hideNotice(): void { clearTimeout(friendsTimer); friendsEl.hidden = true }
/** A small card under the header: non-blocking, only its own buttons take taps. */
function showNotice(title: string, body: string, actions: HTMLElement[], autoHideMs?: number): void {
  friendsEl.replaceChildren(
    el('b', {}, [title]),
    el('span', {}, [body]),
    el('div', { class: 'notice-actions' }, actions),
  )
  friendsEl.hidden = false
  clearTimeout(friendsTimer)
  if (autoHideMs) friendsTimer = setTimeout(hideNotice, autoHideMs)
}
function showDemoFriends(): void {
  showNotice(S.demoFriendsTitle, solo ? S.demoFriendsBody : S.demoFriendsBodyOwn, [
    el('button', { class: 'btn btn-ghost btn-sm', onclick: hideNotice }, [S.demoFriendsOk]),
    // Smaller and in another colour, under "Got it" (owner 2026-10-07): takes the dummy content away again.
    el('button', { class: 'notice-dismiss', 'data-dismiss-demo': '1', onclick: dismissDemoFriends }, [S.demoFriendsDismiss]),
  ], 9000)
}

/** "Dismiss them": a demo phone drops its seeded web, a live phone only what "Show demo content" added (demo_dismiss.ts). */
function dismissDemoFriends(): void {
  hideNotice()
  removeDummyContent(st(), ctx, solo ? DismissScope.Seeded : DismissScope.Added)
  save()
  render()
  toast(S.demoRemoved)
}

// ---------------------------------------------------------------------------
// demo content on your own phone (owner 2026-10-05): desktop has a button
// bottom left, a phone is asked once in a popup; Settings can add or remove
// it any time. Only what was added is removed again (ids kept in state.demo).
// ---------------------------------------------------------------------------

function addDemoContent(): void {
  const s = st()
  if (s.demo) return
  const seed = demoContentForLivePhone(Date.now(), ctx)
  s.people.push(...seed.people)
  s.inventory.push(...seed.inventory)
  s.demo = { people: seed.people.map((p) => p.id), inventory: seed.inventory.map((i) => i.id) }
  s.demoOffered = true
  save()
  render()
  showDemoFriends()
}

function removeDemoContent(): void {
  const s = st()
  if (!s.demo) return
  removeDummyContent(s, ctx, DismissScope.Added)
  save()
  render()
  toast(S.demoRemoved)
}

const isPhoneWidth = (): boolean => window.matchMedia('(max-width: 960px)').matches

/**
 * Phones only, once: offer the demo content in the notice card. Tapping
 * anywhere else counts as "no thanks", so the card never sits over what the
 * person went on to do (Settings can still add it).
 */
function offerDemoContent(): void {
  const s = state
  if (!s || solo || s.testOf || s.demoOffered || s.demo || window.top !== window || !isPhoneWidth() || runsAsInstalledApp()) return
  const answer = (yes: boolean): void => {
    document.removeEventListener('pointerdown', onElsewhere, true)
    st().demoOffered = true
    save()
    hideNotice()
    if (yes) addDemoContent()
  }
  const onElsewhere = (e: PointerEvent): void => { if (!friendsEl.contains(e.target as Node)) answer(false) }
  showNotice(S.demoOfferTitle, S.demoOfferBody, [
    el('button', { class: 'btn btn-electric btn-sm', onclick: () => answer(true) }, [S.demoOfferYes]),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => answer(false) }, [S.demoOfferNo]),
  ])
  document.addEventListener('pointerdown', onElsewhere, true)
}

function updateDemoToggle(): void {
  demoToggle.hidden = !state || solo || Boolean(state.testOf) || window.top !== window || runsAsInstalledApp()
  if (state) demoToggle.textContent = state.demo ? S.demoRemove : S.demoAdd
}

/**
 * A little ripple where the web was pressed, the gold ground ripple of
 * questhub.eco (owner 2026-10-05). Decorative: no pointer events, hidden
 * from assistive tech, removed when it has faded.
 */
function ripple(e: MouseEvent): void {
  const box = phone.getBoundingClientRect()
  const r = el('span', { class: 'ripple', 'aria-hidden': 'true' })
  r.style.left = `${e.clientX - box.left}px`
  r.style.top = `${e.clientY - box.top}px`
  r.addEventListener('animationend', (ev) => { if ((ev as AnimationEvent).animationName === 'tw-ripple-2') r.remove() })
  phone.appendChild(r)
  setTimeout(() => r.remove(), 1600)
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

function createMe(name: string): void {
  const displayName = name.trim().slice(0, 40)
  state = solo
    ? { ...seedState(persona as Persona, Date.now(), ctx), me: { id: randomId(12), displayName } }
    : { v: 1, me: { id: randomId(12), displayName }, peers: [], people: [], inventory: [], log: [], notificationsOn: false }
  if (solo) markDemo(state.people, state.inventory)
  save()
  renderTabs()
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
      person.lines.push({ id: randomId(8), text: l.text, tag: l.tag, audience: Audience.OnlyMe, status: LineStatus.Current, notedAt: now, checkedAt: now, source: sharedSource(peer.displayName) })
    }
  }
  save()
  // Both phones exchange what each ticked on the Meet page (the inviter's side is onPeerConnected); never to a demo account.
  if (!demoLink) sendContactTo(peer)
  applyHeldContact(peer, person)
  // A demo account: also connect to the demo inventory peer the link names,
  // then open the ask right away (that is what the account is for).
  if (demoLink) {
    if (demoLink.peer) await connectDemoPeer(demoLink.peer, person)
    queryOpen = true
    toast(S.demoWaitingToast(peer.displayName))
  } else {
    toast(S.peerConnectedToast(peer.displayName, S.ringLabel[ring]))
  }
  render()
  // The code carried the meeting too (notes and transcript, encrypted): open it now.
  if (pendingShare) {
    const link = pendingShare
    pendingShare = null
    void openShare(link)
  }
}

/**
 * The demo inventory (services/trustweb-peer) named in a demo-account link: one
 * more peer. When it carries the inviter's own name it IS the inviter's
 * inventory (N6, one Jakob): it joins that person instead of a second node.
 */
async function connectDemoPeer(ref: DemoPeerRef, inviter?: Person): Promise<void> {
  const s = st()
  if (s.peers.some((p) => p.did === ref.did)) return
  const peer = await net.completeConnect({ did: ref.did, from: { id: ref.id, displayName: ref.name } }, Ring.Acquaintance)
  if (!personOfPeer(s, peer.id) && !joinFrontDoor(inviter, peer.id, peer.displayName)) {
    s.people.push({ id: randomId(8), name: peer.displayName, context: S.demoPeerContext, ring: Ring.Acquaintance, metAt: Date.now(), lines: [], peerId: peer.id })
  }
  save()
}

function screenStart(): Node[] {
  if (handover) return takeOverScreen(handover)
  const invite = pendingConnect
  const inviter = invite?.from.displayName || 'Someone'
  // A demo-account link: the name is set by the owner ("<name>-demo"), nothing to type.
  const demo = invite && demoLink ? demoLink : null
  const name = el('input', { class: 'field', placeholder: S.yourName, autocomplete: 'given-name', maxlength: '40', 'aria-label': S.yourName, value: defaultName })
  const submit = (): void => {
    const typed = demo ? demo.account : name.value
    if (!typed.trim()) { name.focus(); return }
    createMe(typed)
    if (demo) {
      const s = st()
      s.testOf = { name: inviter, createdAt: Date.now(), accountId: demo.accountId, expiresAt: demo.expiresAt, own: demo.own }
      // Their first minute is for asking, not for a demo-content card.
      s.demoOffered = true
      save()
    }
    screen = Screen.Web
    render()
    if (solo) showDemoFriends()
    else offerDemoContent()
    void net.start().then(announceLink)
    void completePendingConnect()
    maybeOpenPendingShare()
  }
  name.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') submit() })
  return [el('div', { class: 'start' }, [
    el('div', { class: 'logo' }, ['◎']),
    el('h1', {}, [S.appName]),
    el('p', { class: 'tagline' }, [S.tagline]),
    recordKeptAside ? el('p', { class: 'warn', 'data-record-kept-aside': '1' }, [S.recordKeptAside]) : null,
    demo
      ? el('div', { class: 'invite test-invite' }, [
          el('b', {}, [demo.own ? S.demoInviteOwn(demo.account) : S.demoInvite(inviter)]),
          el('p', {}, [demo.own ? S.demoInviteOwnSub : S.demoInviteSub(demo.account)]),
        ])
      : invite
        ? el('div', { class: 'invite' }, [
            el('b', {}, [S.connectInvite(inviter)]),
            sharedNotes ? el('p', {}, [S.connectInviteNotes(inviter)]) : null,
          ])
        : el('p', { class: 'lead' }, [S.startLead]),
    !invite && window.top === window
      ? el('a', { class: 'solo-card', href: APP_URL + 'demo/' }, [
          el('b', {}, [S.startSolo]),
          el('span', {}, [S.startSoloSub]),
        ])
      : null,
    el('div', { class: 'start-form' }, [
      demo ? el('div', { class: 'field test-name', 'aria-label': S.yourName }, [demo.account]) : name,
      el('button', { class: 'btn btn-electric', onclick: submit }, [demo ? S.demoStart(demo.account) : invite ? S.connectJoin : S.startOwn]),
    ]),
    el('p', { class: 'foot' }, [S.startFoot]),
  ])]
}

/**
 * A hand-over link opened here: unpack the demo account from the backup server
 * with the key in the fragment and make it this phone's account (or, where
 * this phone already has its own TrustWeb, a second persona next to it).
 */
function takeOverScreen(h: HandoverLink): Node[] {
  const msg = el('p', { class: 'meta' })
  const take = async (): Promise<void> => {
    btn.setAttribute('disabled', '')
    msg.textContent = S.takeWorking
    try {
      const data = await restore(parseKeyText(h.keyText)) as Partial<AppState> | null
      if (!data || data.v !== 1 || !data.me || !data.testOf) throw new Error('not a demo account')
      const taken = { ...data, testOf: { ...data.testOf, own: undefined, handedOverAt: undefined } } as AppState
      const own = loadState('me')
      if (own && persona === 'me') {
        const p = demoPersona(h.accountId)
        saveState(p, taken)
        location.replace(location.pathname + '?persona=' + p)
      } else {
        state = taken
        save()
        location.replace(location.pathname + (persona === 'me' ? '' : '?persona=' + persona))
      }
    } catch {
      msg.textContent = S.takeFailed
      btn.removeAttribute('disabled')
    }
  }
  const btn = el('button', { class: 'btn btn-electric', onclick: () => void take() }, [S.takeButton(h.account)])
  return [el('div', { class: 'start' }, [
    el('div', { class: 'logo' }, ['◎']),
    el('h1', {}, [S.appName]),
    el('p', { class: 'tagline' }, [S.tagline]),
    el('div', { class: 'invite test-invite' }, [
      el('b', {}, [S.takeTitle(h.account)]),
      el('p', {}, [S.takeLead(h.account)]),
    ]),
    el('div', { class: 'start-form' }, [btn, msg]),
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
  const wrap = el('div', { class: 'rings-wrap', title: S.hintText[HintId.WebTap] })
  wrap.addEventListener('click', (e) => onRingsTap(e as MouseEvent, wrap))
  if (touchUi() && !hintHidden(HintId.WebTap)) {
    wrap.appendChild(el('button', {
      class: 'hint-i rings-hint', 'aria-label': S.hintOpen(S.hintLabel[HintId.WebTap]),
      onclick: (e: Event) => { e.stopPropagation(); openHint(HintId.WebTap) },
    }, ['i']))
  }
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
      const mark = (p.peerId ? marks.get(p.peerId) : undefined) ?? (p.doorPeerId ? marks.get(p.doorPeerId) : undefined)
      const b = el('button', { class: 'node' + (mark ? ' ' + mark : ''), onclick: () => personSheet(p.id) }, [
        avatar(p.name, p.id),
        el('span', {}, [p.name]),
        isDemoPerson(s, p.id) ? dummyChip() : null,
        st().showRingNames ? el('em', { class: 'lvl' }, [S.ringLabel[p.ring]]) : null,
      ])
      b.style.left = x + 'px'
      b.style.top = y + 'px'
      wrap.appendChild(b)
    })
  }
  const you = el('button', { class: 'node you', 'aria-label': S.meNameAria(s.me.displayName), onclick: () => editNameSheet() }, [avatar(s.me.displayName, s.me.id), el('span', {}, [s.me.displayName])])
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
      el('b', {}, [p.name, isDemoPerson(s, p.id) ? dummyChip() : null]),
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
  // Below the results, always: the same words on the web, as links (wave 2, B8; nothing sent before a tap).
  const web = webSearchRow(searchText, webResults)
  input.addEventListener('input', () => { searchText = input.value; fill(); web.update(searchText) })
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') toggleSearch() })
  fill()
  const curate = el('button', { class: 'menu-item curate-row', onclick: () => go(Screen.Curate) })
  curate.innerHTML = icon('users')
  curate.append(el('span', {}, [el('b', {}, [S.searchCurate]), el('small', {}, [S.searchCurateSub])]))
  // Wave 6 (N8a): this field looks through the people already held; an ask lives in the dock, one tap away.
  const askInstead = el('button', { class: 'btn btn-ghost btn-sm search-ask-instead', 'data-search-ask-instead': '1', onclick: openQuery }, [S.searchAskInstead])
  return el('div', { class: 'scroll pad search' }, [input, el('p', { class: 'meta search-not-ask', 'data-search-not-ask': '1' }, [S.searchNotAsk]), askInstead, curate, results, web.el])
}

function screenWeb(): Node[] {
  const s = st()
  // Call style: a contact search top right (the magnifier is free). Query
  // style: the magnifier means querying, so the top shows the Curate list.
  const search = queryStyle() === QueryStyle.Call
    ? iconButton(searchOpen ? 'x' : 'list', searchOpen ? S.searchClose : S.searchOpen, toggleSearch, 'search-btn' + (searchOpen ? ' on' : ''))
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
  ripple(e)
  if ((e.target as HTMLElement).closest('.node')) return
  const box = wrap.getBoundingClientRect()
  const scale = box.width / RINGS_SIZE
  const dx = (e.clientX - box.left) / scale - RINGS_SIZE / 2
  const dy = (e.clientY - box.top) / scale - RINGS_SIZE / 2
  const dist = Math.hypot(dx, dy)
  const ring = RINGS.reduce((best, r) => (Math.abs(RADIUS[r] - dist) < Math.abs(RADIUS[best] - dist) ? r : best), Ring.Acquaintance)
  // Let the ripple show before the sheet rises over it.
  setTimeout(() => addPersonSheet(ring), RIPPLE_LEAD_MS)
}

/** How long the ripple plays on its own before the add-someone sheet opens. */
const RIPPLE_LEAD_MS = 360

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

/** Opens the query on Web from anywhere: querying is the one thing (Jakob, wave 2, P6/P9), one tap away from Web and Inventory. */
function openQuery(): void {
  queryOpen = true
  searchOpen = false
  if (screen === Screen.Web) render()
  else go(Screen.Web)
}

function queryFab(): HTMLElement {
  const call = queryStyle() === QueryStyle.Call
  const b = el('button', {
    class: 'query-fab' + (call ? ' call' : ''), 'aria-label': call ? S.webCall : S.webQuery, 'data-open-query': '1',
    onclick: openQuery,
  })
  b.innerHTML = icon(call ? 'call' : 'query')
  b.append(call
    ? el('span', { class: 'fab-two' }, [el('span', {}, [S.webCallTop]), el('span', {}, [S.webCallBottom])])
    : el('span', {}, [S.webQuery]))
  if (!call) return b
  const wrapped = withHint(b, HintId.CallWeb)
  if (wrapped !== b) wrapped.classList.add('fab-hint')
  return wrapped
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

/** Demo content says so wherever a person or item shows (owner 2026-10-06: real and dummy friends side by side). */
function dummyChip(): HTMLElement {
  return el('span', { class: 'tagpill dummy-chip' }, [S.dummyChip])
}

/** An item's or a note's source, linked to the past meeting it came from where that is still stored (provenance_view.ts). */
function sourceFor(source: ItemSource | undefined, text: string): HTMLElement | null {
  const m = source?.meetingId ? pastMeetings(st()).find((x) => x.id === source.meetingId) : undefined
  return sourceView(source, {
    meeting: m,
    open: () => { if (m && source) pastMeetingSheet(m, focusFor(m, source, text) ?? undefined, source) },
    when: whenLabel,
  })
}

/** One inventory item: who can ask, and where it came from (the chain of proof). */
function itemSheet(itemId: string): void {
  const s = st()
  const item = s.inventory.find((i) => i.id === itemId)
  if (!item) return
  const redraw = (): void => { save(); render(); itemSheet(item.id) }
  openSheet([
    // Jakob's sketch (10-07, #21/#22): the X top right, the on/off switch below it on the right; then who, then how far.
    el('div', { class: 'item-head' }, [
      el('h3', {}, [item.text, isDemoItem(s, item.id) ? dummyChip() : null]),
      el('div', { class: 'item-head-side' }, [
        el('button', { class: 'x', 'aria-label': S.close, 'data-item-close': '1', onclick: closeSheet }, ['×']),
        onOffSwitch(item.included, () => { item.included = !item.included; redraw() }, { 'data-item-switch': item.id }),
      ]),
    ]),
    el('p', { class: 'meta' }, [S.itemSheetLead]),
    el('p', { class: 'meta' }, [item.included ? S.itemWho(S.audienceLabel[item.audience] ?? S.audienceLabel[Audience.OnlyMe]) : S.itemPaused]),
    ...itemAudienceChooser(item),
    ...degreesChooser(item, (d) => { item.degrees = d; redraw() }),
    sourceFor(item.source, item.text),
    itemContextView(item),
    ...provenanceStateView(item),
    feed.itemExtras(item),
    el('button', { class: 'btn btn-ghost', onclick: closeSheet }, [S.close]),
  ])
}

/** The notes added to this thing as context (wave 5), oldest first, each with when; nothing when there are none. */
function itemContextView(item: InventoryItem): HTMLElement | null {
  const notes = contextOf(item)
  if (!notes.length) return null
  return el('div', { class: 'item-context', 'data-item-context': item.id }, [
    el('h4', { class: 'eyebrow' }, [S.itemContextTitle]),
    ...notes.map((c) => el('div', { class: 'sline' }, [el('span', {}, [c.text]), el('em', {}, [whenLabel(c.at)])])),
  ])
}

/** The item's state (wave 2, B4): unreviewed / from an import, reviewed / created step by step; one tap keeps an imported line. */
function provenanceStateView(item: InventoryItem): HTMLElement[] {
  const state = provenanceState(item.source)
  if (!state) return []
  const line: HTMLElement = el('p', { class: 'meta prov-state', 'data-prov-state': state }, [S.provState[state]])
  if (state !== ProvenanceState.Unreviewed) return [line]
  return [line, el('button', {
    class: 'btn btn-ghost btn-sm', 'data-item-reviewed': item.id,
    onclick: () => { if (markReviewed(item, Date.now())) { save(); render(); toast(S.provReviewedDone) } itemSheet(item.id) },
  }, [S.provReviewed])]
}

/** All four choices on the item's sheet (wave 2, P22): the three tiers and "Only me". */
function itemAudienceChooser(item: InventoryItem): HTMLElement[] {
  return [
    el('h4', { class: 'eyebrow' }, [S.itemAudienceTitle]),
    ...AUDIENCES.map((a) => el('button', {
      class: 'radio' + (item.audience === a ? ' on' : ''), 'aria-pressed': String(item.audience === a), 'data-item-audience': a,
      onclick: () => { item.audience = a; save(); render(); itemSheet(item.id) },
    }, [el('b', {}, [S.audienceLabel[a]]), el('small', {}, [S.audienceHint[a]])])),
  ]
}

function personSheet(personId: string): void {
  const p = st().people.find((x) => x.id === personId)
  if (!p) return
  const current = p.lines.filter((l) => l.status === LineStatus.Current)
  const metaLine = p.ring === Ring.Intending ? S.sheetPlanned(p.context) : S.sheetMet(p.context, coarseWhen(p.metAt))
  openSheet([
    el('h3', {}, [p.name, isDemoPerson(st(), p.id) ? dummyChip() : null]),
    el('div', { class: 'meta' }, [S.ringLabel[p.ring] + ' · ' + metaLine]),
    el('div', { class: 'path' }, [p.peerId ? S.sheetConnected : S.sheetNotesOnly]),
    current.length
      ? el('div', { class: 'sheet-lines' }, current.map((l) => el('div', { class: 'sline', 'data-line': l.id }, [
          tagChip(l.tag, l.customTag), el('span', {}, [l.text]), el('em', {}, [S.audienceLabel[l.audience]]),
          sourceFor(l.source, l.text),
        ])))
      : el('p', { class: 'meta' }, [S.sheetNoNotes]),
    current.length ? el('button', { class: 'btn btn-electric', onclick: () => startReview(p.id) }, [S.sheetStillTrue]) : null,
    el('button', { class: 'btn btn-ghost', onclick: () => startDraftFor(p.id) }, [S.sheetAddNote]),
    // Wave 6 (U4 c): every note line and past meeting about them, per day, searchable (person_notes.ts).
    past.personSection(p.id, { label: p.name, go: () => personSheet(p.id) }),
    el('button', { class: 'btn btn-ghost', onclick: () => ringSheet(p) }, [S.sheetChangeRing]),
    p.peerId ? passOnRow(p, (next) => { p.passOn = next; save(); personSheet(p.id) }) : null,
    p.peerId ? el('button', { class: 'btn btn-electric', 'data-chat-open': p.id, onclick: () => chatSheet(p.id) }, [S.chatOpen]) : null,
    sharedReachRow(p),
    channelsView(personChannels(p), { title: S.chTitle, add: S.chAddOther, hint: S.chHint }),
    // Their Mastodon or Pixelfed address only feeds the Feed: shown while the Feed is on (wave 2, P9).
    feedOn(st()) ? feed.personRow(p) : null,
  ])
}

/** "Message on Signal / Molly" for a link the person SHARED when we connected (the owner's own typed links already show in channelsView). */
function sharedReachRow(p: Person): HTMLElement | null {
  const r = primaryReachable(p)
  if (!r || r.source !== 'theirs') return null
  return el('div', { class: 'ch-row shared' }, [
    el('a', { class: 'btn btn-ghost', href: r.link, target: '_blank', rel: 'noopener noreferrer' }, [S.chatMessageOn(reachLabel(r))]),
    el('p', { class: 'meta' }, [S.chSharedBy(p.name)]),
  ])
}

/** Where a set of messenger handles lives: a person's card, or my own contact info. */
interface ChannelOwner {
  get(): Partial<Record<Channel, string>>
  set(ch: Channel, value: string | null): void
  /** The app named for the Signal entry of this owner (label only). */
  provider?(): SignalProvider | undefined
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
    provider: () => p.signalProvider,
  }
}

function myChannels(): ChannelOwner {
  return {
    get: () => st().myChannels ?? {},
    set: (ch, value) => {
      const s = st()
      const previous = s.myChannels?.[ch]
      const next = { ...(s.myChannels ?? {}) }
      if (value) next[ch] = value; else delete next[ch]
      s.myChannels = next
      // Records the visible default tick once (a username link only); a username-link tick is RESET when the value becomes a phone number.
      if (value) s.contactShare = settleDefaultTick(s.contactShare, ch, value, previous)
      else if (s.contactShare?.shareOnConnect) delete s.contactShare.shareOnConnect[ch] // a removed link is no longer shared
      save()
    },
    provider: () => st().contactShare?.signalProvider,
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

/** Signal's link opens Molly where it is installed instead; Molly exists on Android only (A2), so only there it is named. */
/** Unset provider = exactly the old behaviour: Android names both apps (Signal's link may open Molly), elsewhere Signal. A chosen provider names that app. */
const chName = (ch: Channel, provider?: SignalProvider): string =>
  ch === Channel.Signal ? S.chProviderLabel[signalLabelKey(provider, /Android/i.test(navigator.userAgent))] : S.chLabel[ch]
const reachLabel = (r: Reachable): string => chName(r.channel, r.provider)

const NO_CHATS: ChatBook = {}

const chatStrings = (): ChatStrings => ({
  title: S.chatTitle, messageOn: (r) => S.chatMessageOn(reachLabel(r)), notConnected: S.chatNotConnected, empty: S.chatEmpty,
  offline: S.chatOffline, placeholder: S.chatPlaceholder, send: S.chatSend, sendAgain: S.chatSendAgain, pending: S.chatPending,
  sent: S.chatSent, charsLeft: S.chatCharsLeft, you: S.chatYou,
})

const shareStrings = (): ShareStrings => ({
  tickLabel: S.shareTick, tickPhoneNote: S.shareTickPhone, tickHint: S.shareTickHint,
  providerLabel: S.providerLabel, providerNames: S.providerNames, providerHint: S.providerHint,
})

/** The provider + "share when we connect" controls under my saved Signal link (Meet page and the "Your Signal" sheet). */
function shareControlsFor(ch: Channel): HTMLElement {
  return renderShareControls({
    doc: document, channel: ch,
    getHandle: () => st().myChannels?.[ch],
    getSettings: () => st().contactShare,
    setSettings: (next) => { st().contactShare = next; save() },
    S: shareStrings(),
  })
}

/** Chat I/O for chat_view.ts: the book lives in state.chats; setBook skips a save when nothing changed (markRead returns the same object). */
function chatIo(): ChatIo {
  return {
    getBook: () => st().chats ?? NO_CHATS,
    setBook: (b) => { const s = st(); if (b !== NO_CHATS && b !== s.chats) { s.chats = b; save() } },
    send: async (peerId, text, sentAt) => {
      const peer = st().peers.find((p) => p.id === peerId)
      if (!peer) throw new Error('not connected')
      await net.sendText(peer, text, sentAt)
    },
    now: Date.now,
  }
}

/** Sends what the owner ticked to one newly connected peer. Never to demo accounts or demo phones; once per change (contactSent). */
function sendContactTo(peer: Peer): void {
  if (isDemoPersona(persona) || demoAccounts().some((t) => t.peerId === peer.id)) return
  const s = st()
  const out = contactToSend(APP_URL, s.myChannels, s.contactShare, s.contactSent?.[peer.id])
  if (!out) return
  net.sendText(peer, out.text).then(() => {
    s.contactSent = { ...s.contactSent, [peer.id]: out.fingerprint }
    save()
  }).catch(() => { /* the relay was down: it is tried again at the next connect */ })
}

let openChat: { peerId: string; refresh(): void } | null = null

function chatSheet(personId: string): void {
  const p = st().people.find((x) => x.id === personId)
  if (!p) return
  const handle = renderChat({ ...chatIo(), doc: document, person: { name: p.name, peerId: p.peerId, reach: primaryReachable(p) }, S: chatStrings(), isOnline: () => relayStatus === 'connected' })
  openSheet([handle.el])
  if (p.peerId) openChat = { peerId: p.peerId, refresh: handle.refresh }
}

/** Relay back up: send everything that waited. */
async function flushAllChats(): Promise<void> {
  if (!state) return
  for (const id of peersWithPending(st().chats ?? NO_CHATS)) await flushPending(chatIo(), id)
  // An open chat shows "Waiting" until it is redrawn from the book the flush just updated.
  openChat?.refresh()
}

/** A contact text can beat the card on the scanning phone (the card is made after completeConnect returns): hold it, apply it when the card exists. */
const heldContacts: HeldContacts = new Map()

function applyContact(peer: Peer, person: Person, text: string): void {
  if (!receiveContactText(APP_URL, person, text, Date.now())) return
  save()
  toast(S.contactReceivedToast(peer.displayName))
  render()
}

/** Call right after a card for `peer` exists (onPeerConnected, completePendingConnect). */
function applyHeldContact(peer: Peer, person: Person): void {
  const text = takeContact(heldContacts, peer.id)
  if (text) applyContact(peer, person, text)
}

function onContactText(peer: Peer, text: string): void {
  const person = st().people.find((p) => p.peerId === peer.id)
  if (person) applyContact(peer, person, text)
  else holdContact(heldContacts, peer.id, text)
}

function onChatText(peer: Peer, text: string, ts: number): void {
  const s = st()
  const r = receiveText(s.chats ?? NO_CHATS, peer.id, text, ts, Date.now())
  if (!r.message) return
  s.chats = r.book
  save()
  if (openChat?.peerId === peer.id) { openChat.refresh(); return }
  notify(S.chatNotifBody(peer.displayName))
  toast(S.chatNewToast(peer.displayName))
}

/** Net onText: share link / contact payload / chat message; malformed protocol text is shown nowhere. */
function onIncomingText(peer: Peer, text: string, ts: number): void {
  switch (routeText(APP_URL, text)) {
    case TextKind.Share: onSharedText(peer, text); return
    case TextKind.Contact: onContactText(peer, text); return
    case TextKind.Keep: onKeepText(peer, text); return
    case TextKind.Chat: onChatText(peer, text, ts); return
    case TextKind.Ignore: return
  }
}

function channelRow(owner: ChannelOwner, ch: Channel, edit: boolean, redraw: (edit?: Channel) => void): HTMLElement {
  const value = owner.get()[ch]
  const label = el('span', { class: 'ch-name ch-' + ch }, [chName(ch, owner.provider?.())])
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
    el('a', { class: 'ch-open', href: channelLink(ch, value), target: '_blank', rel: 'noopener noreferrer' }, [S.chOpen(chName(ch, owner.provider?.()))]),
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
  // Never the microphone and a past meeting's playback at once.
  past.stopPlayer()
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
    const open = draft.pauses[draft.pauses.length - 1]
    if (open && open.forMs === null) open.forMs = Date.now() - open.startedAt
    void keepScreenOn()
  } else {
    draft.pauses.push({ afterSegments: draft.segments.length, atMs: totalMs() + recorder.elapsed(), startedAt: Date.now(), forMs: null })
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

function roundButton(name: string, label: string, onclick: () => void, opts: { disabled?: boolean; cls?: string; data?: string } = {}): HTMLElement {
  const b = el('button', { class: 'round' + (opts.cls ? ' ' + opts.cls : ''), 'aria-label': label, title: label, disabled: Boolean(opts.disabled), onclick, ...(opts.data ? { [opts.data]: '1' } : {}) })
  b.innerHTML = icon(name)
  return b
}

/**
 * "Who or what was this about?": a person (an existing one or a new name) or
 * a thing (an inventory item or a new topic). What you type decides it when
 * it matches a person or an item; otherwise the kind you picked stays. Then `next`.
 */
function aboutSheet(next?: () => void, kind: AboutKind = draft.about): void {
  const who = kind === AboutKind.Who
  const title = who ? S.aboutTitle : S.aboutWhatTitle
  const input = el('input', { class: 'field', placeholder: who ? S.recWhoPh : S.aboutWhatPh, value: draft.plain ? '' : draft.name, maxlength: '60', 'aria-label': title })
  const done = (): void => {
    const v = input.value.trim()
    if (!v) { input.focus(); return }
    const person = st().people.find((p) => p.name.toLowerCase() === v.toLowerCase())
    const item = st().inventory.find((i) => i.text.toLowerCase() === v.toLowerCase())
    draft.about = person ? AboutKind.Who : item ? AboutKind.What : kind
    draft.name = person?.name ?? item?.text ?? v
    draft.personId = draft.about === AboutKind.Who ? person?.id : undefined
    // An existing thing picked under "what": the notes become context on it, not a new line (wave 5).
    draft.itemId = draft.about === AboutKind.What ? item?.id : undefined
    draft.plain = false
    if (person) draft.ring = person.ring
    closeSheet()
    if (next) next(); else render()
  }
  // "None of these" (wave 5): about neither a person nor a thing. Kept as a plain note, no link.
  const none = (): void => {
    draft.plain = true
    draft.name = ''
    draft.personId = undefined
    draft.itemId = undefined
    closeSheet()
    if (next) next(); else render()
  }
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') done() })
  const picks = who
    ? [...st().people].sort((a, b) => b.metAt - a.metAt).slice(0, 6).map((p) => p.name)
    : [...st().inventory].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6).map((i) => i.text)
  openSheet([
    el('h3', { class: who ? 'about-who-ink' : 'about-what-ink' }, [title]),
    input,
    !who && picks.length ? el('p', { class: 'meta about-ctx-hint' }, [S.aboutContextHint]) : null,
    picks.length ? el('div', { class: 'chips' }, picks.map((t) => el('button', {
      class: 'chip', onclick: () => { input.value = t; done() },
    }, [t]))) : null,
    el('button', { class: 'btn btn-electric', onclick: done }, [S.aboutOk]),
    el('button', { class: 'btn btn-ghost about-none', 'data-about-none': '1', onclick: none }, [S.aboutNone]),
  ])
  setTimeout(() => input.focus(), 320)
}

/** The About row: "Who or what was this about?", each word pressable in its colour. */
function aboutRowView(): HTMLElement {
  const pick = (k: AboutKind): void => { draft.about = k; aboutSheet(undefined, k) }
  const whoBtn = el('button', {
    class: 'about-kind who' + (draft.about === AboutKind.Who ? ' on' : ''), 'aria-pressed': String(draft.about === AboutKind.Who),
    onclick: () => pick(AboutKind.Who),
  }, [S.aboutWho])
  const whatBtn = el('button', {
    class: 'about-kind what' + (draft.about === AboutKind.What ? ' on' : ''), 'aria-pressed': String(draft.about === AboutKind.What),
    onclick: () => pick(AboutKind.What),
  }, [S.aboutWhat])
  const name = draft.name.trim()
  return el('div', { class: 'memo-row about-row ' + draft.about }, [
    el('span', { class: 'about-q' }, [withHint(whoBtn, HintId.AboutWho), S.aboutOr, withHint(whatBtn, HintId.AboutWhat), S.aboutTail]),
    name ? el('button', { class: 'about-value', onclick: () => aboutSheet() }, [name]) : null,
    !name && draft.plain ? el('button', { class: 'about-value about-none-value', onclick: () => aboutSheet() }, [S.aboutNoneValue]) : null,
  ])
}

/**
 * "General notes" (wave 5, owner 2026-10-07): a quick place to type at once, on Record and Meeting WITHOUT opening Advanced,
 * above the Opportunity / Resource / Looking for / Can offer / Talent fields. What is typed lives on the draft as it is typed
 * (no redraw, so the caret stays), becomes one note line when the notes are made, and rides on the stored meeting.
 */
function generalNotesView(): HTMLElement {
  const input = el('textarea', {
    class: 'field general-notes', rows: '3', maxlength: String(GENERAL_NOTES_MAX), placeholder: S.generalNotesPh,
    'aria-label': S.generalNotesTitle, 'data-general-notes': '1',
  })
  input.value = draft.generalNotes
  input.addEventListener('input', () => { draft.generalNotes = input.value; syncRecordControls() })
  return el('div', { class: 'general-notes-sec' }, [el('h4', { class: 'eyebrow' }, [S.generalNotesTitle]), input])
}

/** Send and Discard follow what is typed, without redrawing the screen (a redraw would take the caret away). */
function syncRecordControls(): void {
  const live = recorder.live
  const has = takes.length > 0
  const send = document.querySelector<HTMLButtonElement>('.memo-controls .round[data-record-send]')
  const discard = document.querySelector<HTMLButtonElement>('.memo-controls .round[data-record-discard]')
  if (send) send.disabled = !live && !has && !draft.extraLines.length && !draft.generalNotes.trim()
  if (discard) discard.disabled = !live && !has && !draft.name.trim() && !draft.generalNotes.trim() && !draft.plain
}

/** Record > Advanced: lines to note by hand, by kind; folded away until asked for. */
const ADVANCED_TAGS: readonly Tag[] = [Tag.Opportunity, Tag.Resource, Tag.Looking, Tag.Offer, Tag.Talent]
let recAdvancedOpen = false

function recAdvancedView(): HTMLElement {
  const toggle = el('button', {
    class: 'adv-toggle', 'aria-expanded': String(recAdvancedOpen),
    onclick: () => { recAdvancedOpen = !recAdvancedOpen; render() },
  }, [S.recAdvanced, el('span', { class: 'chev', 'aria-hidden': 'true' }, [recAdvancedOpen ? '▴' : '▾'])])
  if (!recAdvancedOpen) return el('div', { class: 'adv' }, [withHint(toggle, HintId.RecAdvanced)])
  const sections = ADVANCED_TAGS.map((tag) => {
    const input = el('input', { class: 'field', placeholder: S.recAdvancedAdd(S.tagLabel[tag]), maxlength: '160', 'aria-label': S.recAdvancedAdd(S.tagLabel[tag]) })
    const add = (): void => {
      const text = input.value.trim()
      if (!text) return
      // During a take the line is stamped with the take's current moment (the chain of proof, provenance.ts).
      draft.extraLines.push({ id: randomId(8), text, tag, audience: Audience.Friends, ...(recorder.live ? { atMs: totalMs() + recorder.elapsed() } : {}) })
      render()
      document.querySelector<HTMLInputElement>(`[data-adv="${tag}"] input`)?.focus()
    }
    input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') add() })
    const mine = draft.extraLines.filter((l) => l.tag === tag)
    return el('div', { class: 'adv-sec', 'data-adv': tag }, [
      el('h4', { class: 'eyebrow' }, [S.tagLabel[tag]]),
      ...mine.map((l) => el('div', { class: 'adv-line' }, [
        el('span', {}, [l.text]),
        el('button', { class: 'x', 'aria-label': S.remove, onclick: () => { draft.extraLines = draft.extraLines.filter((x) => x !== l); render() } }, ['×']),
      ])),
      input,
    ])
  })
  return el('div', { class: 'adv open' }, [
    withHint(toggle, HintId.RecAdvanced),
    engine !== null && (recorder.live || takes.length > 0) ? el('p', { class: 'tr-engine' }, [engineLabel()]) : null,
    el('p', { class: 'hint' }, [draft.mode === RecordMode.Solo ? S.recSoloHint : S.promptHint]),
    ...sections,
  ])
}

/**
 * "Listen for": prompts for what to note or create while recording (owner
 * 2026-10-06: "the recording has hints as to what to write and create"). A tap
 * opens that section of Advanced with its field focused; a section that
 * already holds a line shows as on.
 */
function recPromptsView(): HTMLElement {
  return el('div', { class: 'rec-prompts', role: 'group', 'aria-label': S.promptLabel }, [
    el('span', { class: 'chips-lbl' }, [S.promptLabel]),
    ...ADVANCED_TAGS.map((tag) => el('button', {
      class: 'chip prompt' + (draft.extraLines.some((l) => l.tag === tag) ? ' on' : ''), 'data-prompt': tag,
      onclick: () => {
        recAdvancedOpen = true
        render()
        const input = document.querySelector<HTMLInputElement>(`[data-adv="${tag}"] input`)
        input?.scrollIntoView({ block: 'center' })
        input?.focus()
      },
    }, [S.promptFor[tag]])),
  ])
}

// ---------------------------------------------------------------------------
// past meetings: every meeting ended and every memo saved, with its place,
// notes and transcript, openable again (owner 2026-10-06)
// ---------------------------------------------------------------------------

/** Past meetings on screen and their kept audio: past_meetings_view.ts, with these hooks. */
const past = createPastMeetings({
  state: st, save, sheet, openSheet, toast, audio: audioStore, personSheet, tagChip, dummyChip,
  transcriptRow, icon, clockLong,
  extra: (m) => transcription.meetingExtras(m),
  opened: (m) => packs.checkOne(m),
  removed: (m) => hosting.removed(m.id),
})

// The Swiss server's newer services (wave 1733 round B): never on a demo phone or a demo account.
const swiss = createSwissContext({ state: st, save, enabled: () => !solo && !isDemoPersona(persona) && Boolean(state) && !state?.testOf })
const transcription = createTranscriptionView({
  ctx: swiss, state: st, save, audio: audioStore, openSheet, closeSheet, toast, onJobChange, when: whenLabel,
  uploadPack: async (keyText, pack) => { await backupNow(parseKeyText(keyText), pack) },
  fromName: () => st().me.displayName,
})
const hosting = createHostingView({
  ctx: swiss, state: st, save, audio: audioStore, sheet, openSheet, toast, when: whenLabel,
  redrawSettings: () => { if (sheet.dataset.kind === 'settings' && sheet.classList.contains('on')) settingsSheet() },
  openSettings: () => settingsSheet(),
})
const images = new ImageStore(persona, storeCtx)
const feed = createFeedView({
  state: st, save, openSheet, closeSheet, toast, images, avatar, dummyChip, personSheet, itemSheet,
  openShare: (id) => { const r = st().received?.find((x) => x.id === id); const l = r ? parseShareText(APP_URL, r.link) : null; if (r && l) void openShare(l, r) },
  openMeeting: (id) => { const m = pastMeetings(st()).find((x) => x.id === id); if (m) pastMeetingSheet(m) },
  redrawFeed: () => { if (screen === Screen.Feed) render() },
  tabsChanged: () => { renderTabs(); if (screen === Screen.Feed && !feedOn(st())) screen = Screen.Web; render() },
  settings: settingsSheet,
})
const packs = createPackView({
  state: st, save, sheet, openSheet, closeSheet, toast, render, transcriptView: past.transcriptView, cap: past.cap, when: whenLabel,
  onMeetingChange: (m) => past.refresh(m),
})

/**
 * Web results inside the app (wave 3): on the real app only, like the other
 * server services (never on a demo phone or account: no imaginary person
 * spends the operator's search budget); the yes is remembered per engine.
 */
const webResults: WebResultsHooks = {
  enabled: () => swiss.enabled(),
  consented: (id) => webConsents(st()).includes(id),
  consent: (id) => { giveWebConsent(st(), id); save() },
}

/** The takes of this draft as the server job wants them: one timeline, end to end. */
function jobTakes(): JobTake[] {
  let offsetMs = 0
  return takes.map((t) => { const j = { blob: t.blob, mimeType: t.mimeType, offsetMs, durationMs: t.durationMs }; offsetMs += t.durationMs; return j })
}

/** The recording just ended with no transcript: the Swiss server transcribes it where the person chose so (stored first). */
function serverAfterTake(): void {
  if (!transcribing || draft.segments.length || !takes.length || !transcription.willTranscribe()) return
  recordPastMeeting()
  const m = st().meetings?.find((x) => x.id === draft.meetingId)
  if (m) transcription.start(m, jobTakes())
}

/** A server job changed a meeting: the draft takes its transcript (Review picks lines from it), screens redraw. */
function onJobChange(m: PastMeeting): void {
  if (draft.meetingId === m.id && m.serverJob?.state === ServerJobState.Done && !draft.segments.length && m.transcript.length) {
    draft.segments = m.transcript.map((t, i) => ({ id: `srv${i}`, speaker: t.speaker, text: t.text, atMs: t.atMs, final: true }))
    if (screen === Screen.Review) {
      // The stand-in "Voice memo ... to transcribe later" goes; the transcript's lines come in with their moments.
      const memo = S.memoLine(clock(totalMs()))
      const have = new Set(draft.lines.map((l) => l.text))
      draft.lines = [
        ...draft.lines.filter((l) => l.text !== memo),
        ...linesFromTranscript(draft.segments).filter((l) => !have.has(l.text)).map((l) => ({ id: randomId(8), text: l.text, tag: l.tag, audience: Audience.Friends, atMs: l.atMs, line: l.line })),
      ]
    }
  }
  past.refresh(m)
  if (screen === Screen.Record || screen === Screen.Meeting || screen === Screen.Review) render()
}
const pastMeetingsLink = (): HTMLElement => past.link()
const pastMeetingSheet = (m: PastMeeting, focus?: PastFocus, from?: ItemSource): void => past.open(m, focus, from)

/** Opens on Record and Meeting, in the header slot where Web has its contact search. */
function pastSearchButton(): HTMLElement {
  return iconButton(pastSearchOpen ? 'x' : 'search', pastSearchOpen ? S.searchPastClose : S.searchPastOpen, togglePastSearch, 'search-btn past-search-btn' + (pastSearchOpen ? ' on' : ''))
}

function togglePastSearch(): void {
  pastSearchOpen = !pastSearchOpen
  if (!pastSearchOpen) pastSearchText = ''
  render()
  if (pastSearchOpen) document.querySelector<HTMLInputElement>('.past-search-field')?.focus()
}

function pastSearchView(): HTMLElement {
  return past.searchView(pastSearchText, (q) => { pastSearchText = q }, togglePastSearch)
}

/** Is there anything of this draft worth keeping as a past meeting (a take, a transcript, or a meeting at all)? */
function draftIsMeeting(): boolean {
  // Typed General notes alone are worth keeping too (a notes-only memo has no take): the stored meeting holds them.
  return Boolean(draft.meetingId) || takes.length > 0 || draft.segments.length > 0 || draft.mode === RecordMode.Meeting || Boolean(draft.generalNotes.trim())
}

/** Was this draft a meeting (rather than a memo by yourself)? The stored meeting knows, even after a switch to "Just me". */
function draftWasMeeting(): boolean {
  const stored = draft.meetingId ? st().meetings?.find((m) => m.id === draft.meetingId) : undefined
  return stored?.meeting ?? draft.mode === RecordMode.Meeting
}

/**
 * Writes the stored past meeting for the current draft, or completes the one
 * End meeting already wrote: the transcript at End meeting, the notes and the
 * person at save. Never loses what was recorded, whatever happens after.
 */
function recordPastMeeting(opts: { personId?: string } = {}): void {
  const s = st()
  const existing = draft.meetingId ? (s.meetings ?? []).find((m) => m.id === draft.meetingId) : undefined
  const m: PastMeeting = existing ?? {
    id: randomId(8), about: '', kind: draft.about, where: '', startedAt: takes[0]?.startedAt ?? Date.now(), endedAt: Date.now(),
    durationMs: 0, meeting: draft.mode === RecordMode.Meeting, lines: [], transcript: [],
  }
  m.about = draft.name.trim() || (draft.plain ? S.pastPlainAbout : m.about || S.pastUnnamed)
  m.kind = draft.about
  // Both follow the draft as it is now (a meeting stored at End meeting is completed later): emptied General notes, or a plain
  // note that was then given a name, must not keep the old value.
  const general = cleanGeneralNotes(draft.generalNotes)
  if (general) m.generalNotes = general; else delete m.generalNotes
  if (draft.plain) m.plain = true; else delete m.plain
  m.where = draft.context.trim() || m.where
  m.endedAt = Date.now()
  m.durationMs = Math.max(m.durationMs, totalMs())
  m.meeting = m.meeting || draft.mode === RecordMode.Meeting
  const lines = draft.lines.filter((l) => l.text.trim()).map((l) => ({
    text: l.text.trim(), tag: l.tag, audience: l.audience, ...(l.atMs === undefined ? {} : { atMs: l.atMs }), ...(l.line === undefined ? {} : { line: l.line }),
  }))
  if (lines.length) m.lines = lines
  const transcript = draft.segments.map((x) => ({ speaker: x.speaker, atMs: x.atMs, text: x.text }))
  if (transcript.length) m.transcript = transcript
  if (opts.personId) m.personId = opts.personId
  if (!existing) s.meetings = past.cap([m, ...(s.meetings ?? [])])
  draft.meetingId = m.id
  save()
  // The audio stays on this phone with the meeting (capped, audio_store.ts); never in the record itself.
  if (takes.length) void past.keepAudio(m.id, [...takes]).then(() => hosting.afterKeep(m.id))
}

// ---------------------------------------------------------------------------
// sending a meeting inside TrustWeb (share.ts): packed here, encrypted on the
// Swiss server, the key only in the link; to a connected peer, or in the Meet code
// ---------------------------------------------------------------------------

const RECEIVED_MAX = 20
/** The pack made for this draft's Meet code, uploaded once per Meet visit. */
let meetShare: ShareLink | null = null

/** The stored meeting of this draft, if End meeting (or a server job) already wrote it. */
function draftMeeting(): PastMeeting | undefined {
  return draft.meetingId ? st().meetings?.find((m) => m.id === draft.meetingId) : undefined
}

function packFromDraft(): MeetingPack {
  const prose = [meetingToNoteText(draft.segments), draft.text].filter((t) => t.trim()).join('. ')
  const notes = (draft.lines.length ? draft.lines.filter(travelsInPack).map((l) => l.text) : extractLines(prose).map((l) => l.text))
    .concat(draft.extraLines.map((l) => l.text))
    .map((t) => t.trim()).filter((t, i, all) => Boolean(t) && all.indexOf(t) === i)
  return {
    v: 1, kind: 'meeting', from: st().me.displayName, about: draft.name.trim(), where: draft.context.trim(),
    startedAt: takes[0]?.startedAt ?? Date.now(), durationMs: totalMs(), notes,
    transcript: draft.segments.map((x) => ({ speaker: x.speaker, atMs: x.atMs, text: x.text })),
    // The Swiss server is still transcribing it: the full version replaces this one under the same key (late_pack.ts).
    ...(transcriptStillComing(draftMeeting()) ? { pending: true } : {}),
  }
}

/**
 * Encrypts the pack with a fresh key on the backup server; the key never leaves this phone except inside the link.
 * A pack whose transcript is still arriving keeps its key with the meeting until the full version went out (A3).
 */
async function uploadPack(pack: MeetingPack): Promise<ShareLink> {
  if (backup.available() === null) await backup.probe()
  if (!backup.available()) throw new Error('no backup server')
  const key = await newRandomKey()
  await backupNow(key, pack)
  const link = { keyText: key.text, title: S.shareTitleFor(pack.about) }
  const m = draftMeeting()
  if (pack.pending && m) {
    addToOutbox(m, { keyText: key.text, title: link.title, notes: pack.notes, at: Date.now() })
    save()
  }
  return link
}

/** End meeting > "Send inside TrustWeb to...": pick one connected person; they get the sealed link over the relay. */
function sendMeetingSheet(): void {
  const s = st()
  const msg = el('p', { class: 'meta' }, [S.shareLead])
  let busy = false
  const run = async (peer: Peer): Promise<void> => {
    if (busy) return
    busy = true
    msg.textContent = S.shareWorking
    try {
      const pack = packFromDraft()
      const link = await uploadPack(pack)
      await net.sendText(peer, shareUrl(APP_URL, link))
      closeSheet()
      toast(pack.pending ? S.shareSentPending(peer.displayName) : S.shareSent(peer.displayName))
    } catch {
      busy = false
      msg.textContent = S.shareFailed
    }
  }
  const demoPeerIds = new Set(demoAccounts().map((t) => t.peerId))
  const rows = s.peers.map((peer) => el('button', { class: 'prow', 'data-send-to': peer.id, onclick: () => void run(peer) }, [
    avatar(peer.displayName, peer.id),
    el('div', { class: 'who' }, [
      el('b', {}, [peer.displayName, demoPeerIds.has(peer.id) ? el('span', { class: 'tagpill demo-chip' }, [S.demoAcctChip]) : null]),
      el('i', {}, [S.ringLabel[peer.ring]]),
    ]),
  ]))
  openSheet([
    el('h3', {}, [S.shareTitle]),
    msg,
    rows.length ? el('div', { class: 'ppl' }, rows) : el('p', { class: 'warn' }, [S.shareNoPeers]),
  ])
}

/** The pack for the Meet code shown right after a meeting; null where there is nothing recorded or no server. */
async function meetSharePack(): Promise<ShareLink | null> {
  if (meetFrom !== Screen.Meeting || (!draft.segments.length && !takes.length)) return null
  try {
    meetShare ??= await uploadPack(packFromDraft())
    return meetShare
  } catch {
    return null
  }
}

/** A connected peer sent a text: only a share link to this very app is understood; anything else is dropped. */
function onSharedText(peer: Peer, text: string): void {
  const link = parseShareText(APP_URL, text)
  if (!link) return
  const s = st()
  const entry: ReceivedShare = { id: randomId(8), at: Date.now(), fromName: peer.displayName, fromPeerId: peer.id, link: text, title: link.title }
  s.received = [entry, ...(s.received ?? [])].slice(0, RECEIVED_MAX)
  save()
  notify(S.recvTitle(peer.displayName))
  showNotice(S.recvTitle(peer.displayName), S.recvBody(link.title), [
    el('button', { class: 'btn btn-electric btn-sm', onclick: () => { hideNotice(); void openShare(link, entry) } }, [S.recvOpen]),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: hideNotice }, [S.recvLater]),
  ])
}

const openShare = (link: ShareLink, entry?: ReceivedShare): Promise<void> => packs.open(link, entry)

/** A share link opened directly (not inside a connect link): once the app has a record. */
function maybeOpenPendingShare(): void {
  if (!pendingShare || pendingConnect || !state) return
  const link = pendingShare
  pendingShare = null
  void openShare(link)
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
  if (!takes.length && !draft.extraLines.length && !draft.generalNotes.trim()) return
  const next = (): void => { serverAfterTake(); void makeNotes() }
  if (!draft.name.trim() && !draft.plain) { aboutSheet(next); return }
  next()
}

function screenRecord(): Node[] {
  const live = recorder.live
  const paused = recorder.paused
  // Icon only, in the slot ⋮ has on Web, so the QR keeps its exact place (owner 2026-10-06: muscle memory).
  const meeting = withHint(iconButton('meet', S.recMeeting, () => { if (!live) { draft.mode = RecordMode.Meeting; recNotice = ''; go(Screen.Meeting) } else toast(S.recSwitchWhileLive) }, 'meet-btn'), HintId.Meeting)
  const has = takes.length > 0
  const circle = el('button', {
    class: 'rec-circle' + (live && !paused ? ' live' : '') + (paused ? ' paused' : ''),
    'aria-label': live ? (paused ? S.recResume : S.recPause) : S.recStart,
    onclick: () => { if (live) togglePause(); else void startSolo() },
  })
  const status = live ? (paused ? S.recPausedHint : S.recLive) : has ? S.recDone(clock(totalMs()), takes.length) : S.recIdle
  if (pastSearchOpen) return [header(S.recTitle, { right: pastSearchButton(), after: meeting, pill: false }), pastSearchView()]
  return [
    header(S.recTitle, { right: pastSearchButton(), after: meeting, pill: false }),
    el('div', { class: 'scroll pad memo' }, [
      el('div', { class: 'memo-hero' }, [
        circle,
        el('span', { class: 'rec-clock', id: 'rec-clock' }, [clock(totalMs() + recorder.elapsed())]),
      ]),
      el('p', { class: 'rec-status center' }, [status]),
      recNotice ? el('p', { class: 'warn' }, [recNotice]) : null,
      aboutRowView(),
      recPromptsView(),
      generalNotesView(),
      recAdvancedView(),
      draft.segments.length || transcriber
        ? el('div', { class: 'tr-list memo-tr', id: 'tr-list', 'aria-live': 'polite' }, transcriptRows(S.trEmpty))
        : null,
      pastMeetingsLink(),
    ]),
    el('div', { class: 'memo-controls' }, [
      // The circle above records, pauses and resumes (owner 2026-10-06: no separate play button).
      roundButton('x', S.recDiscard, discardDraft, { disabled: !live && !has && !draft.name.trim() && !draft.generalNotes.trim() && !draft.plain, data: 'data-record-discard' }),
      roundButton('send', S.recSend, () => void sendSolo(), { disabled: !live && !has && !draft.extraLines.length && !draft.generalNotes.trim(), data: 'data-record-send' }),
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

/** How close to the bottom still counts as following the live transcript. */
const PIN_SLACK_PX = 24

async function ensureEngine(): Promise<TranscriberEngine> {
  if (engine !== null) return engine
  const choice = transcriptionChoice(st())
  const live = (c: TranscriptionChoice): Promise<TranscriberEngine> => detectEngine(enginePlan(c)).catch(() => TranscriberEngine.None)
  // Wave 3: only the server button's choice ever sends audio away; "Automatic" and the rest stay on this side.
  if (choice !== TranscriptionChoice.Server) {
    engine = await live(choice)
    return engine
  }
  // The server transcribes when the take stops; while it is off, or its route is not the one the yes was for, the live engines stand in.
  await swiss.probe()
  engine = transcription.willTranscribe() ? TranscriberEngine.None : await live(TranscriptionChoice.Auto)
  if (transcription.serverOff()) recNotice = S.trServerOff
  else if (transcription.needsYesAgain()) recNotice = S.trServerAskAgain
  return engine
}

function onSegment(seg: Segment): void {
  const i = draft.segments.findIndex((x) => x.id === seg.id)
  if (i >= 0) draft.segments[i] = seg; else draft.segments.push(seg)
  if (screen !== Screen.Meeting && screen !== Screen.Record) return
  const list = document.getElementById('tr-list')
  if (!list) return
  // Follow the live line only while the reader is at the bottom (from TalkWeave):
  // scrolling up to reread is never yanked back down.
  const scroller = list.closest('.scroll')
  const pinned = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < PIN_SLACK_PX
  const row = transcriptRow(seg)
  const old = list.querySelector(`[data-seg="${CSS.escape(seg.id)}"]`)
  if (old) old.replaceWith(row); else list.append(row)
  list.querySelector('.tr-empty')?.remove()
  if (pinned) row.scrollIntoView({ block: 'nearest' })
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
  // The transcript is kept the moment the meeting ends, whatever happens next.
  if (draftIsMeeting()) recordPastMeeting()
  serverAfterTake()
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
    el('button', { class: 'btn btn-ghost', onclick: sendMeetingSheet }, [S.shareButton]),
    el('button', { class: 'btn btn-ghost', onclick: () => void makeNotes() }, [S.recMake]),
    takes.length ? el('div', { class: 'rec-saves' }, saveButtons('btn btn-ghost btn-sm')) : null,
    el('p', { class: 'meta' }, [S.meetingSendHonest]),
  ])
}

/** The transcript in order, with a divider wherever the recording was paused. */
function transcriptRows(empty: string): HTMLElement[] {
  if (!draft.segments.length && !draft.pauses.length) return [el('p', { class: 'tr-empty' }, [empty])]
  const rows: HTMLElement[] = []
  const pauseRow = (p: PauseMark): HTMLElement => el('p', { class: 'tr-pause', role: 'separator' }, [
    S.trPause(clockLong(p.atMs), p.forMs === null ? null : Math.max(1, Math.round(p.forMs / 1000))),
  ])
  let next = 0
  draft.segments.forEach((seg, i) => {
    while (next < draft.pauses.length && draft.pauses[next].afterSegments <= i) rows.push(pauseRow(draft.pauses[next++]))
    rows.push(transcriptRow(seg))
  })
  while (next < draft.pauses.length) rows.push(pauseRow(draft.pauses[next++]))
  return rows
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
    case TranscriberEngine.None: return transcription.willTranscribe() ? S.trServer : S.trLater
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
  who.addEventListener('input', () => { draft.name = who.value; if (who.value.trim()) { draft.plain = false; draft.itemId = undefined } consentText.textContent = S.recConsent(draft.name.trim() || S.meetingThey) })
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

  // Back to recording by yourself, never while a take is live. The "‹" back arrow is gone (owner 2026-10-06):
  // "Just me" and the bottom bar lead out of the Meeting view.
  const toSolo = (): void => { if (live) { toast(S.recSwitchWhileLive); return } draft.mode = RecordMode.Solo; recNotice = ''; go(Screen.Record) }
  // Icon only, in the slot where Record shows the Meeting button (owner 2026-10-06); the QR stays put.
  const justMe = iconButton('solo', S.recJustMe, toSolo, 'solo-btn')
  if (pastSearchOpen) return [header(S.meetingTitle, { right: pastSearchButton(), after: justMe, pill: false }), pastSearchView()]
  return [
    header(S.meetingTitle, { right: pastSearchButton(), after: justMe, pill: false }),
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
      recPromptsView(),
      el('div', { class: 'tr-list', id: 'tr-list', 'aria-live': 'polite' }, transcriptRows(transcribing ? S.trEmpty : S.trOffHint)),
      generalNotesView(),
      recAdvancedView(),
      pastMeetingsLink(),
    ]),
    el('div', { class: 'cta' }, [el('button', {
      class: 'btn btn-teal', disabled: !live && !takes.length, onclick: () => void endMeeting(),
    }, [S.meetingEnd])]),
  ]
}

async function makeNotes(): Promise<void> {
  if (!draft.name.trim() && !draft.plain) { aboutSheet(() => void makeNotes()); return }
  if (recorder.live) await recorder.stop()
  await transcriber?.stop()
  transcriber = null
  if (!draft.lines.length) {
    // Picked one utterance at a time, so every line keeps its moment in the recording (provenance.ts).
    draft.lines = [
      ...linesFromTranscript(draft.segments).map((l) => ({ id: randomId(8), text: l.text, tag: l.tag, audience: Audience.Friends, atMs: l.atMs, line: l.line })),
      ...extractLines(draft.text).map((l) => ({ id: randomId(8), text: l.text, tag: l.tag, audience: Audience.Friends })),
    ]
    // Nothing transcribed here: keep the memo itself as a line, so saving
    // never dead-ends; the audio is transcribed later on the computer.
    if (!draft.lines.length && takes.length) {
      draft.lines = [{ id: randomId(8), text: S.memoLine(clock(totalMs())), tag: Tag.Note, audience: Audience.OnlyMe, atMs: 0 }]
    }
  }
  for (const l of draft.extraLines) if (!draft.lines.some((x) => x.id === l.id)) draft.lines.push({ ...l })
  // What was typed under "General notes" is one more note line, first, typed by hand (never stamped with a moment of the recording).
  // "Only me" until the person widens it on the next screen: free text can be long and private, and an answer carries one fixed block of text.
  const general = cleanGeneralNotes(draft.generalNotes)
  if (general && !draft.lines.some((x) => x.typed)) {
    draft.lines.unshift({ id: randomId(8), text: general, tag: Tag.Note, audience: Audience.OnlyMe, typed: true })
  }
  go(Screen.Review)
}

// ---------------------------------------------------------------------------
// meet: this phone's code (QR), NFC where the browser can, a link to copy
// ---------------------------------------------------------------------------

/** The pages of Meet: the TrustWeb code first, then my Signal code, then my Matrix code once set, then Demo account. */
enum MeetPage {
  TrustWeb = 'trustweb',
  Signal = 'signal',
  Matrix = 'matrix',
  /** A test account for the person in front of you (owner 2026-10-06). */
  Demo = 'demo',
}

let meetPage: MeetPage = MeetPage.TrustWeb

function meetPages(): MeetPage[] {
  // Tana, 2026-08-24: "on the same page that one shows one's QR code, one should
  // also show one's Signal code, and once that is ready, one's Matrix code."
  const mine = st().myChannels ?? {}
  // Demo phones (solo) and demo accounts do not hand out demo accounts of their own.
  const demo = solo || st().testOf ? [] : [MeetPage.Demo]
  return [MeetPage.TrustWeb, MeetPage.Signal, ...(mine[Channel.Matrix] ? [MeetPage.Matrix] : []), ...demo]
}

function openMeet(from: Screen, notes = ''): void {
  meetFrom = from
  meetNotes = notes
  meetShare = null
  meetPage = MeetPage.TrustWeb
  demoShowing = null
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
  const body = meetPage === MeetPage.TrustWeb ? meetTrustWebPage()
    : meetPage === MeetPage.Demo ? meetDemoPage()
    : meetMessengerPage(meetPage === MeetPage.Signal ? Channel.Signal : Channel.Matrix)
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

/** One short-link maker per visit: it remembers each long link's short form, so a tap never asks the server twice for the same link. */
let shortLinker: ShortLinker | null = null

/** Copies a link and says so (the toast shows the link itself where the clipboard is refused). */
function copyLink(text: string): void {
  void navigator.clipboard?.writeText(text).then(() => toast(S.meetCopied), () => toast(text))
}

/** The short-link choice for a connect code: its QR follows the choice, as do Copy, Send and NFC (chooser.current()). Not offered in an embedded demo phone. */
function connectLinkChooser(qr: HTMLElement): LinkChooser {
  shortLinker ??= createShortLinker({ origin: location.origin, fetch: (input, init) => fetch(input, init), now: () => Date.now() })
  return createLinkChooser({ origin: location.origin, offer: !solo, linker: shortLinker, qr, renderQr, copy: copyLink })
}

function meetTrustWebPage(): HTMLElement {
  const notes = meetNotes
  const qr = el('div', { class: 'qrwrap' })
  const chooser = connectLinkChooser(qr)
  const nfcStatus = el('p', { class: 'meta' })
  const copy = el('button', {
    class: 'btn btn-ghost', disabled: true,
    onclick: () => copyLink(chooser.current()),
  }, [S.meetCopy])
  const nfc = nfcWriteSupported()
    ? el('button', {
        class: 'btn btn-ghost', disabled: true,
        onclick: () => {
          nfcStatus.textContent = S.meetNfcWaiting
          // A tag is written once and kept for good: it always gets the long link (a short link expires after 30 days).
          writeLinkToTag(chooser.longLink()).then(() => { nfcStatus.textContent = S.meetNfcDone }, () => { nfcStatus.textContent = S.meetNfcFailed })
        },
      }, [S.meetNfcWrite])
    : null
  const sharedDd = el('dd', {}, [notes ? S.meetSharedValue : S.meetSharedNoNotes])
  void (async () => {
    await net.start()
    let link = net.connectLink(APP_URL)
    // After a meeting the code also carries the notes and the transcript, encrypted (share.ts); the key rides in the fragment only.
    let frag = notes ? 'n=' + encodeURIComponent(notes.slice(0, 300)) : ''
    const share = await meetSharePack()
    if (share) {
      frag += (frag ? '&' : '') + shareFragment(share)
      sharedDd.textContent = transcriptStillComing(draftMeeting()) ? S.meetSharedPending : S.meetSharedTranscript
    }
    if (frag) link += '#' + frag
    chooser.setLink(link)
    copy.removeAttribute('disabled')
    nfc?.removeAttribute('disabled')
  })()
  return el('div', { class: 'meet-page' }, [
    el('p', { class: 'hint' }, [S.meetLead]),
    qr,
    el('dl', { class: 'qr-facts' }, [
      el('dt', {}, [S.meetRing]), el('dd', {}, [S.meetRingValue]),
      el('dt', {}, [S.meetShared]), sharedDd,
    ]),
    notes ? el('blockquote', { class: 'shared-notes' }, [notes.slice(0, 300)]) : null,
    copy,
    chooser.el,
    el('h4', { class: 'eyebrow' }, [S.meetWaysTitle]),
    el('p', { class: 'meta', 'data-ways': 'now' }, [S.meetWaysNow]),
    el('p', { class: 'meta', 'data-ways': 'soon' }, [S.meetWaysSoon]),
    el('p', { class: 'meta', 'data-ways': 'later' }, [S.meetWaysLater]),
    // Where the browser can write a tag (Chrome on Android), the link can go onto one; phone to phone stays "later".
    nfc,
    nfc ? nfcStatus : null,
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
  // Signal: the payload comes from channel.ts (always https; the in-app scanner of Signal/Molly reads username codes only, see wave6/u3_signal_finding.txt).
  const payload = (ch === Channel.Signal && qrPayload(value)) || link
  const provider = ch === Channel.Signal ? st().contactShare?.signalProvider : undefined
  const qr = el('div', { class: 'qrwrap', 'data-payload': payload })
  void renderQr(qr, payload)
  return el('div', { class: 'meet-page' }, [
    el('p', { class: 'hint' }, [S.meetMineLead(chName(ch, provider))]),
    qr,
    // phone-number code: a plain note first (a username code scans anywhere, so no note)
    ch === Channel.Signal && scanAdvice(value) === ScanAdvice.CameraAppOnly ? el('p', { class: 'meta', 'data-scan': 'camera-only' }, [S.meetScanCameraNote]) : null,
    el('a', { class: 'btn btn-ghost', href: link, target: '_blank', rel: 'noopener noreferrer' }, [S.chOpen(chName(ch, provider))]),
    el('button', { class: 'btn btn-ghost', onclick: () => editMineSheet(ch) }, [S.meetChangeMine(S.chLabel[ch])]),
    ch === Channel.Signal ? shareControlsFor(ch) : null,
  ])
}

// ---------------------------------------------------------------------------
// meet: demo accounts, owner 2026-10-06 (09:29 spec). "<name>-demo" is a real
// connection to this web (acquaintance ring, consent per ask as always) that
// the owner ALLOWS in his own view before it is active, that ends after a
// week unless ended earlier or extended, listed here and in Settings. It can
// run on their phone (scan) or on this phone (a second tab, own persona) and
// be handed over from there. The link may also name the demo inventory on
// the Swiss server (demo-peer.json next to the app, only once deployed).
// ---------------------------------------------------------------------------

/** The account whose code is on screen right now (this Meet visit only). */
let demoShowing: string | null = null
/** demo-peer.json: undefined = not asked yet, null = none published. */
let demoPeer: DemoPeerRef | null | undefined
let demoPeerProbe: Promise<DemoPeerRef | null> | null = null

function probeDemoPeer(): Promise<DemoPeerRef | null> {
  demoPeerProbe ??= (async (): Promise<DemoPeerRef | null> => {
    try {
      const r = await fetch(APP_URL + 'demo-peer.json', { cache: 'no-store' })
      const v: unknown = r.ok ? await r.json() : null
      demoPeer = isDemoPeerRef(v) ? v : null
    } catch {
      demoPeer = null
    }
    return demoPeer
  })()
  return demoPeerProbe
}

function demoAccounts(): DemoAccount[] {
  return state?.testAccounts ?? []
}

/** Accounts made before expiry existed read as a week after creation. */
function demoExpiresAt(acct: DemoAccount): number {
  return acct.expiresAt ?? acct.createdAt + DEMO_LIFETIME_MS
}

function leftLabel(expiresAt: number): string {
  const t = timeLeft(expiresAt, Date.now())
  if (t.ended) return S.demoAcctEnded
  if (t.days >= 1) return S.demoAcctDays(t.days)
  if (t.hours >= 1) return S.demoAcctHours(t.hours)
  return S.demoAcctMinutes(t.minutes)
}

/** "7 days left" for a demo account, "kept, stays until they leave" for a kept one. */
function accountLeft(acct: DemoAccount): string {
  return isKept(acct) ? S.demoAcctKept : S.demoAcctLeft(leftLabel(demoExpiresAt(acct)))
}

/** Owner: keep the account until the person leaves (the button, or the guest's own "Make it your personal account"); tells the guest's phone. */
function keepDemoAccount(acct: DemoAccount): void {
  const changed = keepAccount(acct, Date.now())
  if (changed) { save(); toast(S.demoAcctKeptToast(acct.name)); render() }
  const peer = acct.peerId ? st().peers.find((p) => p.id === acct.peerId) : undefined
  if (peer) void net.sendText(peer, keepText(APP_URL, KeepNotice.Yes)).catch(() => { /* the guest asks again, or sees it at the next ask */ })
}

function unkeepDemoAccount(acct: DemoAccount): void {
  if (!unkeepAccount(acct, Date.now(), DEMO_LIFETIME_MS)) return
  save()
  toast(S.demoAcctUnkeptToast(acct.name))
  render()
}

/** Net: a keep notice. The guest asked (owner side) or the owner said yes (guest side); anyone else's is ignored. */
function onKeepText(peer: Peer, text: string): void {
  const notice = parseKeepText(APP_URL, text)
  const s = st()
  if (notice === KeepNotice.Ask) {
    const acct = demoAccounts().find((t) => t.peerId === peer.id)
    if (acct) keepDemoAccount(acct)
  } else if (notice === KeepNotice.Yes && s.testOf && s.testOf.name === peer.displayName && guestGranted(s.testOf)) {
    save()
    toast(S.demoKeptByOwner(peer.displayName))
    render()
  }
}

/** Guest: "Make it your personal account" asks the owner to keep this account; its own end stays until he says yes. */
function askOwnerToKeep(): void {
  const s = st()
  const t = s.testOf
  if (!t || !guestAsk(t)) return
  const owner = s.people.find((p) => p.peerId && p.name === t.name)
  const peer = owner ? s.peers.find((p) => p.id === owner.peerId) : undefined
  save()
  if (peer) void net.sendText(peer, keepText(APP_URL, KeepNotice.Ask)).catch(() => { /* the button reads "asked"; Jakob can also keep it himself */ })
  toast(S.demoKeepAskedToast(t.name))
  render()
}

function createDemoAccount(raw: string): DemoAccount | null {
  const name = demoAccountName(raw)
  if (!name) return null
  const s = st()
  const existing = (s.testAccounts ?? []).find((t) => t.name === name)
  if (existing) return existing
  const now = Date.now()
  const acct: DemoAccount = { id: randomId(8), name, createdAt: now, expiresAt: now + DEMO_LIFETIME_MS }
  s.testAccounts = [...(s.testAccounts ?? []), acct]
  save()
  return acct
}

/** Ends the account: forgets its peer and its person, so that phone can no longer ask this web. */
function removeDemoAccount(id: string, why: 'ended' | 'expired' = 'ended'): void {
  const s = st()
  const acct = (s.testAccounts ?? []).find((t) => t.id === id)
  // Never the account this tab runs as: the current device is not removed (demo_devices.ts).
  if (!acct || !canEndDemoAccount(s.testOf, id)) return
  if (acct.peerId) {
    s.peers = s.peers.filter((p) => p.id !== acct.peerId)
    s.people = s.people.filter((p) => p.peerId !== acct.peerId)
  }
  s.testAccounts = (s.testAccounts ?? []).filter((t) => t.id !== id)
  if (!s.testAccounts.length) delete s.testAccounts
  if (demoShowing === id) demoShowing = null
  save()
  toast(why === 'expired' ? S.demoAcctExpired(acct.name) : S.demoAcctRemoved(acct.name))
  render()
}

function extendDemoAccount(id: string): void {
  const acct = demoAccounts().find((t) => t.id === id)
  if (!acct || isKept(acct)) return
  acct.expiresAt = Math.max(demoExpiresAt(acct), Date.now()) + DEMO_LIFETIME_MS
  save()
  toast(S.demoAcctExtended(acct.name, leftLabel(acct.expiresAt)))
  render()
}

/** Taken down after its week (owner 2026-10-06), checked at boot and once a minute. */
function sweepDemoAccounts(): void {
  const now = Date.now()
  for (const acct of dueForTakeDown(demoAccounts(), now, demoExpiresAt)) removeDemoAccount(acct.id, 'expired')
}

/** The owner allows (or not) a phone that opened one of his demo accounts. */
async function allowDemoAccount(id: string, yes: boolean): Promise<void> {
  const s = st()
  const acct = (s.testAccounts ?? []).find((t) => t.id === id)
  const held = acct?.pending
  if (!acct || !held) return
  delete acct.pending
  if (!yes) { save(); hideNotice(); toast(S.demoAcctDenied(acct.name)); render(); return }
  // A second phone on the same code replaces the first.
  if (acct.peerId && acct.peerId !== held.id) {
    s.peers = s.peers.filter((p) => p.id !== acct.peerId)
    s.people = s.people.filter((p) => p.peerId !== acct.peerId)
  }
  const peer = await net.admitPeer(held)
  acct.peerId = peer.id
  let person = s.people.find((p) => p.peerId === peer.id)
  if (!person) {
    person = { id: randomId(8), name: peer.displayName, context: S.demoAccountContext, ring: peer.ring, metAt: Date.now(), lines: [], peerId: peer.id }
    s.people.push(person)
  }
  save()
  hideNotice()
  toast(S.demoAcctAllowed(acct.name))
  render()
}

/** The approve step, in the owner's own view: a card under the header, wherever he is. */
function showAllowCard(acct: DemoAccount): void {
  showNotice(S.demoAcctAllowTitle(acct.name), S.demoAcctAllowBody, [
    el('button', { class: 'btn btn-electric btn-sm', onclick: () => void allowDemoAccount(acct.id, true) }, [S.demoAcctAllow]),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => void allowDemoAccount(acct.id, false) }, [S.demoAcctDeny]),
  ])
}

function demoStatus(acct: DemoAccount): string {
  return acct.pending ? S.demoAcctPending : acct.peerId ? S.demoAcctConnected : S.demoAcctWaiting
}

/** One account: name, state, the countdown, End now, Extend (and Allow / Not now while a phone waits). */
function demoAccountRow(acct: DemoAccount, after: () => void): HTMLElement {
  return el('div', { class: 'test-card' }, [
    el('div', { class: 'conn-row test-row' }, [
      el('b', {}, [acct.name]),
      el('span', {}, [demoStatus(acct) + ' · ' + accountLeft(acct)]),
    ]),
    el('div', { class: 'test-actions' }, [
      // The yes travels over the relay first; the sheet refreshes only if it is still open by then.
      acct.pending ? el('button', { class: 'btn btn-electric btn-sm', 'aria-label': `${S.demoAcctAllow} ${acct.name}`, onclick: () => { void allowDemoAccount(acct.id, true).then(() => { if (!sheet.inert) after() }) } }, [S.demoAcctAllow]) : null,
      acct.pending ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { void allowDemoAccount(acct.id, false).then(() => { if (!sheet.inert) after() }) } }, [S.demoAcctDeny]) : null,
      isKept(acct)
        ? el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': `${S.demoAcctUnkeep} ${acct.name}`, onclick: () => { unkeepDemoAccount(acct); after() } }, [S.demoAcctUnkeep])
        : el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': `${S.demoAcctKeep} ${acct.name}`, onclick: () => { keepDemoAccount(acct); after() } }, [S.demoAcctKeep]),
      isKept(acct) ? null : el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': `${S.demoAcctExtend} ${acct.name}`, onclick: () => { extendDemoAccount(acct.id); after() } }, [S.demoAcctExtend]),
      el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': `${S.demoAcctRemove} ${acct.name}`, onclick: () => { if (!confirm(S.demoAcctRemoveConfirm(acct.name))) return; removeDemoAccount(acct.id); after() } }, [S.demoAcctRemove]),
    ]),
  ])
}

function meetDemoPage(): HTMLElement {
  const shown = demoShowing ? demoAccounts().find((t) => t.id === demoShowing) : undefined
  if (shown) return demoCodePage(shown)
  // Prefilled "-demo", caret in front of it: typing gives "<name>-demo"; the suffix can be erased (owner 2026-10-06).
  const name = el('input', { class: 'field', placeholder: S.demoAcctNamePh, maxlength: '40', autocomplete: 'off', 'aria-label': S.demoAcctNameAria, value: DEMO_SUFFIX })
  const caretFirst = (): void => { name.setSelectionRange(0, 0) }
  name.addEventListener('focus', () => setTimeout(caretFirst, 0), { once: true })
  const make = (): void => {
    const acct = createDemoAccount(name.value)
    if (!acct) { name.focus(); return }
    demoShowing = acct.id
    render()
  }
  name.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') make() })
  setTimeout(() => { name.focus(); caretFirst() }, 320)
  const list = demoAccounts()
  return el('div', { class: 'meet-page demo-acct' }, [
    el('h3', {}, [S.demoAcctTitle]),
    el('p', { class: 'hint' }, [S.demoAcctLead]),
    name,
    el('button', { class: 'btn btn-electric wide', onclick: make }, [S.demoAcctCreate]),
    el('h4', { class: 'eyebrow' }, [S.demoAcctList]),
    list.length ? el('div', { class: 'test-list' }, list.map((t) => el('button', {
      class: 'conn-row name-row test-row', onclick: () => { demoShowing = t.id; render() },
    }, [el('b', {}, [t.name]), el('span', {}, [demoStatus(t) + ' · ' + accountLeft(t)]), el('em', {}, [S.demoAcctShow])])))
      : el('p', { class: 'meta' }, [S.demoAcctNone]),
    el('p', { class: 'meta' }, [S.demoAcctHint]),
  ])
}

/** The account's code: the connect link plus the account, its id, its end (and the demo inventory peer) in the fragment. */
function demoCodePage(acct: DemoAccount): HTMLElement {
  const qr = el('div', { class: 'qrwrap' })
  const chooser = connectLinkChooser(qr)
  const copy = el('button', {
    class: 'btn btn-ghost', disabled: true,
    onclick: () => copyLink(chooser.current()),
  }, [S.meetCopy])
  const nav = navigator as Navigator & { share?: (d: { title?: string; url?: string }) => Promise<void> }
  const send = nav.share
    ? el('button', { class: 'btn btn-ghost', disabled: true, onclick: () => { void nav.share?.({ title: S.demoAcctShareTitle(acct.name), url: chooser.current() }).catch(() => {}) } }, [S.demoAcctSend])
    : null
  // On this phone: a second tab under the account's own persona, opened on the same code.
  const here = el('a', { class: 'btn btn-ghost open-here', href: '#', target: '_blank', rel: 'noopener', 'aria-disabled': 'true' }, [S.demoAcctOpenHere])
  const asks = el('dd', {}, [S.demoAcctAsksYou])
  const expiresAt = demoExpiresAt(acct)
  // A kept account's link carries no end: the guest's phone never counts it down.
  const linkExpiresAt = isKept(acct) ? undefined : expiresAt
  void (async () => {
    const [peer] = await Promise.all([probeDemoPeer(), net.start()])
    const base = net.connectLink(APP_URL)
    const frag = { account: acct.name, accountId: acct.id, expiresAt: linkExpiresAt, peer: peer ?? undefined }
    const link = base + '#' + demoFragment(frag)
    const ownUrl = new URL(base)
    ownUrl.searchParams.set('persona', demoPersona(acct.id))
    here.href = ownUrl.toString() + '#' + demoFragment({ ...frag, own: true })
    here.removeAttribute('aria-disabled')
    if (peer) asks.textContent = S.demoAcctAsksPeer(peer.name)
    chooser.setLink(link)
    copy.removeAttribute('disabled')
    send?.removeAttribute('disabled')
  })()
  return el('div', { class: 'meet-page demo-acct' }, [
    el('h3', {}, [S.demoAcctMade(acct.name)]),
    el('p', { class: 'hint' }, [S.demoAcctScan]),
    qr,
    el('dl', { class: 'qr-facts' }, [
      el('dt', {}, [S.demoAcctAccount]), el('dd', {}, [acct.name]),
      el('dt', {}, [S.demoAcctAsks]), asks,
      el('dt', {}, [S.demoAcctEnds]), el('dd', {}, [isKept(acct) ? S.demoAcctKeptEnds : S.demoAcctEndsIn(leftLabel(expiresAt))]),
    ]),
    copy,
    send,
    chooser.el,
    here,
    el('p', { class: 'meta' }, [S.demoAcctOpenHereHint]),
    demoAccountRow(acct, () => {}),
    el('button', { class: 'btn btn-ghost', onclick: () => { demoShowing = null; render() } }, [S.demoAcctAnother]),
  ])
}

// ---------------------------------------------------------------------------
// a demo account's own phone: what it found, and handing it over (owner
// 2026-10-06: "hand over this demo account directly with what we have found
// and access permissions I have set"). The pack is this phone's whole record
// (identity, connection, finds, the owner's ring and audiences as they apply),
// encrypted on the backup server with a key made here; the key travels only
// in the hand-over link's fragment. Afterwards this phone forgets the account
// (one relay identity, one phone).
// ---------------------------------------------------------------------------

const FOUND_MAX = 20

/** What an ask brought back, kept (capped): a demo account hands it over, and the Feed shows it (round B). */
function recordFound(text: string, results: AskResult[]): void {
  const s = state
  if (!s) return
  // By the peer that answered (this phone's name for it), never by the name the answer gives itself (review-app-b);
  // items checked: an answer is another phone's data.
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
  const shared = results
    .filter((r) => r.decoded?.outcome === 'shared' && r.decoded.shared)
    .map((r) => ({
      from: r.peerName, peerId: r.peerId,
      items: (Array.isArray(r.decoded?.shared?.items) ? r.decoded.shared.items : [])
        .filter((it) => typeof it?.text === 'string' && it.text.trim())
        .map((it) => {
          const via = readVia(it.via)
          return { text: str(it.text, 500), context: str(it.context, 200), when: str(it.when, 60), ...(via.length ? { via } : {}) }
        }),
    }))
    .filter((sh) => sh.items.length)
  if (!shared.length) return
  const entry: Found = { id: randomId(8), at: Date.now(), text, shared }
  s.found = [entry, ...(s.found ?? [])].slice(0, FOUND_MAX)
  save()
}

function foundView(s: AppState, title: string = S.foundTitle): HTMLElement {
  const found = s.found ?? []
  return el('div', { class: 'found' }, [
    el('h4', { class: 'eyebrow' }, [title]),
    found.length === 0 ? el('p', { class: 'meta' }, [S.foundNone]) : null,
    ...found.map((f) => el('div', { class: 'card found-card' }, [
      el('p', { class: 'q' }, ['"' + f.text + '"']),
      ...f.shared.map((sh) => el('div', { class: 'outcome shared' }, [
        el('b', {}, [answerTitle(sh.from, sh.items)]),
        ...sh.items.map((it) => el('div', { class: 'shared-item' }, [el('span', {}, [it.text]), el('small', {}, [it.context + ' · ' + it.when]), throughTag(it.via)])),
      ])),
    ])),
  ])
}

/** "Ends in 6 days" / "has ended", from what the link carried; the owner's phone is the authority. */
function demoOfLine(s: AppState): string | null {
  const t = s.testOf
  if (t && guestKept(t)) return S.demoKeptLine
  if (!t?.expiresAt) return null
  const left = timeLeft(t.expiresAt, Date.now())
  return left.ended ? S.demoEndedLine : S.demoEndsLine('in ' + leftLabel(t.expiresAt))
}

/** Guest: "Make it your personal account" (not on the owner's own second tab, not once handed over, not once kept). */
function keepAskRow(s: AppState): HTMLElement | null {
  const t = s.testOf
  if (!t || t.own || t.handedOverAt || guestKept(t)) return null
  if (guestAsked(t)) return el('p', { class: 'meta', 'data-keep-asked': '1' }, [S.demoKeepAsked(t.name)])
  return el('div', { class: 'keep-ask' }, [
    el('button', { class: 'btn btn-electric', 'data-keep-ask': '1', onclick: askOwnerToKeep }, [S.demoKeepAsk]),
    el('p', { class: 'meta' }, [S.demoKeepAskHint(t.name)]),
  ])
}

function handoverSheet(): void {
  const s = st()
  const t = s.testOf
  if (!t) return
  const qr = el('div', { class: 'qrwrap', hidden: true })
  const msg = el('p', { class: 'meta' }, [S.handLead])
  let link = ''
  const copy = el('button', { class: 'btn btn-ghost', hidden: true, onclick: () => { void navigator.clipboard?.writeText(link).then(() => toast(S.meetCopied), () => toast(link)) } }, [S.handCopy])
  const nav = navigator as Navigator & { share?: (d: { title?: string; url?: string }) => Promise<void> }
  const send = nav.share ? el('button', { class: 'btn btn-ghost', hidden: true, onclick: () => { void nav.share?.({ title: S.handShareTitle(s.me.displayName), url: link }).catch(() => {}) } }, [S.handSend]) : null
  const make = el('button', { class: 'btn btn-electric', onclick: () => void run() }, [S.handMake])
  const run = async (): Promise<void> => {
    make.setAttribute('disabled', '')
    msg.textContent = S.handWorking
    if (backup.available() === null) await backup.probe()
    if (!backup.available()) { msg.textContent = S.handNoServer; make.removeAttribute('disabled'); return }
    try {
      const key = await newRandomKey()
      const pack: AppState = { ...s, testOf: { ...t, own: undefined } }
      await backupNow(key, pack)
      link = APP_URL + '?handover=1#' + handoverFragment({ keyText: key.text, accountId: t.accountId ?? 'x0000', account: s.me.displayName })
      t.handedOverAt = Date.now()
      save()
      qr.hidden = false
      qr.setAttribute('data-payload', link)
      await renderQr(qr, link)
      copy.hidden = false
      if (send) send.hidden = false
      make.hidden = true
      msg.textContent = S.handReady
      // One relay identity, one phone: this tab leaves the relay for good.
      net.stop()
      render()
    } catch {
      msg.textContent = S.handFailed
      make.removeAttribute('disabled')
    }
  }
  openSheet([el('h3', {}, [S.handTitle]), msg, qr, make, copy, send])
}

/** After a hand-over this persona only shows that it is gone (the other phone has the identity now). */
function screenHandedOver(): Node[] {
  return [
    header(S.handTitle, { qr: false }),
    el('div', { class: 'scroll pad' }, [el('p', { class: 'hint' }, [S.handDone])]),
  ]
}

/** One of my own channels, straight in edit mode; `done` runs after save or cancel. */
function singleChannelEditor(ch: Channel, done: () => void): HTMLElement {
  return channelRow(myChannels(), ch, true, () => done())
}

function editMineSheet(ch: Channel): void {
  openSheet([
    el('h3', {}, [S.meetYour(S.chLabel[ch])]),
    singleChannelEditor(ch, () => { closeSheet(); render() }),
    ch === Channel.Signal ? shareControlsFor(ch) : null,
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
      transcriptStillComing(draftMeeting()) ? el('p', { class: 'meta job-state', 'data-job': 'running' }, [S.reviewServerPending]) : null,
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
        // A plain note has no ring to pick and nobody to ask about it: it is saved here, as a past meeting only.
        if (draft.plain) { saveDraftPlain(); return }
        go(Screen.Place)
      },
    }, [S.reviewOk])]),
  ]
}

// ---------------------------------------------------------------------------
// meet: step 3, place in a ring, choose who can ask
// ---------------------------------------------------------------------------

function nextAudience(a: Audience): Audience {
  // An unknown value (indexOf -1) moves on to the first, widest choice.
  return AUDIENCES[(AUDIENCES.indexOf(a) + 1) % AUDIENCES.length]
}

function audiencePill(current: Audience, onChange: (a: Audience) => void): HTMLElement {
  return el('button', {
    class: 'aud aud-' + current,
    title: 'Tap to change',
    onclick: () => onChange(nextAudience(current)),
  }, [S.audienceLabel[current]])
}

/** The existing thing this draft's notes are added to as context (wave 5), if the one picked is still there and still the one named. */
function contextTarget(): InventoryItem | undefined {
  if (draft.about !== AboutKind.What || !draft.itemId) return undefined
  const item = st().inventory.find((i) => i.id === draft.itemId)
  return item && noteKey(item.text) === noteKey(draft.name) ? item : undefined
}

/** "What" notes: no ring to pick, only who can ask about each line. Notes for an existing thing become its context instead. */
function screenPlaceWhat(): Node[] {
  const target = contextTarget()
  if (target) {
    return [
      header(S.placeContextTitle(target.text), { back: () => go(Screen.Review) }),
      el('div', { class: 'scroll pad' }, [
        el('p', { class: 'hint' }, [S.placeContextLead]),
        el('div', { class: 'lines' }, draft.lines.map((l) => el('div', { class: 'aud-row' }, [el('span', {}, [l.text])]))),
      ]),
      el('div', { class: 'cta' }, [el('button', { class: 'btn btn-teal', 'data-save-context': '1', onclick: saveDraftWhat }, [S.placeContextSave])]),
    ]
  }
  return [
    header(S.placeWhatTitle(draft.name.trim()), { back: () => go(Screen.Review) }),
    el('div', { class: 'scroll pad' }, [
      el('h4', { class: 'eyebrow' }, [S.placeWho]),
      el('div', { class: 'aud-list' }, draft.lines.map((l) => el('div', { class: 'aud-row' }, [
        el('span', {}, [l.text]),
        audiencePill(l.audience, (a) => { l.audience = a; render() }),
      ]))),
      el('p', { class: 'foot' }, [S.placeFoot]),
    ]),
    el('div', { class: 'cta' }, [el('button', { class: 'btn btn-teal', onclick: saveDraftWhat }, [S.placeWhatSave])]),
  ]
}

/**
 * Each line becomes an inventory item, prefixed with what it was about unless it already says so; or, when an existing
 * thing was picked, the lines are added to it as context (note_fields.ts), so nothing new appears in the inventory.
 */
function saveDraftWhat(): void {
  const s = st()
  const now = Date.now()
  const what = draft.name.trim()
  const lines = draft.lines.filter((l) => l.text.trim())
  // The meeting is stored first, so every item can point at it (the chain of proof).
  if (draftIsMeeting()) recordPastMeeting()
  const target = contextTarget()
  if (target) {
    const added = addContextLines(target, lines.map((l) => l.text), now, draft.meetingId)
    save()
    toast(S.savedContextToast(target.text, added))
    newDraft()
    go(Screen.Inventory)
    return
  }
  const meeting = draftWasMeeting()
  for (const l of lines) {
    const text = l.text.trim()
    s.inventory.push({
      id: randomId(8), text: text.toLowerCase().includes(what.toLowerCase()) ? text : `${what}: ${text}`,
      audience: l.audience, included: true, createdAt: now, source: l.typed ? typedSource() : recordedSource(meeting, draft.meetingId, l),
    })
  }
  save()
  toast(S.savedWhatToast(lines.length))
  newDraft()
  go(Screen.Inventory)
}

/** "None of these": the notes are kept as a past meeting only, a plain note with no person and no thing behind it. */
function saveDraftPlain(): void {
  recordPastMeeting()
  save()
  toast(S.savedPlainToast)
  newDraft()
  go(Screen.Web)
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
  // The meeting is stored first, so every note can point at it (the chain of proof).
  if (draftIsMeeting()) recordPastMeeting({ personId: p.id })
  const meeting = draftWasMeeting()
  for (const l of draft.lines) {
    p.lines.push({
      id: l.id, text: l.text.trim(), tag: l.tag, customTag: l.customTag, audience: l.audience,
      status: LineStatus.Current, notedAt: now, checkedAt: now, source: l.typed ? typedSource() : recordedSource(meeting, draft.meetingId, l),
    })
  }
  save()
  toast(S.savedToast(p.name, S.ringLabel[p.ring]))
  newDraft()
  go(Screen.Web)
}

function screenPlace(): Node[] {
  if (draft.about === AboutKind.What) return screenPlaceWhat()
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

/** Change your own name (tap yourself in the web, or Settings). */
function editNameSheet(): void {
  const s = st()
  const name = el('input', { class: 'field', maxlength: '40', autocomplete: 'given-name', 'aria-label': S.meNameTitle, value: s.me.displayName })
  const saveName = (): void => {
    const n = name.value.trim().slice(0, 40)
    if (!n) { name.focus(); return }
    s.me.displayName = n
    save()
    closeSheet()
    render()
    toast(S.meNameSaved)
  }
  name.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') saveName() })
  openSheet([
    el('h3', {}, [S.meNameTitle]),
    name,
    el('p', { class: 'meta' }, [S.meNameHint]),
    el('button', { class: 'btn btn-electric', onclick: saveName }, [S.meNameSave]),
  ])
  name.focus()
  name.select()
}

/**
 * Settings > Recording (owner 2026-10-06): who transcribes, and whether the
 * Record tab starts as "Just me" or "A meeting". Choosing a transcription
 * replaces the older "Use TalkWeave on this computer" switch for good.
 * Wave 3: the engine list never holds the server; it is an extra button below
 * it (transcription_view.ts serverButton), offered only while the server
 * transcribes, or to a phone that chose it before (so it can move away).
 */
function recordingSettings(s: AppState): (HTMLElement | null)[] {
  const choice = transcriptionChoice(s)
  const start = defaultRecording(s)
  return [
    el('h4', { class: 'eyebrow' }, [S.setRecording]),
    el('p', { class: 'meta set-sub' }, [S.setDefaultRecording]),
    ...DEFAULT_RECORDINGS.map((d) => el('button', {
      class: 'radio' + (start === d ? ' on' : ''), 'aria-pressed': String(start === d), 'data-default-recording': d,
      onclick: () => { s.defaultRecording = d; save(); settingsSheet() },
    }, [el('b', {}, [S.setDefaultRecordingLabel[d]]), el('small', {}, [S.setDefaultRecordingHint[d]])])),
    el('p', { class: 'meta' }, [S.setDefaultRecordingNote]),
    el('p', { class: 'meta set-sub' }, [S.setTranscription]),
    ...ENGINE_CHOICES.map((c) => el('button', {
      class: 'radio' + (choice === c ? ' on' : ''), 'aria-pressed': String(choice === c), 'data-transcription': c,
      onclick: () => { s.transcription = c; delete s.talkWeaveLocal; engine = null; save(); settingsSheet() },
    }, [el('b', {}, [S.setTranscriptionLabel[c]]), el('small', {}, [S.setTranscriptionHint[c]])])),
    transcription.settingsNote(),
    transcription.serverButton(() => { engine = null; settingsSheet() }),
    transcription.withdrawButton(() => { engine = null; settingsSheet() }),
    audioKeptLine(),
  ]
}

/** Settings > Recording: what audio is kept on this phone, and that it never leaves with a backup or a sent meeting. */
function audioKeptLine(): HTMLElement {
  const line = el('p', { class: 'meta set-sub', 'data-audio-kept': '1' }, [S.audioKeptChecking])
  void audioStore.entries().then(async (es) => {
    line.textContent = S.audioKept(es.length, megabytes(es.reduce((n, e) => n + e.bytes, 0)), MAX_RECORDINGS, megabytes(MAX_BYTES))
    // Honestly whether the browser agreed to keep this site's storage (review P6), once there is something big to keep.
    const p = es.length ? await persistState() : PersistState.Unsupported
    if (p !== PersistState.Unsupported) line.append(' ' + (p === PersistState.Granted ? S.persistGranted : S.persistNotGranted))
    line.dataset.persist = p
  })
  return line
}

function settingsSheet(): void {
  const s = st()
  // What the Swiss server has switched on drives the wording; asked once, the sheet redraws with the answer.
  if (swiss.enabled() && swiss.status() === undefined) void swiss.probe().then(() => { if (sheet.dataset.kind === 'settings') settingsSheet() })
  const order = s.tabOrder ?? TabOrder.WebLeft
  const demoSettingsShown = !solo && (Boolean(s.demo) || !runsAsInstalledApp())
  const pick = (o: TabOrder, label: string): HTMLElement => el('button', {
    class: 'radio' + (order === o ? ' on' : ''),
    onclick: () => { s.tabOrder = o; save(); renderTabs(); render(); settingsSheet() },
  }, [el('b', {}, [label])])
  openSheet([
    el('h3', {}, [S.setTitle]),
    s.testOf ? el('p', { class: 'meta' }, [s.testOf.own ? S.setDemoOfOwn(s.me.displayName) : guestKept(s.testOf) ? S.setDemoKeptOf(s.testOf.name) : S.setDemoOf(s.testOf.name)]) : null,
    s.testOf && demoOfLine(s) ? el('p', { class: 'meta' }, [demoOfLine(s)]) : null,
    keepAskRow(s),
    s.testOf && !s.testOf.handedOverAt ? el('button', { class: 'btn btn-ghost', onclick: handoverSheet }, [S.handTitle]) : null,
    el('button', { class: 'conn-row name-row', 'aria-label': S.meNameAria(s.me.displayName), onclick: () => editNameSheet() }, [
      el('b', {}, [S.setYourName]), el('span', {}, [s.me.displayName]), el('em', {}, [S.setYourNameEdit]),
    ]),
    connectionRow(),
    ...(solo || s.testOf ? [] : [
      el('h4', { class: 'eyebrow' }, [S.setDemoAccounts]),
      ...(s.testAccounts?.length
        ? s.testAccounts.map((t) => demoAccountRow(t, settingsSheet))
        : [el('p', { class: 'meta' }, [S.demoAcctNone])]),
      el('button', {
        class: 'radio' + (demoOnlyForDemoAccounts(s) ? ' on' : ''), 'aria-pressed': String(demoOnlyForDemoAccounts(s)), 'data-demo-only': '1',
        onclick: () => { s.demoOnlyForDemoAccounts = !demoOnlyForDemoAccounts(s); save(); settingsSheet() },
      }, [el('b', {}, [S.setDemoOnly]), el('small', {}, [S.setDemoOnlyHint])]),
    ]),
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
    ...recordingSettings(s),
    ...hosting.settingsGroup(),
    ...(solo ? [] : importGroup({ state: st, save, openSheet, closeSheet, toast, changed: render, settings: settingsSheet })),
    ...feed.settingsGroup(),
    notificationsCard(s),
    // The installed app offers no demo content (owner 2026-10-07); where some is already on, removing it stays possible.
    demoSettingsShown ? el('h4', { class: 'eyebrow' }, [S.setDemo]) : null,
    demoSettingsShown ? el('button', {
      class: 'radio' + (s.demo ? ' on' : ''),
      'aria-pressed': String(Boolean(s.demo)),
      onclick: () => { if (s.demo) removeDemoContent(); else addDemoContent(); settingsSheet() },
    }, [el('b', {}, [s.demo ? S.demoRemove : S.demoAdd]), el('small', {}, [S.setDemoHint])]) : null,
    el('h4', { class: 'eyebrow' }, [S.setAdvanced]),
    el('button', {
      class: 'radio' + (s.showRingNames ? ' on' : ''),
      'aria-pressed': String(s.showRingNames === true),
      onclick: () => { s.showRingNames = !s.showRingNames; save(); render(); settingsSheet() },
    }, [el('b', {}, [S.setRingNames]), el('small', {}, [S.setRingNamesHint])]),
    el('button', {
      class: 'radio' + (askDirectOnly(s) ? ' on' : ''), 'aria-pressed': String(askDirectOnly(s)), 'data-direct-only': '1',
      // Off is stored as absent: the record keeps only what differs from the default.
      onclick: () => { if (askDirectOnly(s)) delete s.askDirectOnly; else s.askDirectOnly = true; save(); render(); settingsSheet() },
    }, [el('b', {}, [S.setDirectOnly]), el('small', {}, [S.setDirectOnlyHint])]),
    el('button', {
      class: 'radio' + (asksMatchNotes(s) ? ' on' : ''), 'aria-pressed': String(asksMatchNotes(s)), 'data-notes-match': '1',
      // Stored only when it differs from the default of this account type (notes_source.ts), so a change of default never flips a choice.
      onclick: () => { const next = !asksMatchNotes(s); if (next === notesMatchDefault(s)) delete s.asksMatchNotes; else s.asksMatchNotes = next; save(); settingsSheet() },
    }, [el('b', {}, [S.setNotesMatch]), el('small', {}, [S.setNotesMatchHint])]),
    ...HINTS.map((id) => el('button', {
      class: 'radio' + (hintHidden(id) ? '' : ' on'),
      'aria-pressed': String(!hintHidden(id)),
      onclick: () => { setHintHidden(id, !hintHidden(id)); render(); settingsSheet() },
    }, [el('b', {}, [S.setHintsOne(S.hintLabel[id])]), el('small', {}, [S.hintText[id]])])),
    el('h4', { class: 'eyebrow' }, [S.setTutorial]),
    el('button', {
      class: 'btn btn-ghost', disabled: !(s.hiddenHints?.length),
      onclick: () => { delete s.hiddenHints; save(); render(); settingsSheet() },
    }, [S.setHintsAll]),
    el('p', { class: 'meta' }, [S.setHintsAllHint]),
    installable ? el('button', { class: 'btn btn-ghost', 'data-open-install': '1', onclick: openInstallSheet }, [S.setInstall]) : null,
    ...aboutGroup(),
    solo ? null : el('button', {
      class: 'btn btn-ghost',
      onclick: () => {
        if (!confirm(S.resetConfirm)) return
        dropRecording()
        void Promise.all([audioStore.clear(), images.clear()]).finally(() => { clearState(persona, storeCtx); location.reload() })
      },
    }, [S.resetPhone]),
  ])
  sheet.dataset.kind = 'settings'
}

// ---------------------------------------------------------------------------
// backup: the card in Inventory and its sheets (backup_view.ts)
// ---------------------------------------------------------------------------

const backup = createBackupView({
  persona, storeCtx, state: st, openSheet, closeSheet, toast,
  replaceRecord: (s) => { state = s; save(); location.reload() },
  redraw: () => { if (screen === Screen.Inventory) render() },
})

function screenInventory(): Node[] {
  const s = st()
  const input = el('input', { class: 'field', placeholder: S.invAddPh, maxlength: '160', 'aria-label': S.invAddPh })
  const add = (): void => {
    const v = input.value.trim()
    if (!v) { input.focus(); return }
    s.inventory.unshift({ id: randomId(8), text: v, audience: Audience.FriendsOfFriends, included: true, createdAt: Date.now(), source: typedSource() })
    save()
    render()
  }
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') add() })
  // Top right, in the slot ⋮ has on Web, so the QR keeps its place (owner 2026-10-06).
  const gearBtn = el('button', { class: 'hdr-btn icon-only', 'aria-label': S.invSettings, title: S.invSettings, onclick: settingsSheet })
  gearBtn.innerHTML = icon('settings')
  // Wave 6: a small (i) just below Settings explains the cascade (Jakob 2026-10-07).
  const gear = el('div', { class: 'gear-stack' }, [gearBtn, cascadeInfoButton(() => openSheet(cascadeInfoContent()))])
  const requests = el('button', { class: 'query-fab call requests-fab', 'aria-label': S.reqAria, onclick: requestsSheet }, [
    el('span', { class: 'fab-two' }, [el('span', {}, [S.reqTop]), el('span', {}, [S.reqBottom])]),
  ])
  // Querying is one tap from Inventory too (wave 2, P9): bottom left, opposite "Review requests".
  const call = el('button', { class: 'query-fab call inv-call-fab', 'aria-label': S.webCall, 'data-open-query': 'inventory', onclick: openQuery })
  call.innerHTML = icon('call')
  call.append(el('span', { class: 'fab-two' }, [el('span', {}, [S.webCallTop]), el('span', {}, [S.webCallBottom])]))
  return [
    header(S.invTitle, { after: gear }),
    el('div', { class: 'scroll pad' }, [
      s.testOf ? foundView(s) : null,
      el('p', { class: 'hint' }, [S.invLead]),
      el('div', { class: 'add-row' }, [input, el('button', { class: 'btn btn-electric btn-sm', onclick: add }, [S.invAdd])]),
      s.inventory.length === 0 ? el('p', { class: 'empty' }, [S.invEmpty]) : null,
      // Jakob's sketch (10-07, #21/#22): the X top right of the item, the on/off switch below it on the right;
      // under the text first who can ask, then how far it may travel.
      ...s.inventory.map((item) => el('div', { class: 'inv' + (item.included ? '' : ' off') }, [
        el('div', { class: 'inv-main' }, [
          el('button', { class: 'inv-text', 'data-item': item.id, onclick: () => itemSheet(item.id) }, [
            item.text, isDemoItem(s, item.id) ? dummyChip() : null,
            provenanceState(item.source) === ProvenanceState.Unreviewed ? el('span', { class: 'tagpill unreviewed-chip', 'data-unreviewed': '1' }, [S.provUnreviewedChip]) : null,
          ]),
          el('div', { class: 'inv-actions' }, [
            audiencePill(item.audience, (a) => { item.audience = a; save(); render() }),
            degreesPill(item, () => itemSheet(item.id)),
          ]),
        ]),
        el('div', { class: 'inv-side' }, [
          el('button', { class: 'x', 'aria-label': S.remove, onclick: () => { s.inventory = s.inventory.filter((x) => x !== item); if (item.imageId) feed.dropImage(item.imageId); save(); render() } }, ['×']),
          onOffSwitch(item.included, () => { item.included = !item.included; save(); render() }),
        ]),
      ])),
      backup.card(),
    ]),
    call,
    requests,
  ]
}

/** "Review requests": the asks people sent to this phone, newest first, and any still waiting for an answer. */
function requestsSheet(): void {
  const s = st()
  const waiting = askQueue.length
  const demoPeerIds = new Set(demoAccounts().map((t) => t.peerId).filter((id): id is string => Boolean(id)))
  const pendingDemo = demoAccounts().filter((t) => t.pending)
  openSheet([
    el('h3', {}, [S.reqTitle]),
    waiting ? el('div', { class: 'conn-row' }, [
      el('b', {}, [S.reqWaiting(waiting)]),
      el('button', { class: 'btn btn-electric btn-sm', onclick: () => { closeSheet(); if (!askShowing) showNextAsk() } }, [S.reqOpen]),
    ]) : null,
    // Demo accounts waiting for the owner's yes (owner 2026-10-06: their asks and requests live here too).
    ...pendingDemo.map((t) => demoAccountRow(t, requestsSheet)),
    // Meetings other phones sent inside TrustWeb (owner 2026-10-06).
    ...(s.received?.length ? [
      el('h4', { class: 'eyebrow' }, [S.recvList]),
      ...s.received.map((r) => el('div', { class: 'conn-row recv-row' }, [
        el('b', {}, [S.recvRow(r.fromName, r.title)]),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { const l = parseShareText(APP_URL, r.link); if (l) void openShare(l, r) } }, [S.recvOpen]),
      ])),
    ] : []),
    el('h4', { class: 'eyebrow' }, [S.logTitle]),
    s.log.length === 0 ? el('p', { class: 'empty' }, [S.logEmpty]) : null,
    ...s.log.slice(0, 50).map((e) => el('div', { class: 'log' }, [
      el('b', {}, [e.from + ': ']),
      e.peerId && demoPeerIds.has(e.peerId) ? el('span', { class: 'tagpill demo-chip' }, [S.demoAcctChip]) : null,
      el('span', {}, ['"' + e.text + '"']),
      el('em', {}, [S.logOutcome[e.outcome]]),
      e.passedOn ? el('small', { class: 'log-hop', 'data-passed-on': String(e.passedOn) }, [S.logPassedOn(e.passedOn, e.cameBack ?? 0)]) : null,
    ])),
    el('p', { class: 'foot' }, [S.logFoot]),
  ])
}

// ---------------------------------------------------------------------------
// query: a dock on the Web screen, under the rings, so the web stays in view
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  'Does anyone have loudspeakers I could borrow?',
  'Who is hiring?',
  'Who has a spare room in Vienna?',
]

let countdownTimer: ReturnType<typeof setInterval> | undefined

/** Seconds until the answers of an ask with this reach are due (one window per step, hops.ts). */
function secondsLeft(startedAt: number, reach: number = HOPS_DEFAULT): number {
  return Math.max(0, Math.ceil((startedAt + askWaitMs(reach, ANSWER_WINDOW_MS) - Date.now()) / 1000))
}

async function runAsk(text: string): Promise<void> {
  const t = text.trim()
  if (!t) return
  const peers = st().peers
  askRun = { text: t, asked: peers.length, askedPeerIds: peers.map((p) => p.id), startedAt: Date.now(), results: null, reach: askReachOf(st()) }
  clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    const w = document.getElementById('tw-wait')
    if (w && askRun && !askRun.results) w.textContent = ' ' + S.queryWaiting(secondsLeft(askRun.startedAt, askRun.reach))
  }, 1000)
  render()
  const results = await net.ask(t)
  clearInterval(countdownTimer)
  if (askRun && askRun.text === t) askRun.results = results
  recordFound(t, results)
  if (screen === Screen.Web) render()
}

function resultsView(results: AskResult[]): HTMLElement[] {
  const shared = results.filter((r) => r.decoded?.outcome === 'shared' && r.decoded.shared)
  if (!shared.length) {
    return [el('div', { class: 'outcome nothing' }, [el('b', {}, [S.resultNothing]), el('span', {}, [S.resultNothingSub])])]
  }
  return shared.map((r) => el('div', { class: 'outcome shared' }, [
    el('b', {}, [answerTitle(r.decoded?.shared?.from || r.peerName, r.decoded?.shared?.items ?? [])]),
    ...(r.decoded?.shared?.items ?? []).map((it) => el('div', { class: 'shared-item' }, [
      el('span', {}, [it.text]), el('small', {}, [it.context + ' · ' + it.when]),
      throughTag(it.via),
    ])),
  ]))
}

function queryDock(s: AppState): HTMLElement {
  const box = el('textarea', { class: 'field', rows: '2', placeholder: S.queryPh, maxlength: '200', 'aria-label': S.queryTitle })
  box.value = queryText
  box.addEventListener('input', () => { queryText = box.value })
  const busy = Boolean(askRun && !askRun.results)
  // A demo account asks only once its owner allowed it, and not after its end.
  const demoEnded = Boolean(s.testOf && guestEnded(s.testOf, Date.now()))
  const demoWaiting = Boolean(s.testOf && !s.testOf.approvedAt)
  const run = askRun
  const inFlight = run
    ? el('div', { class: 'card asked' }, [
        el('p', { class: 'q' }, ['"' + run.text + '"']),
        el('p', {}, [S.queryAsked(run.asked)]),
        askDirectOnly(s) ? el('p', { class: 'hint', 'data-direct-note': '1' }, [S.queryDirectOnly]) : null,
        el('p', { class: 'hint' }, [run.reach === HOPS_DEFAULT ? S.queryWindow : S.queryWindowFar(Math.round(askWaitMs(run.reach, ANSWER_WINDOW_MS) / 1000))]),
        run.results
          ? el('div', {}, [...resultsView(run.results), webSearchRow(run.text, webResults).el])
          : el('p', { class: 'wait' }, [el('span', { class: 'spin' }), el('span', { id: 'tw-wait' }, [' ' + S.queryWaiting(secondsLeft(run.startedAt, run.reach))])]),
      ])
    : null
  return el('section', { class: 'query-dock', 'aria-label': S.queryTitle }, [
    el('div', { class: 'dock-head' }, [
      el('h3', {}, [S.queryTitle]),
      el('button', { class: 'x', 'aria-label': S.queryClose, onclick: () => { queryOpen = false; render() } }, ['×']),
    ]),
    el('div', { class: 'dock-body' }, [
      run ? null : el('p', { class: 'hint' }, [S.queryLead]),
      !run && askDirectOnly(s) ? el('p', { class: 'hint', 'data-direct-note': '1' }, [S.queryDirectOnly]) : null,
      // Wave 6: how far the ask travels, remembered on this phone; "Ask only my direct contacts" (Settings > Advanced) holds it at 1.
      reachChooser(askReachOf(s), askDirectOnly(s) || busy, (reach) => {
        if (reach === HOPS_DEFAULT) delete s.askReach; else s.askReach = reach
        save(); render()
      }),
      s.peers.length === 0 ? el('p', { class: 'warn' }, [S.queryNoPeers]) : null,
      demoEnded ? el('p', { class: 'warn' }, [S.demoEndedLine]) : demoWaiting && s.testOf ? el('p', { class: 'warn' }, [S.demoWaitingAsk(s.testOf.name)]) : null,
      box,
      run ? null : el('div', { class: 'chips' }, [
        el('span', { class: 'chips-lbl' }, [S.queryTry]),
        ...SUGGESTIONS.map((q) => el('button', { class: 'chip', onclick: () => { queryText = q; render() } }, [q])),
      ]),
      el('button', {
        class: 'btn btn-electric wide', disabled: busy || s.peers.length === 0 || demoWaiting || demoEnded,
        onclick: () => void runAsk(queryText),
      }, [S.querySend]),
      inFlight,
      // With the Feed off (the default since wave 2) this is where earlier answers stay readable (review-wave2).
      !run && !feedOn(s) && (s.found?.length ?? 0) > 0 ? el('div', { 'data-earlier-answers': '1' }, [foundView(s, S.queryEarlier)]) : null,
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
      el('span', { class: 'eyebrow' }, [askEyebrow(a)]),
      el('h2', {}, [S.askFrom(a.fromName)]),
      el('p', { class: 'ask-q' }, ['"' + a.text + '"']),
      decided === null
        ? el('div', {}, [
            el('p', { class: 'ask-lbl' }, [S.askMatches]),
            ...a.matches.map((m) => el('div', { class: 'ask-line' }, [el('span', {}, [m.text, threadIsDemo(st(), m.threadId) ? dummyChip() : null]), el('small', {}, [m.context])])),
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

/** Who handed this ask over: a front door (older doors name themselves as the asker), the people it came through, or nobody. */
function askEyebrow(a: IncomingAsk): string {
  if (a.doorName) return S.askThroughDoor(a.doorName)
  if (a.relayed) return S.askRelayed(a.fromName)
  return a.through.length ? S.askThrough(a.through) : S.askEyebrow
}

function decide(share: boolean): void {
  const a = askShowing
  if (!a || askDecision !== null) return
  askDecision = share
  renderAsk()
  void a.decide(share)
}

// ---------------------------------------------------------------------------
// install on the home screen (install.ts): the real app only, never inside the
// side-by-side demo's phones or a demo account's second tab
// ---------------------------------------------------------------------------

const installable = !solo && !isDemoPersona(persona) && window.top === window

const installSheets = createInstallSheets({
  sheet, state: () => state, setState: (s) => { state = s; save() }, openSheet, closeSheet, toast, render, backup,
  openBackup: () => go(Screen.Inventory),
})
const openInstallSheet = installSheets.openInstall

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

render()
if (installable) setUpInstall(APP_URL, () => { if (sheet.dataset.kind === 'install' && sheet.classList.contains('on')) openInstallSheet() })
const afterCarry = (): void => { if (installable && wantInstall) openInstallSheet() }
if (pendingCarry) installSheets.carryAsk(pendingCarry, () => { pendingCarry = null; afterCarry() })
else {
  if (carryNotice) toast(carryNotice)
  afterCarry()
}
if (state && !state.testOf?.handedOverAt) {
  void net.start().then(announceLink)
  void completePendingConnect()
  maybeOpenPendingShare()
  offerDemoContent()
  sweepDemoAccounts()
  setInterval(sweepDemoAccounts, 60_000)
  // Wave 6: knowing this site's front door lets its forwarded asks go on through this phone (mayPassOnFrom).
  if (!solo && !state.testOf) void probeDemoPeer()
  // Round B: a cut-off server job reads "may still be charged"; early packs whose transcript is done go out;
  // kept meetings whose transcript was still arriving look for it.
  if (swiss.enabled()) {
    transcription.boot()
    // Someone who uses the Swiss server gets its status at once (the past meetings' buttons depend on it);
    // nobody else is asked anything at app open (review-app-b).
    if (transcription.anyConsent() || transcriptionChoice(st()) === TranscriptionChoice.Server || readHosting(st())?.on === true) void swiss.probe()
    hosting.boot()
  }
  packs.checkLate()
  // Resume the approve step after a reload while a phone still waits.
  const pending = demoAccounts().find((t) => t.pending)
  if (pending) showAllowCard(pending)
}
