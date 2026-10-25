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
import { createViaCard } from './via_card'
import './styles.css'
import { el, clear } from '../../demo/src/ui/dom'
import { COLOUR_TAGS_EVENT, PERSON_GREEN, arcsGradient, loadColourTags, tagColours, tagsOf } from './colour_tags'
import { askPeers, isBlocked, isNonResponsive } from './non_responsive'
import { allowReachOut } from './reach_out_guard'
import { DESIRE_DEFAULT, FAMILY_FIELD, RINGS_LABEL_CAP, angleFromCentre, angleOf, beyondRings, lapRadius, placeOnRing, restoreAngles, ringAt, ringsGeometry, spaceOut, webSlot } from './rings_layout'
import type { RingsGeometry } from './rings_layout'
import { RINGS_HIDDEN_KEY, guideDimmed, parseHidden, serializeHidden, toggleHidden, togglePoints, visiblePeople } from './rings_hide'
import { displayName } from '../../../packages/person-fields/src/display_name'
import { renderQr } from '../../demo/src/ui/qr'
import { createShortLinker } from './short_link'
import type { ShortLinker } from './short_link'
import { createLinkChooser } from './short_link_view'
import { canRegister, createConnectKeeper, repairConnectRecord } from './connect_code'
import { createNamesSync } from './names_sync'
import type { NamesSync } from './names_sync'
import { createNamesView } from './names_view'
import { GENERAL_NOTE_MAX, createAutosaver, generalNoteOf, repairGeneralNotes, setGeneralNote } from './general_notes'
// import { SafetyPlace, markFirstTimeShown, offerFirstTime } from './reassurance'
// import { safetyLink, safetySheetNodes } from './reassurance_view'
import { createTimelineSection } from './timeline_view'
import { addEntries, parseTimelineImport, timelineOf } from './timeline'
import type { ConnectKeeper } from './connect_code'
import { createConnectView } from './connect_view'
import type { ConnectView } from './connect_view'
import { renderConnectAdd } from './connect_add_view'
import { acceptWant, addWant, dismissWant } from './wants_to_connect'
import { createAdvanced, createShareRow, createSharingLine } from './connect_advanced_view'
import { BOX_CHANNELS, createContactBox } from './contact_box_view'
import type { ContactBox } from './contact_box_view'
import {
  ShareMode, channelOf, advancedModes, defaultModes, effectiveMode, isOnlyMessenger, isShareMode, modePayload, modeSharing, needsCameraApp, parseVia, publicLinkVia, repairShareFields, viaFragment,
} from './share_modes'
import { resolveAddInput, ParseError, connectLinkOf } from './add_by_code'
import { check as checkFreshness, remember as rememberNonce } from './connect_freshness'
import { inviteText, sendInvite } from './invite'
import { dismissNotice, namePreviousId, noticeShown, noticesOff, setNoticesOff } from './notices'
import type { AddFailure, StampedLink } from './add_by_code'
import { cleanHelloName, helloText, parseHelloText, wantsHelloName } from './hello'
import type { ConnectAddHandle } from './connect_add_view'
import type { LinkChooser } from './short_link_view'
import { type ConnectLinkParams } from '../../demo/src/connect_link'
import { randomId } from '../../demo/src/crypto'
import { Net } from './net'
import { stripUnsafe } from './safe_text'
import type { AskResult, IncomingAsk, RelayStatus } from './net'
import { AboutKind, ageLabel, archivedInvite, askDirectOnly, Audience, AUDIENCES, Channel, CHANNELS, DEFAULT_RECORDINGS, DefaultRecording, defaultRecording, demoAccountScope, demoOnlyForDemoAccounts, enginePlan, featureOn, feedOn, setFeature, HintId, HINTS, isDemoItem, isDemoPerson, LEANS, LineStatus, pastMeetings, ProvenanceState, QueryStyle, RECORD_LINE_AUDIENCE, Ring, RINGS, REACH_OUT_INK, reachOutLegendShown, ringColor, ServerJobState, TabOrder, Tag, TAGS, threadIsDemo, ENGINE_CHOICES, TranscriptionChoice, transcriptionChoice } from './model'
import { CONSENSUAL_AGREEMENTS_LINK, channelLink, normalizeHandle } from './channel'
import {
  REQUESTABLE, answerPlan, buildContactPayload, chatOnConsensual, consensualReachable, contactText, holdContact, mayAnswerRequest, mayAskAgain, parseRequestText, primaryReachable, reachableChannels,
  receiveContactText, requestText, settleDefaultTick, sharedReachables, takeContact, withTick,
} from './contact_share'
import type { HeldContacts, Reachable, ShareSettings } from './contact_share'
import { TextKind, markRead, migrateChats, peersWithPending, receiveText, removeThread, routeText } from './chat'
import type { ChatBook } from './chat'
import { bindRe, makeRe } from './chat_re'
import type { ChatRe } from './chat_re'
import { askWhenLabel, flushPending, renderChat, renderShareControls } from './chat_view'
import type { ChatIo, ChatStrings, ShareStrings } from './chat_view'
import type { AppState, DemoAccount, Found, InventoryItem, ItemSource, NoteLine, PastMeeting, Peer, Person, ReceivedShare } from './model'
import { SOURCES, lineShown, removeSource, setHiddenSources, setSourceHidden, shown, sourceCount, sourceHidden } from './sources'
import { parseShareFragment, parseShareText, SHARE_PARAM, shareFragment, shareUrl } from './share'
import type { MeetingPack, ShareLink } from './share'
import { extractLines } from './notes'
import { S } from './strings'
import { networkChosen } from './network_graph'
import { createNetworkView } from './network_view'
import { knowsRow } from './knows_view'
import { clearState, isEphemeral, loadState, parseRecord, saveState, storageKey, wasUnreadable } from './store'
import { cardFor, cardForNewPeer, personOf, repairPeerCards } from './peer_cards'
import { addAwayAsk, dismissAwayAsk } from './away_asks'
import { NoticePlace, QUIET_CARD_MS, StackCardKind, hidesItself, msgNoticePlace, stackCards } from './card_stack'
import type { StackCard } from './card_stack'
import { drawStack } from './card_stack_view'
import type { StackOpen } from './card_stack_view'
import { ringRaised } from './reask'
import { LEGACY_WINDOW_MS } from './ask_window'
import { dismissLateAnswer, releaseLateAnswers, shownLateAnswers } from './late_answers'
import { dismissUnmatchedAsk, showsUnmatched } from './unmatched_asks'
import { watchWake } from './wake_watch'
import { StoredChange, adoptInPlace, storedChange } from './tab_sync'
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
import { devEventsFile, mergeDevEvents, pushDevEvents } from './dev_events'
import { devRecordFile, seedDevRecord, seedHostedDevRecord } from './dev_record'
import { addNetworkDemo } from './network_seed'
import { demoShown, hideDemoContent, showDemoContent } from './demo_hide'
import { initDevFeature } from './dev_feature'
import { AgreementStatus, acceptAgreement, acceptText, addAgreement, parseAgreementText, proposalText, receiveAgreement, removeAgreement, repairAgreements } from './agreements'
import { agreementsSection } from './agreements_view'
import { isJpegDataUrl } from '../../demo/src/types'
import { addNorm, autoSendRank, buildProfileText, receiveProfileText, removeNorm, repairProfile, setOne, sliceFor, zoneOf } from './profile'
import type { Zone } from './profile'
import type { MyProfile } from './profile'
import { profileSheetNodes, theirProfileBlock } from './profile_view'
import { APK_URL, apkPart, currentEnv, isAndroidAgent, isIosAgent, onApkDownload, setUpInstall } from './install'
import { apkHintKind, apkSettingsRow, type ApkHintEnv } from './apk_hint'
import { runsAsInstalledApp } from './standalone_app'
import { DESKTOP_KEY, DEX_URL, UI_VIEWS, UiView, desktopView, wideAllowed } from './desktop_view'
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
import { editLineText, removeLine } from './person_notes'
import { createSwissContext, readHosting } from './swiss_context'
import { createTranscriptionView } from './transcription_view'
import { createHostingView } from './hosting_view'
import { createSnapshotView } from './snapshot_view'
import { createSyncView } from './sync_view'
import { repairOtherCodes } from './sync_code'
import { careForCodes } from './sync_codes'
import { importGroup } from './import_view'
import { createCurator, curatorHiddenIds } from './curator'
import type { LentRings } from './curator'
import { intendingReminder, knownWays, lastMessagedAt } from './intending_reminder'
import { createFeedView } from './feed_view'
import { createEventsView } from './events_view'
import { addInviter, applyHostLink, eventLabel, joinEvent, tagLabel, whenLabel as eventWhen } from './events'
import { contextPress } from './context_press'
import { decodeEventLink, linkOrigin } from './event_link'
import { sendHit } from './org_hits'
import type { LinkedEvent } from './event_link'
import { ImageStore, SHARE_SIDE, shrink } from './image_store'
import { PersistState, persistState } from './storage_persist'
import type { JobTake } from './server_transcription'
import { createPackView } from './pack_view'
import { addToOutbox, transcriptStillComing } from './late_pack'
import { ICONS } from './icons'
import type { PastFocus } from './past_meetings_view'
import { DEMO_LIFETIME_MS, DEMO_SUFFIX, demoAccountName, demoFragment, demoPersona, handoverFragment, isDemoPeerRef, isDemoPersona, parseDemoFragment, parseHandoverFragment, timeLeft } from './demo_account'
import type { DemoPeerRef, HandoverLink } from './demo_account'
import { askReachOf, askWaitMs, HOPS_DEFAULT, readVia } from './hops'
import { fitOfAsk, queueAsk, togetherAsk } from './together_match'
import { geoPicker } from './together_location'
import type { Place } from './together_location'
import { fillFromPrefs, liveTogetherPrefs, rememberTogether } from './together_prefs'
import { draftOrPlain, readTogetherRequest } from './together_request'
import type { TogetherRequest } from './together_request'
import { answerTitle, cascadeInfoButton, cascadeInfoContent, degreesChooser, degreesPill, onOffSwitch, passOnRow, reachChooser, throughTag } from './hops_view'
import { RINGS_ZOOM_HOME, type RingsZoom, type ZoomView, panBy, transformOf, zoomAt } from './rings_zoom'
import { joinFrontDoor, mergeOneJakob, ownFrontDoor, passOnAllowed, personOfPeer, samePersonTarget } from './one_jakob'
import { kindsOf, NOTIFY_KINDS, wantsKind } from './notify_kinds'
import type { NotifyKind } from './notify_kinds'
import { pushBundleOf, pushSupported, showNotification, subscribePush, unsubscribePush, workerRegistration } from './push'
import { apkParam, apkSessionVersion, isApkSession, latestApkVersion, newerVersion, rememberApkSession, updateCheckDue } from './apk'
import { createToast, type ToastOpts } from './toast'
import { nativeApp, routeFetchToServer, SERVER_ORIGIN } from './native_app'
import { clearNativeBundle, nativePushAvailable, nativePushPermission, registerNativePush, writeNativeBundle } from './native_push'
// Static, not import(): a lazy import made Rolldown put its namespace helper into this entry's chunk, so the demo pages (solo.ts
// imports walkthrough too) ran this whole app without an #app and stayed blank (live 2026-10-19). test/scan_demo_entries.mjs (CI, after the build) guards it.
import { mountWalkthrough } from './walkthrough'

enum Screen {
  Start = 'start',
  Web = 'web',
  Inventory = 'inventory',
  Record = 'record',
  Meeting = 'meeting',
  Meet = 'meet',
  Review = 'review',
  Place = 'place',
  StillTrue = 'still',
  /** What people in your web shared with you, and what you share (wave 1733 round B). */
  Feed = 'feed',
  /** Events: where and when I met people (E1, wave 7); opened from the Web screen. */
  Events = 'events',
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

declare const __TW_PREVIEW__: object | null | undefined
// Wave 12 (native_app.ts): inside the iPhone app, root-relative requests go to the server, not into the bundle. Before any fetch.
routeFetchToServer()
const APP_URL = location.origin + import.meta.env.BASE_URL
/** Connect links name the live app on a local, LAN or dev-slot page, so they open on any device. */
const CONNECT_URL = linkOrigin(location.origin) + import.meta.env.BASE_URL
const params = new URLSearchParams(location.search)
const personaParam = params.get('persona')
// A demo account opened on the owner's own phone runs under its own persona
// (demo-<account id>): its own storage record and relay identity, next to his.
// Dev preview only: ?dev=1..6 is a second-device frame with its own record (dev_device2.ts); a build ignores it.
const devParam = typeof __TW_PREVIEW__ !== 'undefined' && __TW_PREVIEW__ ? /^[1-6]$/.exec(params.get('dev') ?? '')?.[0] : undefined
const persona: string = isPersona(personaParam) || isDemoPersona(personaParam) ? personaParam : devParam ? 'dev' + devParam : 'me'
const solo = params.get('solo') === '1' && isPersona(persona)
// Which of the three seeded demo networks (seed.ts DemoContext) to show,
// passed in by solo.ts from its own page path. Only meaningful (and only
// ever read/written into storage) when solo: a real visitor at the app root
// (persona 'me') must keep using the original, context-less storage key --
// see store.ts's own module doc for why.
const ctxParam = params.get('ctx')
const ctx: DemoContext = isDemoContext(ctxParam) ? ctxParam : DemoContext.Generic
const storeCtx = solo ? ctx : undefined
let pendingConnect: StampedLink | null = connectLinkOf(location.search)
/** Wave 8: set when the account is made from the start screen of a connect link: that connect is a reach-out, not an invitation. */
let reachOutPending = false
let heldToasted = false
// Notes shared by a Meet code ride in the URL FRAGMENT (#n=...), which a
// browser never sends to the server, so they stay out of access logs.
const sharedNotes = (new URLSearchParams(location.hash.slice(1)).get('n') ?? '').slice(0, 600)
// A TrustWeb + Signal / WhatsApp link names its channel (#via=SIGNAL, share_modes.ts): connecting on that messenger is one more tap.
const viaChannel = pendingConnect ? parseVia(location.hash) : null
const viaCard = createViaCard()
// A demo-account link (QR > Demo account on the inviter's phone, 2026-10-06):
// the account name and, optionally, the demo inventory peer, also in the fragment.
const demoLink = pendingConnect ? parseDemoFragment(location.hash) : null
// A hand-over link (?handover=1#k=...): a demo account moves to this phone.
const handover: HandoverLink | null = params.get('handover') === '1' ? parseHandoverFragment(location.hash) : null
// A meeting sent inside TrustWeb (?share=1#k=...&t=...), or riding in a Meet
// code after a meeting (#n=...&k=...&t=...): opened once the app is up (share.ts).
let pendingShare: ShareLink | null = params.get(SHARE_PARAM) === '1' || pendingConnect ? parseShareFragment(location.hash) : null
// An event link (#ev=..., event_link.ts): the join sheet opens once the app has a record; the fragment goes below either way.
let pendingEvent: LinkedEvent | null = decodeEventLink(location.hash)
// ?install=1 (the website's and the demo's Install button): open the Install sheet once the app is up (install.ts).
const wantInstall = params.get('install') === '1'
/** Wave 18 review b: a page opened by a link (connect, share, event, hand-over, install) shows what the link is for; the Desk does not open under it. */
const openedByLink = Boolean(pendingConnect || pendingShare || pendingEvent || handover || wantInstall)
// Wave 11 (apk.ts): opened by the Android app, which names its shell version; remembered for this session before the URL is cleaned.
const apkLaunch = apkParam(params)
if (apkLaunch) rememberApkSession(apkLaunch)
/** The app on a home screen: a standalone PWA, this session inside the APK (which runs as a tab until the origin vouches for it), or the iPhone app. */
function installedHere(): boolean {
  return runsAsInstalledApp() || isApkSession() || nativeApp
}
// Keep only what a reload needs; the connect parameters are consumed once.
history.replaceState(null, '', location.pathname + (solo ? `?persona=${persona}&solo=1&ctx=${ctx}` : isDemoPersona(persona) ? `?persona=${persona}` : devParam ? `?dev=${devParam}` : ''))

if (!solo) seedDevRecord(persona)
// Dev only: the define is the literal null in a build, so this branch and the whole panel chunk are dropped from it.
if (!solo && typeof __TW_PREVIEW__ !== 'undefined' && __TW_PREVIEW__) void import('./dev_preview').then((m) => { m.initDevPreview() })
if (!solo) initDevFeature()
let state: AppState | null = loadState(persona, storeCtx)
// A record that is there but unreadable was kept aside untouched (store.ts);
// nothing is merged over it, and the person is told.
const recordKeptAside = wasUnreadable(persona, storeCtx)
// Wave 6f review (tab_sync.ts): another tab's newer record was taken over while a sheet was open or a field had the focus (the screen is
// drawn again once that ends); and: another tab reset this record or gave it another identity, so this tab never saves again.
let redrawWaiting = false
let superseded = false
// A preview slot (dev.trustweb.one) opens with Jakob's record too (dev_record.ts, 2026-10-19): fetched after boot; when it changed
// what is stored, this tab stops saving and reloads into it.
if (!solo) void seedHostedDevRecord(persona).then((changed) => { if (changed) { superseded = true; location.reload() } })
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
// The field repairs of waves 6b and 6e run in their own block, so a failure of a migration above (state reloaded as stored) does not skip
// them (review 6e). Each never throws on its own; the block is a second net.
try {
  if (state) {
    // Wave 6b (connect_code.ts): a stored connect code that is not a well-formed record is dropped.
    const codeFixed = [repairConnectRecord(state), repairOtherCodes(state)].some(Boolean)
    // Wave 6e (share_modes.ts): a stored share mode or pin list that is not valid is dropped.
    const modesFixed = repairShareFields(state)
    // Wave 6e (general_notes.ts): a stored General note that is not text, too long or empty is repaired.
    const notesFixed = repairGeneralNotes(state)
    // Wave 7 (profile.ts): a stored profile of the wrong shape is dropped.
    const profileFixed = repairProfile(state)
    // Wave 7 (agreements.ts): stored agreements that are not well formed are dropped.
    const agreementsFixed = repairAgreements(state)
    if (codeFixed || modesFixed || notesFixed || profileFixed || agreementsFixed) save()
  }
} catch { /* the readers clean these fields themselves (connect_code.ts, share_modes.ts, general_notes.ts) */ }
// Wave 6f (peer_cards.ts): a card that a later connection took over goes back to its own connection, and every connection has a card.
// A real phone's own record only (not the side-by-side demo, not a demo account's view). Never throws; a failure changes nothing.
try {
  if (state && !solo && !isDemoPersona(persona) && !state.testOf) {
    if (repairPeerCards(state, () => true, () => randomId(8), S.peerCardRepairedContext, Date.now())) save()
  }
} catch { /* the record stays as loaded */ }
// Dev only (dev_events.ts): the events and tags remembered in dev-events.json join the record before the first render.
{
  const remembered = devEventsFile()
  if (state && !solo && remembered && mergeDevEvents(state, remembered)) save()
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
  if (state && !superseded) {
    saveState(persona, state, storeCtx)
    pushDevEvents(state)
    mirrorPushBundle(state)
  }
}

// Wave 11: the service worker's copy of what it needs to read a waiting wire (push_bundle.ts), refreshed after a save while
// notifications are on; one write per tick however many saves.
let mirrorTimer: ReturnType<typeof setTimeout> | null = null
function mirrorPushBundle(s: AppState): void {
  if (!s.notificationsOn || !(pushSupported() || nativeApp) || mirrorTimer) return
  mirrorTimer = setTimeout(() => { mirrorTimer = null; void writePushBundleNow() }, 250)
}

/** The bundle the worker reads (push_bundle.ts), or in the iPhone app the one the notification extension reads (native_push.ts). */
function writePushBundleNow(): Promise<void> {
  return pushBundleOf(st(), SERVER_ORIGIN, S.appName, nativeApp ? writeNativeBundle : undefined).write()
}

/** The relay's last word on this phone's push subscription (Settings > Notifications shows a hint when it cannot wake us). */
let pushState: 'kept' | 'forgotten' | 'rejected' | 'unavailable' | 'unsupported' | 'no-worker' | 'relay-no-push' | 'denied' | 'failed' | null = null

/** Subscribes this phone for wake-ups (push.ts; in the iPhone app native_push.ts) and tells the relay; on boot while on, and when the person turns notifications on. */
async function refreshPush(): Promise<void> {
  const s = st()
  if (!s.notificationsOn) { net.setPush(null); await unsubscribePush(); if (nativeApp) await clearNativeBundle(); return }
  if (nativeApp) {
    const r = await registerNativePush()
    if (r.ok) { net.setPush(r.sub); await writePushBundleNow() }
    else pushState = r.why
    return
  }
  // The worker also shows this page's own notifications while it is hidden (push.ts showNotification), push or no push.
  await workerRegistration()
  const r = await subscribePush(SERVER_ORIGIN)
  if (r.ok) { net.setPush(r.sub); await writePushBundleNow() }
  else pushState = r.why
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

let screen: Screen = state ? Screen.Web : Screen.Start
let relayStatus: RelayStatus = 'connecting'
let draft: Draft = freshDraft()
let review: Review | null = null
let queryOpen = false
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
/** Asks a fitting together ask already went ahead of (together_match.ts queueAsk). */
const askOvertaken = new WeakSet<IncomingAsk>()
let askShowing: IncomingAsk | null = null
let askDecision: boolean | null = null
/** Wave 6h: the decision on the prompt went as a late answer. */
let askDecidedLate = false
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

// Wave 6h (ask_window.ts): real phones ask with the 120 s window; the side-by-side demo keeps the 30 s one (two phones on one screen).
// Wave 12: the iPhone app names the relay (its own origin is the bundle's).
const net = new Net({
  state: st,
  save,
  onStatus: (s) => { relayStatus = s; updateStatusPill(); updateConnectionRow(); if (s === 'connected') void flushAllChats() },
  onPush: (outcome) => { pushState = outcome },
  onAsk: (ask) => {
    // Wave 19: an incoming together ask that fits one of this person's own settings goes ahead of the ones that do not.
    queueAsk(askQueue, ask, (a) => fitOfAsk(a.text, st().togetherPrefs, Date.now()) !== null, askOvertaken)
    notify('ask', S.notifBodyAsk(ask.fromName))
    if (!askShowing) showNextAsk()
  },
  onPeerConnected: (peer) => {
    const s = st()
    // Wave 16 (Jakob 2026-10-19): a reach-out through my link waits under the web for Add or Dismiss, not on the rings.
    if (peer.reachOut && !s.people.some((p) => p.peerId === peer.id)) {
      addWant(s, { peerId: peer.id, name: peer.displayName, at: Date.now() })
      save()
      sendHelloTo(peer)
      void autoShareProfile(peer, 'public')
      toast(S.notifBodyConnect(peer.displayName))
      notify('connect', S.notifBodyConnect(peer.displayName))
      render()
      return
    }
    const byName = draft.name.trim()
    // Wave 6f (peer_cards.ts): the Meet draft's name only claims a card that no connection holds yet; the second person to connect
    // while the code is on screen gets a card of their own (before, they took over the first one's card and never showed).
    let person = cardForNewPeer(s.people, peer, byName)
    if (!person) {
      if (screen === Screen.Meet && !byName) draft.name = peer.displayName
      person = { id: randomId(8), name: peer.displayName, context: draft.context, ring: peer.ring, metAt: Date.now(), lines: [] }
      s.people.push(person)
    }
    if (person.doorPeerId !== peer.id) person.peerId = peer.id
    save()
    sendHelloTo(peer)
    void autoShareProfile(peer, 'public')
    applyHeldContact(peer, person)
    closeSheet()
    toast(S.peerConnectedToast(peer.displayName, S.ringLabel[peer.ring]))
    notify('connect', S.notifBodyConnect(peer.displayName))
    render()
  },
  // A reach-out through the public link: over 10 an hour, or paused, it makes no card and gets no answer (counted, one toast per session).
  refuseReachOut: () => {
    const s = st()
    const r = allowReachOut(s.reachOutLog ?? [], Date.now())
    if (!s.reachOutsPaused && r.ok) { s.reachOutLog = r.log; save(); return false }
    s.reachOutHeld = (s.reachOutHeld ?? 0) + 1
    save()
    if (!heldToasted) { heldToasted = true; toast(S.reachOutsHeld(s.reachOutHeld)) }
    return true
  },
  // A phone opened one of this phone's demo-account codes: hold it until the
  // owner allows it in his own view (owner 2026-10-06). Matched by the name
  // the code carried; a second phone on the same code replaces the first.
  holdPeer: (peer) => {
    const acct = demoAccounts().find((t) => t.name === peer.displayName)
    if (!acct) return false
    acct.pending = peer
    save()
    notify('connect', S.demoAcctAllowTitle(acct.name))
    showAllowCard(acct)
    return true
  },
  // A connection this phone already holds sent its ack again: the owner allowed this demo account, or (wave 6f) a phone that opened
  // this phone's link is still waiting to hear back (ack_retry.ts): make sure it has a card, and answer with the hello once per visit.
  onPeerConfirmed: (peer) => {
    const s = st()
    if (!s.testOf) { onAckAgain(peer); return }
    if (s.testOf.approvedAt || s.testOf.name !== peer.displayName) return
    s.testOf.approvedAt = Date.now()
    save()
    toast(S.demoApprovedToast(peer.displayName))
    render()
  },
  ringForNewPeer: () => (solo ? Ring.Friend : Ring.Acquaintance),
  onLogChanged: () => { if (screen === Screen.Inventory) render() },
  // A demo account asks: while demo content is on this phone it is matched
  // against the dummy content only (owner 2026-10-06: Max is not part of the demo).
  askerTags: (peer) => { const tags = loadColourTags(); const who = st().people.find((p) => p.peerId === peer.id); return who ? tagsOf(who, tags).map((t) => t.id) : [] },
  askScope: (peer) => (demoAccounts().some((t) => t.peerId === peer.id) ? demoAccountScope(st()) : undefined),
  onText: (peer, text, ts, re, pic) => onIncomingText(peer, text, ts, re, pic),
  // Wave 6 (one_jakob.ts): this site's front door (demo-peer.json) counts as this phone's own when it carries this phone's name.
  mayPassOnFrom: (peer) => passOnAllowed(st(), peer, ownDoorDid()),
  samePerson: (target, sender) => samePersonTarget(st(), target, sender, ownDoorDid()),
  // Wave 6f (ack_retry.ts): a real phone re-sends its connect-ack until the other phone answers; never the side-by-side demo, a demo
  // account's view, a demo account of this phone, or this site's demo front door (its flows are their own).
  // Not before demo-peer.json is known (review 6f: the first 'connected' can come before it, and a first visit from a link never
  // probes it at boot): it is asked for here, and resendAcks runs again once it is known.
  mayResendAck: (peer) => !solo && !isDemoPersona(persona) && !st().testOf && !demoAccounts().some((t) => t.peerId === peer.id)
    && demoPeerKnown() && peer.did !== demoPeer?.did,
  onAwayAsk: (ask) => { const s = st(); s.awayAsks = addAwayAsk(s.awayAsks, ask, Date.now()); save(); showAskCards() },
  // Wave 6h (unmatched_asks.ts): "<name> asked about X; nothing matched", for the asked person only; never for a demo account's asks.
  keepsUnmatched: (peer) => !solo && showsUnmatched(st(), demoPhone()) && !demoAccounts().some((t) => t.peerId === peer.id),
  onUnmatchedAsk: () => showAskCards(),
  // Review 6h: late answers that waited on the relay while the app was closed, handed over right after this open (late_answers.ts).
  onLateAnswersReleased: () => showAskCards(),
  // Wave 6i (reask.ts): a real phone re-sends its earlier unanswered asks to a connection that tightened its ring (never the demo flows).
  mayReask: (peer) => mayAskAgainWith(peer),
}, { ...(solo ? { answerWindowMs: LEGACY_WINDOW_MS } : {}), ...(nativeApp ? { relayOrigin: SERVER_ORIGIN } : {}) })

/** A phone that shows TrustWeb to someone (the side-by-side demo, a demo persona, a demo account's own view): some defaults differ. */
function demoPhone(): boolean {
  return solo || isDemoPersona(persona) || Boolean(state?.testOf)
}

/** Peers this visit already answered with a hello after a repeated ack (one hello per peer per visit stops their re-sends). */
const helloAgainSent = new Set<string>()

/** Wave 6f: a known connection's ack came again. It gets a card if it has none, and one hello per visit. */
function onAckAgain(peer: Peer): void {
  const s = st()
  if (solo || isDemoPersona(persona)) return
  if (!personOf(s.people, peer.id)) {
    s.people.push(cardFor(peer, randomId(8), S.peerCardRepairedContext, Date.now()))
    save()
    toast(S.peerConnectedToast(peer.displayName, S.ringLabel[peer.ring]))
    render()
  }
  if (helloAgainSent.has(peer.id)) return
  helloAgainSent.add(peer.id)
  sendHelloTo(peer)
}

/**
 * Review 6h (late_answers.ts): the app was opened (started, or back in front after a long time away). Late answers kept until now are
 * released, all together, and those the relay hands over right after this open count as part of it (net.ts markOpened). Returns
 * whether any is now there to show.
 */
function appOpened(): boolean {
  const s = st()
  const now = Date.now()
  // Nothing kept writes nothing: a fresh install stores no empty late list (wave 6h gate fix, install_flow).
  if (Array.isArray(s.lateAnswers) && s.lateAnswers.length) { s.lateAnswers = releaseLateAnswers(s.lateAnswers, now); save() }
  // Wave 6i: an open shows the quiet "nothing matched" card again, even one that hid itself in the last visit.
  quietHidden.clear()
  net.markOpened(now)
  return shownLateAnswers(s.lateAnswers, now).length > 0
}

/**
 * Wave 6i (card_stack.ts): the quiet cards (new messages, late answers, asks that matched nothing, asks that came while away) sit in
 * the Web screen's flow, above the rings: they never cover anything (review 6h R10). Not over an open ask dock (it needs the room),
 * nor while a demo account waits for its Allow card. Drawn in place, without a redraw of the screen.
 */
function showAskCards(): void {
  drawCardStack()
}

/** The element the cards live in; screenWeb puts it above the rings, so it survives a redraw of the screen. */
const cardStackEl = el('div', { class: 'card-stack', 'data-card-stack': '1', 'aria-live': 'polite', hidden: true })
/** Quiet cards that hid themselves in this visit (card_stack.ts QUIET_CARD_MS); an app open shows them again. */
const quietHidden = new Set<string>()
const quietTimers = new Map<string, ReturnType<typeof setTimeout>>()

function drawCardStack(): void {
  if (!state || screen !== Screen.Web || queryOpen || demoAccounts().some((t) => t.pending)) { cardStackEl.replaceChildren(); cardStackEl.hidden = true; return }
  const cards = stackCards(state, Date.now(), demoPhone(), quietHidden, (peerId) => Boolean(personOf(st().people, peerId)))
  drawStack(cardStackEl, cards, stackDeps)
  for (const card of cards) if (hidesItself(card)) hideQuietLater(card.key)
}

/** The quiet card hides itself QUIET_CARD_MS after it first showed (it stays kept). */
function hideQuietLater(key: string): void {
  if (quietTimers.has(key)) return
  quietTimers.set(key, setTimeout(() => { quietHidden.add(key); quietTimers.delete(key); drawCardStack() }, QUIET_CARD_MS))
}

const stackDeps = {
  personIdOf: (peerId: string): string | null => personOf(st().people, peerId)?.id ?? null,
  nameOf: (peerId: string): string => personOf(st().people, peerId)?.name ?? st().peers.find((p) => p.id === peerId)?.displayName ?? '',
  openChat: (personId: string, open: StackOpen): void => chatSheet(personId, open),
  dismiss: (card: StackCard): void => { dismissCard(card); drawCardStack() },
  addLine: (): void => go(Screen.Inventory),
  ringLabel: (ring: Ring | undefined): string => S.ringLabel[ring ?? Ring.Acquaintance],
  now: (): number => Date.now(),
}

function dismissCard(card: StackCard): void {
  const s = st()
  const now = Date.now()
  switch (card.kind) {
    case StackCardKind.Message: s.chats = markRead(s.chats ?? NO_CHATS, card.peerId); break
    case StackCardKind.Late: s.lateAnswers = dismissLateAnswer(s.lateAnswers, card.answer.id, now); break
    case StackCardKind.Unmatched: s.unmatchedAsks = dismissUnmatchedAsk(s.unmatchedAsks, card.ask.id, now); break
    case StackCardKind.Away: s.awayAsks = dismissAwayAsk(s.awayAsks, card.ask.id, now); break
  }
  save()
}

/** The did of this site's front door when it is this phone's own (one_jakob.ts ownFrontDoor); null: none known. */
function ownDoorDid(): string | null {
  return solo || !state ? null : ownFrontDoor(state, demoPeer)
}

/** Wave 11: every arrival has a kind, each with its own switch (notify_kinds.ts); shown only while the page is hidden. */
function notify(kind: NotifyKind, body: string): void {
  if (!state || !wantsKind(state, kind) || !document.hidden || typeof Notification === 'undefined') return
  if (Notification.permission === 'granted') void showNotification(S.appName, body)
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
const toastShow = createToast(toastEl)
/** Wave 6i: the notice for a new message (not the toast: a toast never takes taps, this one does). */
const msgNoticeEl = el('div', { class: 'msg-notice', role: 'status', 'data-msg-notice': '1' })
/** Review 6i: declared with the element, ahead of anything that may open a sheet or the prompt (hideMsgNotice reads it). */
let msgNoticeTimer: ReturnType<typeof setTimeout> | undefined
const MSG_NOTICE_MS = 6_000
const friendsEl = el('div', { class: 'demo-friends', role: 'status', 'aria-live': 'polite', hidden: true })
/** Desktop, bottom left, outside the phone: show or hide the demo content (Settings also removes it). */
const demoToggle = el('button', { class: 'demo-toggle', hidden: true, onclick: () => toggleDemoContent() })
/** Wave 18: above it, only on a wide browser tab: the Desk (full window) <-> the phone version. Kept built, never shown: */
// 2026-10-23: only under Settings > View (Jakob).
const DESK_PILL_SHOWN = false
const deskToggle = el('button', { class: 'demo-toggle desk-toggle', 'data-desk-toggle': '', hidden: true, onclick: () => deskOpen() ? showPhoneVersion() : showDesktopVersion() })
/** Map-local (Jakob 2026-10-23): the TrustWeb view's way back to the Desk, bottom right in the page dock, only on a wide tab while the Desk is closed. */
const deskViewPill = el('button', { class: 'see-action desk-view-pill', 'data-desktop-view': '', hidden: true, onclick: () => showDesktopVersion() }, [S.showDesktop])
let statusPill: HTMLElement | null = null
phone.append(host, tabs, veil, sheet, overlay, toastEl, friendsEl, msgNoticeEl)
root.replaceChildren(phone)
// On a wide screen, outside the phone: open the side-by-side demo (not inside
// the demo's own iframes, and not on a real phone, where the app is full screen).
if (!solo && !isDemoPersona(persona) && window.top === window) {
  const add = el('a', { class: 'add-device', href: APP_URL + 'demo/', title: S.addDevice, 'aria-label': S.addDevice }, [
    el('span', { class: 'add-device-plus', 'aria-hidden': 'true' }, ['+']),
    el('span', {}, [S.addDeviceShort]),
  ])
  const see = el('button', { class: 'see-action', onclick: openWalkthrough }, [S.seeInAction])
  // The installed app is the personal version (owner 2026-10-07): no "Add a device" and no "Show demo content" in its dock; a browser tab keeps both.
  root.append(el('div', { class: 'page-dock' }, runsAsInstalledApp() ? [see, deskViewPill] : [add, see, deskViewPill]), demoToggle, ...(DESK_PILL_SHOWN ? [deskToggle] : []))
}

/**
 * Desktop, outside the phone: the scripted walkthrough of the demo page as an
 * overlay over this page (owner 2026-10-05: may be dropped if it does not look
 * good). Escape or Close ends it and pauses playback.
 */
function openWalkthrough(): void {
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

/** Which query button the owner chose in Settings (default: ask your web). */

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
  const inv = state && !featureOn(state, 'inventory') ? null : tabButton(Screen.Inventory, S.navInventory, 'inventory')
  const invLeft = state?.tabOrder === TabOrder.InventoryLeft
  // Web | Record | Feed | Inventory (round B); with the Feed off, exactly as before.
  const feedTab = state && feedOn(state) ? [tabButton(Screen.Feed, S.navFeed, 'feed')] : []
  tabs.replaceChildren(...[invLeft ? inv : web, recordButton(), ...feedTab, invLeft ? web : inv].filter((b): b is HTMLElement => b !== null))
  tabs.classList.toggle('four', tabs.children.length > 3)
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
    case Screen.StillTrue:
    case Screen.Events:
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
  if (s !== Screen.Web) ringsZoom = RINGS_ZOOM_HOME
  screen = s
  // Wave 6h/6i: the cards belong to the Web screen (card_stack.ts); render() draws them there.
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
    item('users', S.searchCurate, curatorSheet),
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
      || (target === Screen.Web && (screen === Screen.StillTrue || screen === Screen.Events))
    b.classList.toggle('on', on)
  })
  tabs.querySelector('.tab-record')?.classList.toggle('live', recorder.live && !recorder.paused)
  host.className = 'screen on ' + screen + (screen === Screen.Web && queryOpen ? ' querying' : '')
  const body = (() => {
    if (state?.testOf?.handedOverAt) return screenHandedOver()
    switch (screen) {
      case Screen.Start: return screenStart()
      case Screen.Web: return screenWeb()
      case Screen.Inventory: return screenInventory()
      case Screen.Record: return screenRecord()
      case Screen.Meeting: return screenMeeting()
      case Screen.Meet: return screenMeet()
      case Screen.Review: return screenReview()
      case Screen.Place: return screenPlace()
      case Screen.StillTrue: return screenStillTrue()
      case Screen.Feed: return [header(S.feedTitle), feed.body()]
      case Screen.Events: return eventsView.body()
    }
  })()
  host.replaceChildren(...body)
  if (screen === Screen.Web) { drawCardStack(); requestAnimationFrame(fitRings) }
  updateDemoToggle()
  autoDesk()
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
  cardOpenFor = null
  // Review 6i: a "new message" notice above the tab bar would lie over the sheet's controls: it goes (the unread card stays).
  hideMsgNotice()
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
  const wasDesk = deskOpen()
  if (wasDesk) { try { window.localStorage.setItem(DESKTOP_KEY, 'phone') } catch { /* not remembered */ } }
  const wasChat = openChat !== null
  openChat = null
  cardOpenFor = null
  // Wave 6i: a chat just read takes its "new message" card away.
  if (wasChat) drawCardStack()
  // A closed sheet keeps its last content off-screen; inert takes it out of
  // the tab order and the accessibility tree.
  past.stopPlayer()
  sheet.inert = true
  sheet.classList.remove('on')
  veil.classList.remove('on')
  updateDeskToggle()
  // Wave 6f review: a record another tab saved while this sheet was open was taken over then; draw it now (after the handler that closed it).
  if (redrawWaiting) setTimeout(redrawAfterAdoption, 0)
  // The Desk's Web page drew the last rings: the Web screen's own take the geometry back.
  else if (wasDesk && screen === Screen.Web) render()
}

function toast(msg: string, o?: ToastOpts): void {
  toastShow(msg, o)
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
  friendsEl.classList.remove('stack')
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
  // With a dev record the Network view's dummies belong to the demo content too (network_seed.ts).
  if (devRecordFile()) addNetworkDemo(s)
  s.demoOffered = true
  save()
  render()
  showDemoFriends()
}

/** Show demo content: back from hidden, else added; Hide keeps it out of view (demo_hide.ts, 2026-10-19). */
function toggleDemoContent(): void {
  const s = st()
  if (s.demoHidden) { showDemoContent(s); save(); render(); return }
  if (!s.demo) { addDemoContent(); return }
  hideDemoContent(s)
  save()
  render()
  toast(S.demoHidden)
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
/**
 * Wave 11: the installed app (APK or home-screen PWA) asks once, on its first open, whether to turn notifications on.
 * The browser's permission prompt follows the tap (the TWA relays it to Android's own dialog). Not in a browser tab:
 * there Settings > Notifications is the place.
 */
function offerNotifications(): void {
  const s = state
  if (!s || solo || s.notifOffered || s.notificationsOn || !installedHere() || (typeof Notification === 'undefined' && !nativePushAvailable())) return
  if (!nativeApp && Notification.permission === 'denied') { s.notifOffered = true; save(); return }
  const answer = async (yes: boolean): Promise<void> => {
    st().notifOffered = true
    save()
    hideNotice()
    if (!yes) return
    if (!(await notificationPermission())) { toast(S.notifBlocked); return }
    st().notificationsOn = true
    save()
    await refreshPush()
    toast(S.notifOnTitle)
  }
  showNotice(S.notifOfferTitle, S.notifOfferBody, [
    el('button', { class: 'btn btn-electric btn-sm', 'data-notif-offer': 'yes', onclick: () => void answer(true) }, [S.notifOfferYes]),
    el('button', { class: 'btn btn-ghost btn-sm', 'data-notif-offer': 'no', onclick: () => void answer(false) }, [S.notifOfferNo]),
  ])
}

/** Wave 11 (apk.ts): inside the APK, once per six hours, offer a newer shell; the card waits until no other card is up. */
async function offerApkUpdate(): Promise<void> {
  const s = state
  const mine = apkSessionVersion()
  if (!s || !mine || !updateCheckDue(s, Date.now())) return
  s.apkVersion = mine
  s.apkCheckedAt = Date.now()
  save()
  const latest = await latestApkVersion()
  if (!latest || !newerVersion(latest, mine) || !friendsEl.hidden) return
  showNotice(S.apkUpdTitle(latest), S.apkUpdBody, [
    el('a', { class: 'btn btn-electric btn-sm', href: APK_URL, rel: 'noopener', 'data-apk-update': latest }, [S.apkUpdGet]),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: hideNotice }, [S.apkUpdLater]),
  ])
}

/** Settings (inside the APK only): the update check on or off. */
function apkUpdatesRow(s: AppState): HTMLElement[] {
  if (!isApkSession()) return []
  const on = s.apkUpdates !== false
  return [
    el('h4', { class: 'eyebrow' }, [S.setApkGroup(apkSessionVersion() ?? '')]),
    el('button', {
      class: 'radio' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-apk-updates': String(on),
      onclick: () => { s.apkUpdates = !on; save(); settingsSheet() },
    }, [el('b', {}, [S.setApkUpdates]), el('small', {}, [S.setApkUpdatesHint])]),
  ]
}

const TRUSTWEB_SOURCE = 'https://github.com/Evobiosys/trustweb'

/** Wave 16 (apk_hint.ts): what the hint decides from, read now. */
function apkHintEnv(): ApkHintEnv {
  const e = currentEnv()
  return {
    android: isAndroidAgent(navigator.userAgent), ios: isIosAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    apkSession: isApkSession(), standalone: e.standalone,
    dismissedApk: !noticeShown(st(), 'apk-hint'), dismissedIos: !noticeShown(st(), 'ios-soon'),
  }
}

/**
 * Wave 16: the visitor's notice (Android: get the app; iPhone: coming soon), shown until dismissed (Jakob 2026-10-19). It comes FIRST
 * (a sheet slides over it); `then` (the demo-content card) runs once it was answered, or at once when no notice applies. While another
 * card is up it tries again every few seconds.
 */
function offerApkHint(then: () => void): void {
  if (!state || solo) return
  const kind = apkHintKind(apkHintEnv())
  if (!kind) { then(); return }
  if (!friendsEl.hidden) { setTimeout(() => offerApkHint(then), 4500); return }
  const android = kind === 'android'
  const answered = (): void => { hideNotice(); then() }
  const dismiss = (): void => { dismissNotice(st(), android ? 'apk-hint' : 'ios-soon'); save(); answered(); if (android) toast(S.apkHintLaterToast) }
  showNotice(android ? S.apkHintTitle : S.iosSoonTitle, android ? S.apkHintBody : S.iosSoonBody, android
    ? [el('a', { class: 'btn btn-electric btn-sm', href: APK_URL, rel: 'noopener', onclick: () => { hideNotice(); apkDownloadedSheet(then) } }, [S.instApkButton]), el('button', { class: 'btn btn-ghost btn-sm', onclick: dismiss }, [S.apkHintNotNow])]
    : [el('button', { class: 'btn btn-ghost btn-sm', onclick: dismiss }, [S.iosSoonOk])])
  friendsEl.querySelector('span')?.setAttribute(android ? 'data-apk-hint' : 'data-ios-soon', '')
  friendsEl.classList.add('stack')
}

/** Wave 16 (Jakob 2026-10-19): the APK link opens the download and this sheet (sideloading, then the permission off again). `then` after "Got it". */
function apkDownloadedSheet(then?: () => void): void {
  openSheet([el('div', { 'data-apk-downloaded': '' }, [
    el('h3', {}, [S.apkDlTitle]),
    el('p', {}, [S.apkDlBody]),
    el('p', {}, [S.apkDlAfterBefore, el('a', { href: TRUSTWEB_SOURCE, rel: 'noopener', target: '_blank', title: S.apkDlSource }, [S.apkDlCheckOurs]), S.apkDlAfterAfter]),
    el('button', { class: 'btn btn-electric', onclick: () => { closeSheet(); then?.() } }, [S.apkDlOk]),
  ])])
}
onApkDownload(() => apkDownloadedSheet())

function offerDemoContent(): void {
  const s = state
  if (!s || solo || devRecordFile() || s.testOf || s.demoOffered || s.demo || window.top !== window || !isPhoneWidth() || runsAsInstalledApp()) return
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
  if (state) demoToggle.textContent = demoShown(state) ? S.demoHide : S.demoAdd
  updateDeskToggle()
}

const wideTab = (): boolean => window.matchMedia('(min-width: 900px)').matches
const storedDesktop = (): string | null => { try { return window.localStorage.getItem(DESKTOP_KEY) } catch { return null } }
const deskOpen = (): boolean => sheet.classList.contains('on') && sheet.classList.contains('desk-wide') && sheet.dataset.kind === 'curator'
const deskWanted = (): boolean => Boolean(state) && screen !== Screen.Start && !state?.testOf && !isDemoPersona(persona) && window.top === window && desktopView(storedDesktop(), wideTab(), solo, runsAsInstalledApp()) === 'desk'
let deskTried = openedByLink

/** Wave 18: a device with a record on a wide browser tab opens on the Desk, unless it chose the phone version. Decided once, at the first render with a record: a window widened later stays as it is. */
function autoDesk(): void {
  if (!deskTried && state && screen !== Screen.Start) {
    deskTried = true
    if (deskWanted()) openDeskSheet()
  }
  updateDeskToggle()
}

let curatorFace: 'desk' | 'classic' = 'classic'
/** The Curator sheet takes the whole window only on the Desk face AND while the device does not hold the phone version. */
function applyDeskWide(): void {
  sheet.classList.toggle('desk-wide', curatorFace === 'desk' && wideAllowed(storedDesktop(), wideTab(), solo, runsAsInstalledApp()))
  updateDeskToggle()
}

function updateDeskToggle(): void {
  deskToggle.hidden = !DESK_PILL_SHOWN || demoToggle.hidden || !wideTab()
  deskToggle.textContent = deskOpen() ? S.showPhone : S.showDesktop
  deskViewPill.hidden = !wideTab() || deskOpen()
}

function openDeskSheet(variant?: UiView): void {
  // The face last seen is the face the next wide load opens (Jakob 2026-10-23 21:42): every way into the Desk remembers 'desk',
  // closing it remembers 'phone' (closeSheet). Before, only the Settings pill wrote the key, so a Desk opened from the Web side bar
  // or at boot still reopened as the phone next time once 'phone' had been stored.
  try { window.localStorage.setItem(DESKTOP_KEY, 'desk') } catch { /* not remembered */ }
  openSheet([curator.el])
  sheet.dataset.kind = 'curator'
  curator.openDesk(variant)
  updateDeskToggle()
}

// Escape closes an open sheet, except while typing in a field inside it (the Curator is a shadow root: read the composed path).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !sheet.classList.contains('on')) return
  const path = e.composedPath()
  const typing = path.some((n) => n instanceof HTMLElement && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)))
  if (!typing && !document.querySelector('.wt-modal')) closeSheet()
})

function showPhoneVersion(): void {
  try { window.localStorage.setItem(DESKTOP_KEY, 'phone') } catch { /* not remembered */ }
  applyDeskWide()
  go(Screen.Web)
}

/** Wave 19: Settings > View > Classic: the Curator on its classic face, inside the phone. */
function openClassicSheet(): void {
  openSheet([curator.el])
  sheet.dataset.kind = 'curator'
  curator.openClassic()
}

/** Wave 19 (Jakob 2026-10-23): the phone's Settings > View row. This sheet shows only in the TrustWeb view; Dex and Classic lead back to the Curator. */
function viewRow(): HTMLElement {
  const items = UI_VIEWS.map((v) => el('button', {
    role: 'menuitemradio', 'aria-checked': String(v === UiView.TrustWeb), 'data-view': v,
    ...(v === UiView.Dex ? { title: S.views.dexAbout, 'aria-describedby': 'view-dex-info' } : v === UiView.Desk ? { 'aria-describedby': 'view-desk-info' } : {}),
    onclick: () => { if (v === UiView.Dex || v === UiView.Desk) showDesktopVersion(v); else if (v === UiView.Classic) openClassicSheet(); else toggle(false) },
  }, [S.views[v]]))
  const menu = el('div', { class: 'view-menu', role: 'menu', 'aria-label': S.views.pickAria, hidden: true }, [
    ...items,
    el('p', { class: 'meta view-dex-info', id: 'view-dex-info', 'data-dex-info': '' }, [el('a', { href: DEX_URL, target: '_blank', rel: 'noopener' }, [S.views.dexInfo])]),
    el('p', { class: 'meta view-dex-info', id: 'view-desk-info', 'data-desk-info': '' }, [`${S.views.desk}: ${S.views.deskInfo}`]),
  ])
  const pill = el('button', { class: 'view-pill', 'data-view-pill': '', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `${S.views.pickAria}: ${S.views.trustweb}`, onclick: () => toggle(menu.hidden) }, [
    el('span', {}, [S.views.trustweb]), el('span', { class: 'view-pill-half', 'aria-hidden': 'true' }, ['▾']),
  ])
  function toggle(on: boolean): void {
    menu.hidden = !on
    pill.setAttribute('aria-expanded', String(on))
    if (on) items[0].focus()
  }
  menu.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    items[(items.indexOf(document.activeElement as HTMLButtonElement) + step + items.length) % items.length].focus()
  })
  return el('div', { class: 'view-row', 'data-view-row': '' }, [el('b', {}, [S.views.label]), el('div', { class: 'view-pick' }, [pill, menu])])
}

/** `variant`: the phone's Settings > View picked Dex or the TrustWeb Desk; absent, the Desk opens on this device's saved one. */
function showDesktopVersion(variant?: UiView): void {
  try { window.localStorage.setItem(DESKTOP_KEY, 'desk') } catch { /* not remembered */ }
  applyDeskWide()
  openDeskSheet(variant)
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
    window.parent.postMessage({ type: 'trustweb-connect-link', url: net.connectLink(CONNECT_URL) }, location.origin)
  }
}

/** connect_freshness.ts: refuses an old or used link before anything is added or sent, and remembers the nonce of one it takes. `legacy`: no stamp (an older app), accepted. */
function admitLink(link: StampedLink): { ok: true; legacy: boolean } | { ok: false; reason: 'expired' | 'replayed' } {
  const s = st()
  const now = Date.now()
  const v = checkFreshness(link, s.seenConnectNonces ?? [], now)
  if (!v.ok) return v
  if (link.nonce !== undefined) { s.seenConnectNonces = rememberNonce(s.seenConnectNonces ?? [], link.nonce, now); save() }
  if (v.legacy) console.warn('connect link without nonce/ts (older app): accepted, flagged legacy-code')
  return v
}

/** `picked`: the visitor's add sheet ran it (offerPendingConnect) with the typed name and the ring; then their card opens, no second sheet. */
async function completePendingConnect(picked?: { name: string; ring: Ring }): Promise<void> {
  const link = pendingConnect
  if (!link || !state) return
  pendingConnect = null
  drawCardStack()
  const admitted = admitLink(link)
  if (!admitted.ok) { toast(admitted.reason === 'expired' ? S.connectExpired : S.connectUsed, { mark: 'connectRefused' }); return }
  const reachOut = reachOutPending && !solo && !demoLink
  reachOutPending = false
  const ring = picked?.ring ?? (reachOut ? Ring.Intending : solo ? Ring.Friend : Ring.Acquaintance)
  const peer = await net.completeConnect(link, ring, reachOut)
  const s = st()
  let person = s.people.find((p) => p.peerId === peer.id)
  if (!person) {
    person = { id: randomId(8), name: picked?.name || peer.displayName, context: '', ring, metAt: Date.now(), lines: [], peerId: peer.id }
    s.people.push(person)
  } else if (picked) {
    if (picked.name) person.name = picked.name
    person.ring = ring
  }
  if (reachOut && person.ring === Ring.Intending) person.reachedOut = 'sent'
  // The scanning phone shares its slice at connect too (Jakob 2026-10-23 21:42: "the public slice can be shown immediately").
  autoShareToPerson(person)
  if (admitted.legacy) person.connectedVia = 'legacy-code'
  if (sharedNotes) {
    const now = Date.now()
    person.context = S.notesReceivedContext(peer.displayName)
    for (const l of extractLines(sharedNotes)) {
      person.lines.push({ id: randomId(8), text: l.text, tag: l.tag, audience: Audience.OnlyMe, status: LineStatus.Current, notedAt: now, checkedAt: now, source: sharedSource(peer.displayName) })
    }
  }
  // Links never leave at connect time (Jakob 2026-10-15): the named channel is asked for, and the host's answer rules (onContactRequest).
  if (viaChannel && !demoLink) {
    viaCard.expect(person.id)
    net.sendText(peer, requestText(APP_URL, [viaChannel])).then(() => {
      person.contactAsked = Date.now()
      save()
    }, () => { /* the card's ask button stays */ })
  }
  save()
  applyHeldContact(peer, person)
  // A demo account: also connect to the demo inventory peer the link names,
  // then open the ask right away (that is what the account is for).
  if (demoLink) {
    if (demoLink.peer) await connectDemoPeer(demoLink.peer, person)
    queryOpen = true
    toast(S.demoWaitingToast(peer.displayName))
  } else if (picked) {
    addedToast(person, ring)
  } else {
    if (ring === Ring.Intending) addedToast(person, ring, peer.displayName)
    else toast(S.peerConnectedToast(peer.displayName, S.ringLabel[ring]))
  }
  render()
  // Wave 6b: a scanned or pasted link lands on the person: the add sheet, then their card. A demo account and the demo phones keep the direct flow.
  if (demoLink || solo) openPendingShare()
  else if (picked) {
    viaCard.closed(person.id)
    if (!openPendingShare()) personSheet(person.id)
  } else openConnectAdd(peer, person, link.from.displayName)
}

/** After an add: "<name> added." (Intending; tapping it opens their card, Jakob 2026-10-19) or "<name> is in your web." */
function addedToast(person: Person, ring: Ring, name = person.name): void {
  const id = person.id
  if (ring === Ring.Intending) toast(S.personAddedToast(name), { onClick: () => personSheet(id) })
  else toast(S.connectAddedToast(name))
}

/**
 * Wave 16 (Jakob 2026-10-19): a visitor who joined through a link starts with an empty web and the add sheet; only "Add to my web"
 * connects (the reach-out, as before). "Not now" archives the inviter with the link (declineInvite); Restore in the Curator reopens this.
 */
function offerPendingConnect(): void {
  const link = pendingConnect
  if (!link) return
  drawCardStack()
  openSheet(renderConnectAdd({
    name: link.from.displayName,
    ring: Ring.Intending,
    lead: S.connectAddLeadInvite,
    onAdd: (name, ring) => { closeSheet(); void completePendingConnect({ name, ring }) },
    onLater: () => { closeSheet(); declineInvite(link) },
  }).nodes)
}

/** "Not now" (Jakob 2026-10-19): the inviter goes to the Curator's Archive, not connected, the link kept on the entry. */
function declineInvite(link: ConnectLinkParams): void {
  pendingConnect = null
  const p = archivedInvite(link, randomId(8), Date.now())
  st().people.push(p)
  save()
  void curator.hide(p.id).then(archivedNotice, (e: unknown) => console.warn('archive invite', e))
}

/** Restore of an archived invitation in the Curator: its add sheet again; "Add" connects then (a reach-out, as from the link). */
function reopenInvite(link: ConnectLinkParams): void {
  pendingConnect = { ...link, exempt: true } // an invitation this phone already holds: its stamp is not checked again
  reachOutPending = true
  offerPendingConnect()
}

let curatorPulseUntil = 0
const CURATOR_PULSE_MS = 4000

/** After an archive: the toast, and the Web header's Curator icon pulses for a while (where to find them again). Elsewhere the toast alone. */
function archivedNotice(): void {
  toast(S.archivedToast, { mark: 'archivedToast' })
  curatorPulseUntil = Date.now() + CURATOR_PULSE_MS
  phone.querySelector('.curator-btn')?.classList.add('pulse')
  setTimeout(() => phone.querySelector('.curator-btn')?.classList.remove('pulse'), CURATOR_PULSE_MS)
}

/** The code carried the meeting too (notes and transcript, encrypted): open it now. True when something opened. */
function openPendingShare(): boolean {
  if (!pendingShare) return false
  const link = pendingShare
  pendingShare = null
  void openShare(link)
  return true
}

/** The add sheet's "code, name or DID" (add_by_code.ts): look it up, connect, and make the person in the ring picked. A failure comes back as words, nothing is added. */
async function connectByCode(input: string, ring: Ring, name: string, where: string): Promise<AddFailure | { person: Person; existed: boolean; previous?: string }> {
  const out = await resolveAddInput({ origin: SERVER_ORIGIN, fetch: (i, init) => fetch(i, init) }, input)
  if (!out.ok) return out.failure
  if (st().identity?.did === out.link.did) return { type: 'parse', error: ParseError.Own }
  const admitted = admitLink(out.link)
  if (!admitted.ok) return { type: 'stamp', reason: admitted.reason }
  const peer = await net.completeConnect(out.link, ring)
  const s = st()
  let person = s.people.find((p) => p.peerId === peer.id)
  const existed = person !== undefined
  if (!person) {
    person = { id: randomId(8), name: name || peer.displayName, context: where, ring, metAt: Date.now(), lines: [], peerId: peer.id }
    s.people.push(person)
  }
  autoShareToPerson(person)
  if (admitted.legacy) person.connectedVia = 'legacy-code'
  save()
  applyHeldContact(peer, person)
  return { person, existed, ...(out.previous ? { previous: out.previous } : {}) }
}

/** The sheet after a scan (connect_add_view.ts): the person is connected; pick the ring, correct the name, then their card opens. */
let connectAdd: { peerId: string; handle: ConnectAddHandle } | null = null

function openConnectAdd(peer: Peer, person: Person, given: string): void {
  const handle = renderConnectAdd({
    name: given,
    ring: person.ring,
    onAdd: (typed, ring) => {
      const s = st()
      if (typed) person.name = typed
      person.ring = ring
      const held = s.peers.find((x) => x.id === peer.id)
      if (held) held.ring = ring
      save()
      autoShareToPerson(person)
      connectAdd = null
      viaCard.closed(person.id)
      addedToast(person, ring)
      render()
      if (!openPendingShare()) personSheet(person.id)
    },
    onLater: () => { connectAdd = null; closeSheet(); if (!openPendingShare() && viaCard.closed(person.id)) personSheet(person.id) },
  })
  connectAdd = { peerId: peer.id, handle }
  const nodes: Node[] = [...handle.nodes]
  // Wave 6e: a small "Is this safe?" link the first time a scan lands here (reassurance.ts); the sheet comes back to this one.
  // moved to the website later, Jakob 2026-10-14 (the "Is this safe?" link and sheet: here, on the person card and in Settings)
  // if (offerFirstTime(st())) {
  //   if (markFirstTimeShown(st(), Date.now())) save()
  //   nodes.push(safetyLink(SafetyPlace.AddSheet, () => openSheet(safetySheetNodes({ place: SafetyPlace.AddSheet, back: { label: S.safeBackAdd, go: () => openSheet(nodes) } }))))
  // }
  openSheet(nodes)
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
  void autoShareProfile(peer, 'public')
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
    reachOutPending = invite !== null
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
    else offerApkHint(offerDemoContent)
    offerNotifications()
    setTimeout(() => void offerApkUpdate(), 4000)
    void net.start().then(announceLink).then(() => refreshPush())
    if (invite && !solo && !demo) offerPendingConnect()
    else void completePendingConnect()
    maybeOpenPendingShare()
    maybeOpenPendingEvent()
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
            el('b', {}, solo ? [S.connectInvite(inviter)] : [S.reachOutStartBefore, el('span', { class: 'invite-name' }, [inviter]), S.reachOutStartAfter]),
            solo ? null : el('p', { class: 'meta', 'data-reach-out-note': '' }, [S.reachOutStartNote]),
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
      el('button', { class: 'btn btn-electric', onclick: submit }, [demo ? S.demoStart(demo.account) : invite ? (solo ? S.connectJoin : S.reachOutJoin) : S.startOwn]),
    ]),
    !invite && !demo && deviceSyncEligible()
      ? el('button', { class: 'btn btn-ghost btn-sm', 'data-link-from-start': '1', onclick: () => { devices.start(); devices.open() } }, [S.dvLinkIt])
      : null,
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

/** Wave 19: a picture in place of the initials (my own, a blob: URL; or one a person sent, a validated JPEG data URL). */
function pictured(face: HTMLElement, url: string | undefined): HTMLElement {
  if (url) { face.style.background = `url("${url}") center/cover`; face.textContent = '' }
  return face
}

/** The drawn rings of the last render: their radii (in layout units) and the factor that fits a crowded web into the view; a drop or tap is read through both. */
let ringsGeo: RingsGeometry = ringsGeometry({} as Record<Ring, number>)
let ringsK = 1

/** `desk`: the rings lent to the Desk's Web page (curator.ts LentRings): a tap picks the person there, no phone sheets, no add-someone tap or space-out menu. */
function ringsView(s: AppState, marks: Map<string, 'asked' | 'shared'> = new Map(), desk?: LentRings): HTMLElement {
  const C = 176
  const counts = {} as Record<Ring, number>
  const members: Partial<Record<Ring, Person[]>> = {}
  for (const p of s.people) if (!isBlocked(p)) (members[webSlot(p)] ??= []).push(p)
  for (const r of Object.keys(members) as Ring[]) counts[r] = members[r]!.length
  // The layout keeps every person's place; a hidden ring's people are only not drawn (and so not hit-testable).
  const hidden = loadHiddenRings()
  const angles = Object.fromEntries(Object.entries(members).map(([r, ps]) => [r, ps.map(angleOf)]))
  // The close ring depends on the scale (the "you" avatar does not shrink), the scale on the extent: settle on the first scale whose layout still fits.
  let k = 1
  for (ringsGeo = ringsGeometry(counts, angles, k); C / ringsGeo.extent < k - 0.005; ringsGeo = ringsGeometry(counts, angles, k)) k = C / ringsGeo.extent
  ringsK = k
  const colourTags = loadColourTags()
  const wrap = el('div', { class: 'rings-wrap' + (s.people.length > RINGS_LABEL_CAP || desk?.compact ? ' compact' : ''), 'data-view': 'rings', title: desk ? '' : S.hintText[HintId.WebTap] })
  let dragged = false
  if (!desk) {
    wrap.addEventListener('click', (e) => { if (!dragged) onRingsTap(e as MouseEvent, wrap) })
    ringsMenuOn(wrap, (v) => { dragged = v })
  }
  if (!desk && touchUi() && !hintHidden(HintId.WebTap)) {
    wrap.appendChild(el('button', {
      class: 'hint-i rings-hint', 'aria-label': S.hintOpen(S.hintLabel[HintId.WebTap]),
      onclick: (e: Event) => { e.stopPropagation(); openHint(HintId.WebTap) },
    }, ['i']))
  }
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 352 352')
  svg.innerHTML = '<defs><linearGradient id="th" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4FD7A0"/><stop offset="1" stop-color="#12A8E3"/></linearGradient></defs>'
  for (const r of ringsGeo.rings) {
    const c = document.createElementNS(NS, 'circle')
    c.setAttribute('cx', String(C)); c.setAttribute('cy', String(C)); c.setAttribute('r', String(ringsGeo.radius[r] * k)); c.setAttribute('data-ring', r)
    c.setAttribute('fill', 'none'); c.setAttribute('stroke', ringColor({ ring: r })); c.setAttribute('stroke-opacity', r === Ring.Unsorted ? '.35' : '.55')
    c.setAttribute('stroke-width', r === Ring.Close ? '2.2' : r === Ring.Intending ? '1' : '1.4')
    if (guideDimmed(hidden.has(r), false)) c.style.opacity = HIDDEN_GUIDE_OPACITY
    c.setAttribute('stroke-dasharray', r === Ring.Intending ? '1 6' : r === Ring.Acquaintance ? '2 5' : r === Ring.Friend ? '6 4' : '')
    svg.appendChild(c)
  }
  if (ringsGeo.rings.includes(Ring.Unsorted)) {
    const t = document.createElementNS(NS, 'text')
    t.setAttribute('x', String(C + 12)); t.setAttribute('y', String(C - ringsGeo.radius[Ring.Unsorted] * k + 3)); t.setAttribute('text-anchor', 'start')
    t.setAttribute('font-size', '8'); t.setAttribute('fill', ringColor({ ring: Ring.Unsorted })); t.setAttribute('data-ring-label', Ring.Unsorted)
    t.textContent = S.ringLabel[Ring.Unsorted]
    svg.appendChild(t)
  }
  wrap.appendChild(svg)
  for (const ring of ringsGeo.rings) {
    const dot = ringsGeo.dot[ring]
    const laps = new Map((members[ring] ?? []).map((p, i) => [p, ringsGeo.lapOf[ring]![i]]))
    visiblePeople(members[ring] ?? [], hidden).forEach((p) => {
      const lap = laps.get(p)!
      const a = ((angleOf(p) - 90) * Math.PI) / 180
      const radius = lapRadius(ringsGeo, ring, lap) * k
      const x = C + radius * Math.cos(a)
      const y = C + radius * Math.sin(a)
      // A crowded web (compact) draws a spoke only for people connected here: hundreds of dashed spokes read as dozens of rings.
      if (p.peerId || s.people.length <= RINGS_LABEL_CAP) {
        const path = document.createElementNS(NS, 'path')
        const mx = (C + x) / 2 + (y - C) * 0.12
        const my = (C + y) / 2 + (C - x) * 0.12
        path.setAttribute('d', `M${C} ${C} Q${mx} ${my} ${x} ${y}`)
        path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'url(#th)')
        path.setAttribute('stroke-width', ring === Ring.Close ? '2.6' : ring === Ring.Friend ? '1.8' : ring === Ring.Acquaintance ? '1.2' : '0.8')
        path.setAttribute('opacity', p.peerId ? '0.85' : '0.35')
        if (!p.peerId) path.setAttribute('stroke-dasharray', '3 4')
        svg.appendChild(path)
      }
      const mark = (p.peerId ? marks.get(p.peerId) : undefined) ?? (p.doorPeerId ? marks.get(p.doorPeerId) : undefined)
      const arcs = arcsGradient(tagColours(p, colourTags))
      const face = avatar(p.name, p.id)
      face.style.background = ring === Ring.Unsorted ? ringColor({ ring }) : p.reachedOut && ring === Ring.Intending ? ringColor(p) : PERSON_GREEN
      if (p.reachedOut && ring === Ring.Intending) face.style.color = REACH_OUT_INK
      pictured(face, p.theirProfile?.picture)
      const b = el('button', {
        class: 'node' + (mark ? ' ' + mark : '') + (arcs ? ' tagged' : '') + (isNonResponsive(p) ? ' nonresp' : ''), 'data-pid': p.id,
        onclick: () => { if (!dragged) (desk ? desk.onPick(p.id) : personSheet(p.id)) },
      }, [
        face,
        el('span', { title: displayName(p.name).title, 'aria-label': displayName(p.name).text }, [displayName(p.name).text]),
        isDemoPerson(s, p.id) ? dummyChip() : null,
        st().showRingNames ? el('em', { class: 'lvl' }, [S.ringLabel[p.ring]]) : null,
      ])
      if (!desk) contextPress(b, () => curatorPerson(p.id))
      b.style.left = x + 'px'
      b.style.top = y + 'px'
      if (arcs) b.style.setProperty('--arcs', arcs)
      b.style.setProperty('--d', dot * k + 'px')
      if (dot * k < 11) b.classList.add('nl')
      wrap.appendChild(b)
    })
  }
  const you = el('button', { class: 'node you', 'aria-label': S.meNameAria(s.me.displayName), tabindex: desk ? '-1' : false, onclick: () => { if (!desk) editNameSheet(true) } }, [pictured(avatar(s.me.displayName, s.me.id), ownPictureUrl), el('span', {}, [s.me.displayName])])
  you.style.left = C + 'px'
  you.style.top = C + 'px'
  wrap.appendChild(you)
  dragOnRings(wrap, s, (v) => { dragged = v }, desk?.onRing)
  // Re-render IN PLACE: the Desk slots this very element (slot name, styles, its fit() transform) and the phone's zoom layer wraps it,
  // so a replaceWith() made the rings vanish from the Desk (Jakob 20:05). `live` = the element the pressed button sits in.
  const toggle = (next: ReadonlySet<Ring>, live: HTMLElement): void => {
    try { window.localStorage.setItem(RINGS_HIDDEN_KEY, serializeHidden(next)) } catch { /* not remembered */ }
    const fresh = ringsView(s, marks, desk)
    live.className = fresh.className
    live.replaceChildren(...fresh.childNodes)
  }
  const column = togglePoints(ringsGeo.rings.map((r) => ringsGeo.radius[r]), C, k)
  ringsGeo.rings.forEach((r, i) => {
    const at = column[i]
    wrap.appendChild(ringToggle(r, hidden.has(r), at.top, at.left, (btn) => toggle(toggleHidden(hidden, r), btn.parentElement ?? wrap)))
  })
  return wrap
}

const HIDDEN_GUIDE_OPACITY = '.25'

function loadHiddenRings(): ReadonlySet<Ring> {
  try { return parseHidden(window.localStorage.getItem(RINGS_HIDDEN_KEY)) } catch { return new Set() }
}

/** The small round button on a ring's guide circle at 12 o'clock: ⊖ while the ring's people show, ⊕ while they are hidden. */
function ringToggle(ring: Ring, off: boolean, top: number, left: number, onToggle: (btn: HTMLElement) => void): HTMLElement {
  const b = el('button', {
    class: 'ring-toggle' + (off ? ' off' : ''), 'data-hide-ring': ring, 'aria-pressed': String(off), style: `--rc:${ringColor({ ring })}; left:${left}px; top:${top}px`,
    'aria-label': (off ? S.ringShowAria : S.ringHideAria)(S.ringLabel[ring]), title: S.ringLabel[ring],
    // The zoom/pan layer captures every pointer on the rings (setPointerCapture), which retargets the click away from this button.
    onpointerdown: (e: Event) => { e.stopPropagation() },
    onclick: (e: Event) => { e.stopPropagation(); onToggle(e.currentTarget as HTMLElement) },
  }, [off ? '+' : '−'])
  return b
}

/** Zoom and pan of the Web screen's content; survives render() and resets when the Web screen is left. View state only (I1). */
let ringsZoom: RingsZoom = RINGS_ZOOM_HOME

/** A pointer position in the rings' own layout px, whatever the zoom layer and the query-dock scale do to the box. */
function localPoint(e: { clientX: number; clientY: number }, wrap: HTMLElement): { x: number; y: number } {
  const box = wrap.getBoundingClientRect()
  const k = box.width / RINGS_SIZE
  return { x: (e.clientX - box.left) / k, y: (e.clientY - box.top) / k }
}

/**
 * Pinch (trackpad ctrl + wheel, Safari gestures, two fingers), pan (one pointer past 6 px at k > 1) and double tap home over the whole
 * Web screen body, and only there: outside the phone, the header and the tab bar the browser zooms as ever. Only the inner layer moves.
 */
function zoomOnWeb(clip: HTMLElement, layer: HTMLElement): void {
  // [data-own-zoom] (the Network view) pans and zooms itself in its draw loop, so it stays crisp: this layer leaves it alone.
  const skip = '.node, .ctx-menu, .desire, .hint-i, button, a, input, textarea, [data-own-zoom]'
  const apply = (z: RingsZoom): void => {
    ringsZoom = z
    layer.style.transform = transformOf(z)
    clip.classList.toggle('zoomed', z.k !== 1)
    layer.querySelector<HTMLElement>('.rings-wrap')?.setAttribute('data-rings-zoom', String(z.k))
  }
  apply(ringsZoom)
  const view = (): ZoomView => ({ w: layer.offsetWidth, h: layer.offsetHeight, cw: clip.clientWidth, ch: clip.clientHeight })
  const zoom = (factor: number, e: { clientX: number; clientY: number }): void => {
    if (ringsZoom.k === 1) clip.scrollTop = 0
    const box = layer.getBoundingClientRect()
    apply(zoomAt(ringsZoom, factor, e.clientX - box.left + ringsZoom.x, e.clientY - box.top + ringsZoom.y, view()))
  }
  clip.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || (e.target as HTMLElement).closest('[data-own-zoom]')) return
    e.preventDefault()
    zoom(Math.exp(-e.deltaY * 0.01), e)
  }, { passive: false })
  let last = 1
  type Gesture = Event & { scale: number; clientX: number; clientY: number }
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    clip.addEventListener(ev, (e) => {
      if ((e.target as HTMLElement).closest('[data-own-zoom]')) return
      e.preventDefault()
      const g = e as Gesture
      if (ev === 'gesturestart') last = 1
      else if (ev === 'gesturechange') { zoom(g.scale / last, g); last = g.scale }
    })
  }
  // A pan ends in a click on the same spot; the rings must not read it as a tap.
  let panned = false
  clip.addEventListener('click', (e) => { if (panned) e.stopPropagation() }, true)
  const down = new Map<number, { x: number; y: number }>()
  const spread = (): number => { const [a, b] = [...down.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }
  let start: { x: number; y: number } | undefined
  let panning = false
  clip.addEventListener('pointerdown', (e) => {
    panned = false
    if ((e.target as HTMLElement).closest('[data-own-zoom]')) return
    down.set(e.pointerId, { x: e.clientX, y: e.clientY })
    start = down.size === 1 && !(e.target as HTMLElement).closest(skip) ? { x: e.clientX, y: e.clientY } : undefined
    if (down.size === 2) { start = undefined; clip.setPointerCapture(e.pointerId) }
  })
  clip.addEventListener('pointermove', (e) => {
    const was = down.get(e.pointerId)
    if (!was) return
    if (down.size === 2) {
      const before = spread()
      down.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const [a, b] = [...down.values()]
      if (before > 0) zoom(spread() / before, { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
      return
    }
    if (!start || ringsZoom.k === 1) return
    if (!panning) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 6) return
      panning = panned = true
      clip.setPointerCapture(e.pointerId)
    }
    apply(panBy(ringsZoom, e.clientX - was.x, e.clientY - was.y, view()))
    down.set(e.pointerId, { x: e.clientX, y: e.clientY })
  })
  const lift = (e: PointerEvent): void => {
    down.delete(e.pointerId)
    start = undefined
    if (panning && down.size === 0) { panning = false; setTimeout(() => { panned = false }, 0) }
  }
  clip.addEventListener('pointerup', lift)
  clip.addEventListener('pointercancel', lift)
  clip.addEventListener('dblclick', (e) => {
    if (ringsZoom.k === 1 || (e.target as HTMLElement).closest(skip)) return
    clearTimeout(addTimer)
    apply(RINGS_ZOOM_HOME)
  })
}

/**
 * Drag a person's circle to another ring (mouse: after 4 px; touch: after a 300 ms hold, so the page still scrolls). The drop is read
 * from the distance to the centre; "intending to connect" first asks how much (0..10, default 5). The ring is the same value the outliner
 * and the CRM use (changeRing / placeOnRing).
 */
function dragOnRings(wrap: HTMLElement, s: AppState, setDragged: (v: boolean) => void, settled?: (personId: string, ring: Ring) => void): void {
  let lifted = false
  wrap.addEventListener('touchmove', (e) => { if (lifted) e.preventDefault() }, { passive: false })
  wrap.addEventListener('pointerdown', (down) => {
    const node = (down.target as HTMLElement).closest<HTMLElement>('.node:not(.you)')
    const p = s.people.find((x) => x.id === node?.dataset.pid)
    if (!node || !p) return
    let ring = webSlot(p)
    let out = false
    let angle = angleOf(p)
    // While a person is held, every ring guide shows in full so the drop target is visible.
    const hiddenNow = loadHiddenRings()
    const guides = (dragging: boolean): void => wrap.querySelectorAll<SVGCircleElement>('circle[data-ring]').forEach((c) => { c.style.opacity = guideDimmed(hiddenNow.has(c.getAttribute('data-ring') as Ring), dragging) ? HIDDEN_GUIDE_OPACITY : '' })
    guides(true)
    const place = (e: PointerEvent): void => {
      const { x, y } = localPoint(e, wrap)
      node.style.left = x + 'px'
      node.style.top = y + 'px'
      const dist = Math.hypot(x - RINGS_SIZE / 2, y - RINGS_SIZE / 2) / ringsK
      angle = angleFromCentre(x - RINGS_SIZE / 2, y - RINGS_SIZE / 2)
      out = beyondRings(dist, ringsGeo)
      ring = ringAt(dist, ringsGeo.radius, ringsGeo.rings)
      wrap.classList.toggle('hide-zone', out)
      wrap.querySelectorAll('circle').forEach((c) => c.classList.toggle('drop', !out && c.getAttribute('data-ring') === ring))
    }
    const lift = (): void => { lifted = true; node.classList.add('lifted'); setDragged(true) }
    const timer = down.pointerType === 'mouse' ? 0 : window.setTimeout(lift, 300)
    // A second finger is a pinch: the lift ends without moving the dot.
    const second = (e: PointerEvent): void => { if (!e.isPrimary) cancel() }
    wrap.addEventListener('pointerdown', second)
    const move = (e: PointerEvent): void => {
      if (!lifted) {
        if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < (timer ? 8 : 4)) return
        if (timer) { end(); return }
        lift()
      }
      place(e)
    }
    const end = (): void => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      wrap.removeEventListener('pointerdown', second)
      guides(false)
      wrap.querySelectorAll('circle.drop').forEach((c) => c.classList.remove('drop'))
      wrap.classList.remove('hide-zone')
    }
    // The Desk's lent rings redraw from the Desk (settled), the phone's from render() inside each path.
    const done = (): void => settled?.(p.id, p.ring)
    const cancel = (): void => { const was = lifted; end(); lifted = false; setDragged(false); if (was) { render(); done() } }
    const up = (): void => {
      const was = lifted
      end(); lifted = false
      setTimeout(() => setDragged(false), 0)
      if (!was) return
      if (out) { void hideOnRings(p).then(done); return }
      if (ring === Ring.Unsorted && p.ring === Ring.Family) { render(); done(); return }
      // The dot keeps the angle it was dropped at.
      if (ring === webSlot(p)) { p.angle = angle; save(); render(); done(); return }
      if (ring === Ring.Unsorted) { p.angle = angle; unplaceOnRings(p); done(); return }
      if (ring === Ring.Intending) askDesire(wrap, p, intendingReminder(displayName(p.name).text, knownWays(p), lastMessagedAt(s.chats?.[p.peerId ?? ''])), () => { render(); done() }, (v) => { p.angle = angle; dropOn(p, ring, v); done() })
      else { p.angle = angle; dropOn(p, ring); done() }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  })
}

/** Right click, or a 500 ms hold that moved under 6 px, on empty web space or a ring line: a small menu to space the dots out equally. */
function ringsMenuOn(wrap: HTMLElement, setHeld: (v: boolean) => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let from = { x: 0, y: 0 }
  const open = (e: MouseEvent): void => {
    const at = localPoint(e, wrap)
    const { x, y } = at
    const dist = Math.hypot(x - RINGS_SIZE / 2, y - RINGS_SIZE / 2)
    const near = ringAt(dist / ringsK, ringsGeo.radius, ringsGeo.rings)
    const onLine = Math.abs(ringsGeo.radius[near] * ringsK - dist) <= RING_LINE_HIT
    const item = (label: string, ring?: Ring): HTMLElement => el('button', { class: 'btn btn-ghost btn-sm', 'data-space-out': ring ?? 'all', onclick: () => spaceOutWeb(ring) }, [label])
    wrap.querySelector('.ctx-menu')?.remove()
    const menu = el('div', { class: 'ctx-menu', role: 'menu' }, [onLine ? item(S.ringsSpaceRing(S.ringLabel[near].toLowerCase()), near) : null, item(S.ringsSpaceAll)])
    menu.style.left = Math.min(at.x, RINGS_SIZE - 170) + 'px'
    menu.style.top = Math.min(at.y, RINGS_SIZE - 70) + 'px'
    wrap.appendChild(menu)
    document.addEventListener('pointerdown', (d) => { if (!menu.contains(d.target as Node)) menu.remove() }, { once: true })
  }
  const stop = (): void => { clearTimeout(timer); timer = undefined }
  wrap.addEventListener('pointerdown', (e) => {
    setHeld(false)
    if (!e.isPrimary) { stop(); return }
    if ((e.target as HTMLElement).closest('.node, .ctx-menu, .desire, .hint-i') || e.pointerType === 'mouse') return
    from = { x: e.clientX, y: e.clientY }
    timer = setTimeout(() => { timer = undefined; setHeld(true); navigator.vibrate?.(15); open(e) }, 500)
  })
  wrap.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 6) stop() })
  for (const ev of ['pointerup', 'pointercancel']) wrap.addEventListener(ev, stop)
  wrap.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (!(e.target as HTMLElement).closest('.node')) open(e)
  })
}

/** How close (view px) a press must be to a ring's line to count as on it. */
const RING_LINE_HIT = 10

/** Spaces the dots out equally (one ring, or all); Undo for 30 s restores every angle. */
function spaceOutWeb(ring?: Ring): void {
  const s = st()
  const before = spaceOut(s, ring)
  save()
  render()
  showNotice(S.ringsSpaced, '', [
    el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-space': '', onclick: () => { hideNotice(); restoreAngles(st(), before); save(); render() } }, [S.ringsHiddenUndo]),
  ], 30000)
}

/** A person dragged beyond the outermost ring: hidden like "hide in trustweb" (Curator Settings lists them, with unhide); Undo for 30 s. */
function hideOnRings(p: Person): Promise<void> {
  const name = displayName(p.name).text
  return curator.hide(p.id).then(() => {
    showNotice(S.ringsHidden(name), S.ringsHiddenBody, [
      el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-hide': p.id, onclick: () => { hideNotice(); void curator.unhide(p.id) } }, [S.ringsHiddenUndo]),
    ], 30000)
  })
}

/** A Web view ring change goes on to Tana through the Curator's sync; the real record only (no solo, demo persona or test account). */
function ringToTana(p: Person, ring: Ring): void {
  if (demoPhone()) return
  curator.ring(p.id, ring).catch((e: unknown) => console.warn('ring to Tana', e))
}

/** A placed person dragged out to the unsorted ring: back to "not placed yet"; Undo for 30 s restores the ring (and its intending value). */
function unplaceOnRings(p: Person): void {
  const name = displayName(p.name).text
  const { ring, intending } = p
  changeRing(p, Ring.Unsorted)
  ringToTana(p, Ring.Unsorted)
  placeOnRing(p, Ring.Unsorted, Date.now())
  save()
  render()
  showNotice(S.ringsUnplaced(name), S.ringsUnplacedBody, [
    el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-unplace': p.id, onclick: () => { hideNotice(); changeRing(p, ring); ringToTana(p, ring); p.intending = intending; if (!intending) delete p.intending; save(); render() } }, [S.ringsHiddenUndo]),
  ], 30000)
}

function dropOn(p: Person, ring: Ring, desire?: number): void {
  const { ring: was, intending, ringSuggested } = p
  if (p.ring === Ring.Family) save()
  else { changeRing(p, ring); ringToTana(p, ring) }
  placeOnRing(p, ring, Date.now(), desire)
  delete p.ringSuggested
  save()
  render()
  if (!ringSuggested) { toast(`${displayName(p.name).text}: ${S.ringLabel[ring].toLowerCase()}`); return }
  // A grey (suggested) dot dropped on a ring confirms it; Undo for 30 s puts the suggestion back.
  showNotice(S.ringsConfirmed(displayName(p.name).text, S.ringLabel[ring].toLowerCase()), '', [
    el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-confirm': p.id, onclick: () => {
      hideNotice(); changeRing(p, was); ringToTana(p, was); p.intending = intending; if (!intending) delete p.intending; p.ringSuggested = true; save(); render()
    } }, [S.ringsHiddenUndo]),
  ], 30000)
}

/** The 0 to 10 chip row for "intending to connect" (default 5); nothing changes until "Move here". */
function askDesire(wrap: HTMLElement, p: Person, reminder: string[], cancel: () => void, done: (value: number) => void): void {
  let value = DESIRE_DEFAULT
  const row = el('div', { class: 'desire', role: 'group', 'aria-label': S.desireAsk(displayName(p.name).text) })
  // A chip is replaced by draw() and Move here by render() while the click is still bubbling: the web's "add someone" tap must not see it.
  row.addEventListener('click', (e) => e.stopPropagation())
  const draw = (): void => row.replaceChildren(
    el('p', {}, [S.desireAsk(displayName(p.name).text)]),
    ...reminder.map((line) => el('p', { class: 'reminder', 'data-intending-reminder': '' }, [line])),
    el('div', { class: 'rchips' }, Array.from({ length: 11 }, (_, n) => el('button', {
      class: 'rchip' + (n === value ? ' on' : ''), style: `--rc:${ringColor({ ring: Ring.Intending })}`, 'aria-pressed': String(n === value),
      onclick: () => { value = n; draw() },
    }, [String(n)]))),
    el('div', { class: 'desire-go' }, [
      el('button', { class: 'btn btn-sm', onclick: () => done(value) }, [S.desireMove]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: cancel }, [S.desireCancel]),
    ]),
  )
  draw()
  wrap.appendChild(row)
}

/** The system's yes for notifications: iOS's sheet in the iPhone app (native_push.ts), the browser's elsewhere; true where there is no such thing. */
async function notificationPermission(): Promise<boolean> {
  if (nativeApp) return nativePushPermission()
  if (typeof Notification === 'undefined' || Notification.permission === 'granted') return true
  return (await Notification.requestPermission().catch(() => 'denied' as NotificationPermission)) === 'granted'
}

function notificationsCard(s: AppState): HTMLElement {
  const toggle = async (): Promise<void> => {
    if (!s.notificationsOn && !(await notificationPermission())) { toast(S.notifBlocked); return }
    s.notificationsOn = !s.notificationsOn
    save()
    await refreshPush()
    settingsSheet()
  }
  // Wave 11: one switch per kind; off here is off in the page and in the service worker alike.
  const kinds = kindsOf(s)
  const kindRow = (kind: NotifyKind): HTMLElement => {
    const box = el('input', { type: 'checkbox', 'data-notify-kind': kind }) as HTMLInputElement
    box.checked = kinds[kind]
    box.addEventListener('change', () => { s.notifyKinds = { ...kinds, [kind]: box.checked }; save(); kinds[kind] = box.checked })
    return el('label', { class: 'notif-kind' }, [box, el('span', {}, [S.notifKind[kind]])])
  }
  // Wave 12: in the iPhone app the notification extension applies these switches (native_push.ts); Apple carries fixed words either way.
  const hint = !s.notificationsOn ? null
    : nativeApp ? (pushState === 'kept' ? S.notifPushOnIos : pushState === 'rejected' || pushState === 'unavailable' ? S.notifPushNoRelayIos : pushState === 'failed' || pushState === 'denied' ? S.notifPushFailed : null)
    : !pushSupported() || pushState === 'unsupported' ? S.notifPushUnsupported
    : pushState === 'relay-no-push' || pushState === 'unavailable' ? S.notifPushNoRelay
    : pushState === 'kept' ? S.notifPushOn
    : pushState === 'failed' || pushState === 'denied' || pushState === 'no-worker' ? S.notifPushFailed
    : null
  return el('div', { class: 'verse notif' }, [
    el('h3', {}, [s.notificationsOn ? S.notifOnTitle : S.notifTitle]),
    el('p', {}, [S.notifBody]),
    s.notificationsOn ? el('div', { class: 'notif-kinds' }, NOTIFY_KINDS.map(kindRow)) : null,
    hint ? el('p', { class: 'meta', 'data-push-state': pushState ?? '' }, [hint]) : null,
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

/** The top-right glyph: the Web Curator (apps/crm, a lazy chunk) in a sheet, its own tabs inside; × closes back to the Web view. */
function curatorSheet(): void {
  openSheet([curator.el])
  sheet.dataset.kind = 'curator'
  curator.open()
}

/** The Events screen: the list, or one event's page (from a chip on a person). */
function openEvents(eventId?: string): void {
  eventsView.open(eventId)
  go(Screen.Events)
}

const WEB_VIEW_KEY = 'trustweb.ui.webView'

function webViewToggle(network: boolean, anyone: boolean): HTMLElement {
  const pick = (value: 'rings' | 'network'): void => {
    try { window.localStorage.setItem(WEB_VIEW_KEY, value) } catch { /* not remembered */ }
    render()
  }
  return el('div', { class: 'web-view-row' }, [
    anyone ? el('div', { class: 'seg web-view', role: 'group', 'aria-label': S.netViewAria }, [
      el('button', { class: network ? '' : 'on', 'aria-pressed': String(!network), onclick: () => pick('rings') }, [S.netRings]),
      el('button', { class: network ? 'on' : '', 'aria-pressed': String(network), onclick: () => pick('network') }, [S.netNetwork]),
    ]) : el('span', { class: 'web-view' }),
    el('div', { class: 'seg desk-side', role: 'group', 'aria-label': S.deskSideAria }, [
      el('button', { 'data-desk-side': '', onclick: () => openDeskSheet() }, [S.deskSide]),
    ]),
  ])
}

function screenWeb(): Node[] {
  const s = shown(st(), curatorHiddenIds())
  const search = iconButton('list', S.searchOpen, curatorSheet, 'search-btn curator-btn' + (Date.now() < curatorPulseUntil ? ' pulse' : ''))
  let stored: string | null = null
  try { stored = window.localStorage.getItem(WEB_VIEW_KEY) } catch { /* storage blocked: Rings */ }
  const network = s.people.length > 0 && networkChosen(stored)
  const right = document.createDocumentFragment()
  right.append(...(featureOn(st(), 'events') ? [iconButton('calendar', S.eventsOpen, () => openEvents(), 'events-btn')] : []), search)
  // The zoom layer holds everything the screen body shows; the clip (.scroll) and the phone frame stay put.
  const layer = el('div', { class: 'rings-zoom' }, [
    // Wave 6i: the cards sit here, in the flow, above the rings (card_stack.ts); not while the dock needs the room.
    queryOpen ? null : cardStackEl,
    s.people.length === 0 ? el('p', { class: 'empty' }, [S.webEmpty]) : null,
    network
      ? createNetworkView({ me: s.me, people: s.people, openPerson: (id) => personSheet(id), openMe: () => editNameSheet() })
      : ringsView(s, askMarks()),
    wantsToConnectSection(),
    reachOutLegendShown(st()) && !hintHidden(HintId.ReachOut) ? el('button', { class: 'hint-i legend-i', 'data-legend-reach-out': '', 'aria-label': S.hintOpen(S.hintLabel[HintId.ReachOut]), onclick: () => openHint(HintId.ReachOut) }, ['i']) : null,
    isEphemeral() ? el('p', { class: 'warn' }, [S.storageEphemeral]) : null,
  ])
  const clip = el('div', { class: 'scroll' }, [layer])
  zoomOnWeb(clip, layer)
  return [
    // Jakob 2026-10-19: the gear as on My Resources (was ⋮ moreMenu, now unused; curating moved into Settings > Your web).
    header(S.webTitle, { right, after: iconButton('settings', S.invSettings, settingsSheet) }),
    webViewToggle(network, s.people.length > 0),
    clip,
    queryOpen ? queryDock(s) : queryFab(),
  ]
}

/** Under the web, only while someone waits: who reached out through my link, each with Add and Dismiss. */
function wantsToConnectSection(): HTMLElement | null {
  const list = st().wantsToConnect ?? []
  if (!list.length) return null
  const now = Date.now()
  return el('section', { class: 'wants', 'data-wants-to-connect': '' }, [
    el('h3', {}, [S.wantsTitle]),
    ...list.map((w) => el('div', { class: 'wants-row', 'data-want': w.peerId }, [
      el('span', {}, [el('b', {}, [w.name]), ' ', el('small', { class: 'meta' }, [ageLabel(w.at, now)])]),
      el('button', { class: 'btn btn-sm', 'data-want-add': '', onclick: () => addWantSheet(w.peerId, w.name) }, [S.wantsAdd]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-want-dismiss': '', onclick: () => dismissWanted(w.peerId) }, [S.wantsDismiss]),
    ])),
  ])
}

/** "Add": the connect-add sheet with their name and the ring radios; Add makes the Person, connected, on the ring picked. */
function addWantSheet(peerId: string, name: string): void {
  openSheet(renderConnectAdd({
    name,
    ring: Ring.Acquaintance,
    onAdd: (typed, ring) => {
      closeSheet()
      const s = st()
      const person = acceptWant(s, peerId, typed, ring, randomId(8))
      if (!person) return
      const peer = s.peers.find((x) => x.id === peerId)
      if (peer) { peer.ring = ring; applyHeldContact(peer, person) }
      save()
      autoShareToPerson(person)
      addedToast(person, ring)
      render()
    },
    onLater: closeSheet,
  }).nodes)
}

/** "Dismiss": into the Curator's Archive (not connected, the row kept on it for Restore); the archived toast + pulse as for "Not now". */
function dismissWanted(peerId: string): void {
  const p = dismissWant(st(), peerId, randomId(8))
  if (!p) return
  save()
  render()
  void curator.hide(p.id).then(archivedNotice, (e: unknown) => console.warn('archive reach-out', e))
}

/**
 * Tap on empty space in the web: "Add someone to your web?". The ring is
 * preselected by how far from you the tap landed. Works while the rings are
 * scaled for the query dock, because it measures the rendered box.
 */
function onRingsTap(e: MouseEvent, wrap: HTMLElement): void {
  if ((e.target as HTMLElement).closest('.node, .ctx-menu')) return
  ripple(e)
  const at = localPoint(e, wrap)
  const dx = at.x - RINGS_SIZE / 2
  const dy = at.y - RINGS_SIZE / 2
  const dist = Math.hypot(dx, dy)
  const ring = RINGS.reduce((best, r) => (Math.abs(ringsGeo.radius[r] * ringsK - dist) < Math.abs(ringsGeo.radius[best] * ringsK - dist) ? r : best), Ring.Acquaintance)
  // Let the ripple show before the sheet rises over it.
  clearTimeout(addTimer)
  addTimer = setTimeout(() => addPersonSheet(ring), RIPPLE_LEAD_MS)
}

let addTimer: ReturnType<typeof setTimeout> | undefined

/** How long the ripple plays on its own before the add-someone sheet opens. */
const RIPPLE_LEAD_MS = 360

function addPersonSheet(ring: Ring): void {
  let picked = ring
  let busy = false
  const name = el('input', { class: 'field', placeholder: S.addNamePh, maxlength: '40', 'aria-label': S.addNamePh })
  const where = el('input', { class: 'field', placeholder: S.recWherePh, maxlength: '80', 'aria-label': S.addWhere })
  // Wave 6b: their code, @name, DID or pasted link; nothing is looked up until "Add to my web" is pressed.
  const code = el('input', { class: 'field', placeholder: S.addCodePh, maxlength: '2048', 'aria-label': S.addCodeLabel, 'data-add-code': '', id: 'add-code', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' })
  const codeStatus = el('p', { class: 'meta', role: 'status', 'data-add-code-status': '' })
  const radios = el('div', { class: 'add-rings' })
  const drawRadios = (): void => {
    radios.replaceChildren(...RINGS.map((r) => el('button', {
      class: 'radio' + (picked === r ? ' on' : ''),
      onclick: () => { picked = r; drawRadios() },
    }, [el('b', {}, [S.ringLabel[r]]), el('small', {}, [S.ringHint[r]])])))
  }
  drawRadios()
  let after: (() => void) | null = null // set once a person was added and a note still shows: the button then only closes
  const addByCode = async (): Promise<void> => {
    busy = true
    addBtn.setAttribute('disabled', '')
    codeStatus.textContent = S.addCodeBusy
    const out = await connectByCode(code.value, picked, name.value.trim().slice(0, 40), where.value.trim().slice(0, 80))
    busy = false
    addBtn.removeAttribute('disabled')
    if ('type' in out) {
      codeStatus.textContent = S.addCodeFailed(out)
      if (out.type === 'stamp') codeStatus.setAttribute('data-connect-refused', out.reason) // the preview panel's marker
      return
    }
    toast(out.existed ? S.addCodeAlready(out.person.name) : S.savedToast(out.person.name, S.ringLabel[picked]))
    render()
    // The username had another holder lately: the sheet stays for one dismissible line (notices.ts), "Done" opens the card.
    const noteId = out.previous === undefined ? null : namePreviousId(out.previous)
    if (noteId === null || !noticeShown(st(), noteId)) { closeSheet(); personSheet(out.person.id); return }
    const note = el('p', { class: 'meta', role: 'status', 'data-name-previous': '' }, [
      S.namePreviousHolder,
      el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': S.noticeDismiss, 'data-notice-dismiss': '', onclick: () => { dismissNotice(st(), noteId); save(); note.remove() } }, ['×']),
    ])
    codeStatus.replaceWith(note)
    addBtn.textContent = S.addDone
    after = () => { closeSheet(); personSheet(out.person.id) }
  }
  const add = (): void => {
    if (busy) return
    if (after) { after(); return }
    if (code.value.trim()) { void addByCode(); return }
    const n = name.value.trim()
    if (!n) { name.focus(); return }
    const s = st()
    s.people.push({ id: randomId(8), name: n.slice(0, 40), context: where.value.trim().slice(0, 80), ring: picked, metAt: Date.now(), lines: [] })
    save()
    closeSheet()
    toast(S.savedToast(n, S.ringLabel[picked]))
    render()
  }
  const addBtn = el('button', { class: 'btn btn-electric', 'data-add-person': '', onclick: add }, [S.addSave])
  name.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') add() })
  code.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') add() })
  openSheet([
    el('h3', {}, [S.addTitle]),
    el('p', { class: 'meta' }, [S.addLead]),
    name,
    where,
    el('label', { class: 'meta', for: 'add-code' }, [S.addCodeLabel]),
    code,
    codeStatus,
    el('p', { class: 'meta' }, [S.addCodeHint]),
    radios,
    addBtn,
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
window.addEventListener(COLOUR_TAGS_EVENT, () => { if (screen === Screen.Web) render() })

/** Opens the query on Web from anywhere: querying is the one thing (Jakob, wave 2, P6/P9), one tap away from Web and Inventory. */
function openQuery(): void {
  queryOpen = true
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
  // Wave 6h, S2: the (i) next to "Who can ask" explains both choices in place, with Jakob's example (hops_view.ts cascadeInfoContent).
  const explain = el('div', { class: 'info-hint', hidden: true, 'data-item-info-text': '1' }, cascadeInfoContent().slice(1))
  const info = cascadeInfoButton(() => { explain.hidden = !explain.hidden })
  info.setAttribute('data-item-info', '1')
  info.removeAttribute('data-cascade-info')
  return [
    el('div', { class: 'eyebrow-row' }, [el('h4', { class: 'eyebrow' }, [S.itemAudienceTitle]), info]),
    explain,
    ...AUDIENCES.map((a) => el('button', {
      class: 'radio' + (item.audience === a ? ' on' : ''), 'aria-pressed': String(item.audience === a), 'data-item-audience': a,
      onclick: () => { item.audience = a; save(); render(); itemSheet(item.id) },
    }, [el('b', {}, [S.audienceLabel[a]]), el('small', {}, [S.audienceHint[a]])])),
    el('h4', { class: 'eyebrow' }, [S.itemTagsTitle]),
    ...itemTagChips(item),
  ]
}

/** Multi-select of the colour tags next to the rings: each chip toggles one tag id in the item's `tagAudience`. */
function itemTagChips(item: InventoryItem): HTMLElement[] {
  const tags = loadColourTags()
  if (!tags.length) return [el('p', { class: 'meta' }, [S.itemTagsNone])]
  return [el('div', { class: 'rchips' }, tags.map((t) => {
    const on = item.tagAudience?.includes(t.id) ?? false
    return el('button', {
      class: 'rchip' + (on ? ' on' : ''), style: `--rc:${t.colour}`, 'aria-pressed': String(on), 'data-item-tag': t.id,
      onclick: () => {
        const rest = (item.tagAudience ?? []).filter((x) => x !== t.id)
        const next = on ? rest : [...rest, t.id]
        if (next.length) item.tagAudience = next; else delete item.tagAudience
        save(); itemSheet(item.id)
      },
    }, [t.label ?? t.id])
  }))]
}

/** The person whose card is the open sheet, or null (a contact that arrives late redraws it, see applyContact). */
let cardOpenFor: string | null = null

function personSheet(personId: string): void {
  const p = st().people.find((x) => x.id === personId)
  if (!p) return
  // The person's page is the Web Curator's own; this strip holds only what the Curator lacks: chat, messenger links, pass-on and ask-again (it already says connected or not).
  const cons = chatOnConsensual(p, st().preferConsensual)
  openSheet([
    el('h2', { class: 'card-name', 'data-card-name': p.id, style: `color:${ringColor(p)}` }, [displayName(p.name).text]),
    cons ? el('a', { class: 'btn btn-electric', href: cons.link, target: '_blank', rel: 'noopener noreferrer', 'data-message-on': cons.channel }, [S.consChat]) : null,
    cons ? el('p', { class: 'meta' }, [S.consHonesty]) : null,
    p.peerId ? el('button', { class: 'btn ' + (cons ? 'btn-ghost' : 'btn-electric'), 'data-chat-open': p.id, onclick: () => chatSheet(p.id) }, [S.chatOpen]) : null,
    solo ? null : el('button', { class: 'btn btn-ghost btn-sm', 'data-same-person': p.id, onclick: () => devices.samePersonPicker(p.id) }, [S.dvSameAs]),
    reachedOutRow(p),
    noMessengerRow(p),
    sharedReachRow(p),
    askLinksRow(p),
    passOnRowFor(p),
    askAgainRow(p),
    leanRow(p),
    eventChipsRow(p),
    knowsRow(p, st().people, save, () => personSheet(p.id)),
    timelineSection(p),
    theirProfileBlock(p.name, p.theirProfile, Date.now()),
    p.peerId ? sendProfileRow(p) : null,
    curator.person(p.id, closeSheet, { embedded: true }),
    agreementsFor(p),
    blockRow(p),
    archiveRow(p),
  ])
  cardOpenFor = p.id
}

/** Wave 15: Block / Unblock on the card. Blocked: asks unanswered, chat unseen, nothing sent, dot hidden; unblock stores 0 so it wins a sync. */
function blockRow(p: Person): HTMLElement {
  const on = isBlocked(p)
  return el('button', {
    class: 'btn btn-ghost btn-sm', 'data-block-person': p.id,
    onclick: () => {
      if (!on && !confirm(S.blockConfirm(p.name))) return
      p.blocked = on ? 0 : Date.now()
      save(); render()
      if (sheet.dataset.kind === 'settings') settingsSheet(); else closeSheet()
      if (!on) toast(S.blockedToast(p.name))
    },
  }, [on ? S.unblockPerson(p.name) : S.blockPerson(p.name)])
}

/** Archive (the default) or, quieter, Delete for good after an in-place "Delete for good?" (Jakob 2026-10-19). */
function archiveRow(p: Person): HTMLElement {
  const row = el('div', { class: 'archive-row' })
  const draw = (): void => row.replaceChildren(
    el('button', { class: 'btn btn-ghost', 'data-archive-person': p.id, onclick: () => { closeSheet(); void hideOnRings(p).then(archivedNotice) } }, [S.personArchive]),
    el('button', { class: 'btn btn-ghost btn-sm quiet', 'data-delete-person': p.id, onclick: ask }, [S.personDelete]),
  )
  const ask = (): void => row.replaceChildren(
    el('span', { class: 'meta' }, [S.personDeleteAsk]),
    el('button', { class: 'btn btn-ghost btn-sm', 'data-delete-yes': p.id, onclick: () => deletePerson(p.id) }, [S.personDeleteYes]),
    el('button', { class: 'btn btn-ghost btn-sm', 'data-delete-no': '', onclick: draw }, [S.personDeleteNo]),
  )
  draw()
  return row
}

function deletePerson(personId: string): void {
  const s = st()
  s.people = s.people.filter((x) => x.id !== personId)
  save()
  closeSheet()
  render()
}

/** Wave 8: how this connection began, when it began as a reach-out through a public link. */
function reachedOutRow(p: Person): HTMLElement | null {
  if (!p.reachedOut) return null
  return el('p', { class: 'reached-out', 'data-reached-out': p.reachedOut }, [p.reachedOut === 'received' ? S.reachedOutToYou(displayName(p.name).text) : S.youReachedOut])
}

/** The per-person Web Curator page alone in the sheet; closing it returns to the screen underneath. */
function curatorPerson(personId: string): void {
  openSheet([curator.person(personId, closeSheet)])
}

/** An acquaintance, confirmed or suggested: a link to the person's general note and a five-step "more friend ... more acquaintance" score. A note to myself; the ring never changes. */
function leanRow(p: Person): HTMLElement | null {
  if (p.ring !== Ring.Acquaintance) return null
  const box = el('div', { class: 'lean', 'data-lean': p.id })
  const chips = (): HTMLElement => el('div', { class: 'rchips' }, [
    el('small', {}, [S.leanFriend]),
    ...LEANS.map((n) => el('button', {
      class: 'rchip' + (n === (p.lean ?? 0) ? ' on' : ''), style: `--rc:${ringColor({ ring: Ring.Acquaintance })}`, 'data-lean-step': String(n),
      'aria-label': S.leanAria(n), 'aria-pressed': String(n === (p.lean ?? 0)),
      onclick: () => { if (n) p.lean = n; else delete p.lean; save(); draw() },
    }, [String(n)])),
    el('small', {}, [S.leanAcquaintance]),
  ])
  const note = (): HTMLElement => {
    const area = el('textarea', { class: 'field', rows: '4', maxlength: String(GENERAL_NOTE_MAX), placeholder: S.generalNotePh(p.name), 'aria-label': S.generalNoteTitle, 'data-lean-note': '' })
    area.value = generalNoteOf(p)
    const saver = createAutosaver({ commit: (text) => { if (setGeneralNote(p, text)) save() } })
    area.addEventListener('input', () => saver.input(area.value))
    area.addEventListener('blur', () => saver.flush())
    return area
  }
  const draw = (): void => box.replaceChildren(
    el('button', { class: 'btn btn-ghost btn-sm', 'data-lean-add-note': '', onclick: (e: Event) => { (e.currentTarget as HTMLElement).replaceWith(note()); box.querySelector('textarea')?.focus() } }, [S.leanAddNote]),
    chips(),
  )
  draw()
  return box
}

/** The events this person is tagged with (E1): a chip each, tap opens the event page. */
function eventChipsRow(p: Person): HTMLElement | null {
  const evs = featureOn(st(), 'events') ? (st().events ?? []).filter((e) => p.events?.includes(e.id)) : []
  if (!evs.length) return null
  return el('div', { class: 'chips', 'data-person-events': p.id }, [
    el('span', { class: 'chips-lbl' }, [S.eventsPersonChips]),
    ...evs.map((e) => el('button', { class: 'chip', 'data-event-chip': e.id, title: eventLabel(e), onclick: () => { closeSheet(); openEvents(e.id) } }, [tagLabel(e)])),
  ])
}

/** The Timeline of a person (timeline.ts, timeline_view.ts): typed and imported entries live on the person; TrustWeb's own are derived. */
function timelineSection(p: Person): HTMLElement {
  // The record may have been replaced since the card opened: write into the person as the record holds it now.
  const now = (): Person => st().people.find((x) => x.id === p.id) ?? p
  return createTimelineSection({
    entries: () => timelineOf(st(), now()),
    add: (entries) => { const n = addEntries(now(), entries); if (n) save(); return n },
    importText: (text) => {
      const r = parseTimelineImport(text)
      if (r.unreadable) return S.tlImportBad
      const n = addEntries(now(), r.entries)
      if (n) save()
      return S.tlImported(n, r.skipped, r.entries.length - n)
    },
  }, toast)
}

/** A connected person who has shared no messenger link (and none was typed): say so plainly; it fills in if their link arrives. */
function noMessengerRow(p: Person): HTMLElement | null {
  if (!p.peerId || primaryReachable(p)) return null
  return el('p', { class: 'meta', 'data-no-messenger': p.id }, [S.cardNoMessenger(p.name)])
}

/** "Pass their asks on" with the value this phone acts on (one_jakob.ts passOnAllowed), for a connected person only. */
function passOnRowFor(p: Person): HTMLElement | null {
  const peer = p.peerId ? st().peers.find((x) => x.id === p.peerId) : undefined
  if (!peer) return null
  return passOnRow(passOnAllowed(st(), peer, ownDoorDid()), (next) => { p.passOn = next; save(); personSheet(p.id) })
}

function sharedReachRow(p: Person): HTMLElement | null {
  // The primary Consensual button of the card already is that link.
  const onCard = chatOnConsensual(p, st().preferConsensual)
  const shared = sharedReachables(p).filter((r) => r.channel !== onCard?.channel)
  if (!shared.length) return null
  return el('div', { class: 'ch-row shared' }, [
    ...shared.map((r) => el('a', {
      class: 'btn btn-ghost', href: r.link, target: '_blank', rel: 'noopener noreferrer', 'data-message-on': r.channel,
    }, [S.chatMessageOn(reachLabel(r))])),
    el('p', { class: 'meta' }, [S.chSharedBy(p.name)]),
  ])
}

/** The channels I hold nothing for yet from a connected person (typed or shared). */
const missingLinks = (p: Person): Channel[] => REQUESTABLE.filter((ch) => !reachableChannels(p).some((r) => r.channel === ch))

/** Wave 9: "Ask for their links" on a connected card; shows when I asked, and allows asking again after 24 h. */
function askLinksRow(p: Person): HTMLElement | null {
  const peer = p.peerId ? st().peers.find((x) => x.id === p.peerId) : undefined
  const wants = missingLinks(p)
  if (!peer || !wants.length || isDemoPersona(persona) || demoAccounts().some((t) => t.peerId === peer.id)) return null
  const wait = !mayAskAgain(p.contactAsked, Date.now())
  const when = (at: number): string => new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return el('div', { class: 'ch-row', 'data-ask-links': p.id }, [
    el('button', {
      class: 'btn btn-ghost', disabled: wait,
      onclick: () => {
        net.sendText(peer, requestText(APP_URL, wants)).then(() => { p.contactAsked = Date.now(); save(); personSheet(p.id) }, () => toast(S.chatOffline))
      },
    }, [S.chReqAsk]),
    p.contactAsked ? el('p', { class: 'meta' }, [S.chReqAsked(when(p.contactAsked))]) : null,
  ])
}

/** The channels the contact box does not hold (Delta Chat, Telegram, Messenger): Settings keeps them, never shared by a scan. */
const CHANNELS_OTHER: readonly Channel[] = CHANNELS.filter((ch) => !BOX_CHANNELS.includes(ch))

/** Where a set of messenger handles lives: a person's card, or my own contact info. */
interface ChannelOwner {
  get(): Partial<Record<Channel, string>>
  set(ch: Channel, value: string | null): void
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
  }
}

/**
 * Contact info, collapsed (owner 2026-10-05): the messengers already known
 * show as "Open in ..." links; "Add other ways to contact them" expands the
 * full list, in the owner's order. Kept on this phone.
 */
function channelsView(owner: ChannelOwner, labels: { title: string; add: string; hint: string }, channels: readonly Channel[] = CHANNELS): HTMLElement {
  const box = el('div', { class: 'channels' })
  let expanded = false
  const draw = (edit?: Channel): void => {
    const known = owner.get()
    const shown = expanded || edit ? channels : channels.filter((ch) => known[ch])
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

/** The label of a channel: "Signal" everywhere (wave 6e removed the Signal/Molly pick; only the camera-app note names both apps). */
const chName = (ch: Channel): string => S.chLabel[ch]
const reachLabel = (r: Reachable): string => chName(r.channel)

const NO_CHATS: ChatBook = {}

const chatStrings = (): ChatStrings => ({
  title: S.chatTitle, messageOn: (r) => S.chatMessageOn(reachLabel(r)), notConnected: S.chatNotConnected, empty: S.chatEmpty,
  offline: S.chatOffline, placeholder: S.chatPlaceholder, send: S.chatSend, sendAgain: S.chatSendAgain, pending: S.chatPending,
  sent: S.chatSent, charsLeft: S.chatCharsLeft, you: S.chatYou,
  re: S.chatRe, replyingTo: S.chatReplyingTo, replyingToDrop: S.chatReplyingToDrop,
})

const shareStrings = (): ShareStrings => ({ tickLabel: S.shareTick, tickPhoneNote: S.shareTickPhone, tickHint: S.shareTickHint })

/** The "share when we connect" tick (and the phone-number warning) under one of my saved links; `after` runs once a tick was changed and saved. */
function tickControlsFor(ch: Channel, after: () => void): HTMLElement {
  return renderShareControls({
    doc: document, channel: ch, getHandle: () => st().myChannels?.[ch],
    getSettings: () => st().contactShare,
    setSettings: (next) => { st().contactShare = next; save(); after() },
    S: shareStrings(),
  })
}

/**
 * The contact box (contact_box_view.ts): Signal, WhatsApp and Matrix, each with its own tick. The Meet page and Settings both draw it
 * from here. `changed` runs after a link was saved or removed, `ticked` after a tick was changed (the Meet page redraws its sentence).
 */
function buildContactBox(hooks: { changed?: (ch: Channel) => void; ticked?: () => void }): ContactBox {
  let box: ContactBox | null = null
  const ticks = (ch: Channel): HTMLElement => tickControlsFor(ch, () => { hooks.ticked?.(); box?.refreshTicks() })
  box = createContactBox({
    mine: () => st().myChannels ?? {},
    save: (ch, value) => myChannels().set(ch, value),
    remove: (ch) => {
      myChannels().set(ch, null)
      // A remembered mode about a link that is gone falls back to the default.
      const stored = st().shareMode
      if (isShareMode(stored) && channelOf(stored) === ch) { delete st().shareMode; save() }
    },
    normalize: normalizeHandle,
    ticks,
    changed: hooks.changed,
    extra: profileRow,
  })
  return box
}

/** Wave 19: my profile picture, kept in image_store.ts (this phone only); `ownPictureUrl` is its blob: URL for the rings' you-node and the Desk's button. */
let ownPictureUrl: string | undefined
async function refreshOwnPicture(): Promise<void> {
  const id = state?.profile?.pictureId
  const blob = id ? await images.get(id) : null
  const old = ownPictureUrl
  ownPictureUrl = blob ? URL.createObjectURL(blob) : undefined
  if (old) URL.revokeObjectURL(old)
  window.dispatchEvent(new Event('tw:picture-changed'))
  if (old || ownPictureUrl) render()
}

async function setOwnPicture(file: File): Promise<void> {
  const p = st().profile ?? { norms: [] }
  const id = `profile-picture-${Date.now()}`
  await images.put(id, await shrink(file))
  if (p.pictureId) void images.remove(p.pictureId)
  p.pictureId = id
  p.pictureAt = Date.now()
  st().profile = p
  save()
  await refreshOwnPicture()
}

async function removeOwnPicture(): Promise<void> {
  const p = st().profile
  if (!p?.pictureId) return
  void images.remove(p.pictureId)
  delete p.pictureId
  delete p.pictureAt
  save()
  await refreshOwnPicture()
}

/** The small copy of my picture that may travel (SHARE_SIDE, JPEG data URL), or undefined: none set, or it would not fit the wire cap. */
async function sharePicture(): Promise<string | undefined> {
  const id = st().profile?.pictureId
  const blob = id ? await images.get(id) : null
  if (!blob) return undefined
  const small = await shrink(blob, SHARE_SIDE).catch(() => null)
  if (!small) return undefined
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = (): void => resolve(String(r.result))
    r.onerror = (): void => reject(r.error)
    r.readAsDataURL(small)
  }).catch(() => '')
  return isJpegDataUrl(url) ? url : undefined
}

/** Wave 7: the profile editor (profile.ts); `redraw` draws it again after a saved change. One editor for the phone's sheet and the Desk (wave 19). */
function profileNodes(redraw: () => void): Node[] {
  const mine = (): MyProfile => st().profile ?? { norms: [] }
  const withProfile = (f: (p: MyProfile) => void): void => { const p = mine(); f(p); st().profile = p }
  return profileSheetNodes({
    profile: mine, inventory: () => st().inventory, now: Date.now,
    commit: () => { save(); redraw() },
    addNorm: (norm, text) => withProfile((p) => addNorm(p, norm, text, Date.now())),
    removeNorm: (i) => withProfile((p) => removeNorm(p, i)),
    setOne: (key, text) => withProfile((p) => setOne(p, key, text, Date.now())),
    setAudience: (section, a) => withProfile((p) => { p.audience = { ...p.audience, [section]: a } }),
    picture: {
      face: () => pictured(avatar(st().me.displayName, st().me.id), ownPictureUrl),
      has: () => Boolean(mine().pictureId),
      choose: (file) => { void setOwnPicture(file).then(redraw, () => toast(S.agrSendFailed)) },
      remove: () => { void removeOwnPicture().then(redraw) },
    },    openInventory: () => { closeSheet(); go(Screen.Inventory) },
  })
}

/** Wave 7: the "My profile" sheet, opened from the contact box. */
function profileSheet(): void {
  openSheet(profileNodes(profileSheet))
  sheet.dataset.kind = 'profile'
}

/** Wave 19: the same editor as an element the Desk's profile page shows (lent to the Curator). */
function profileEditor(): HTMLElement {
  const box = el('div', { class: 'prof-editor', 'data-profile-editor': '1' })
  const draw = (): void => box.replaceChildren(...profileNodes(draw))
  draw()
  return box
}

/** Under the contact box: "My profile" (norms, favourite way, intro). It leaves this phone only on the owner's tap "Send my profile" on a card. */
function profileRow(): HTMLElement {
  return el('div', { class: 'cb-row', 'data-profile-row': '1' }, [
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-open-profile': '1', onclick: profileSheet }, [S.profMine]),
  ])
}

/** Chat I/O for chat_view.ts: the book lives in state.chats; setBook skips a save when nothing changed (markRead returns the same object). */
function chatIo(): ChatIo {
  return {
    getBook: () => st().chats ?? NO_CHATS,
    setBook: (b) => { const s = st(); if (b !== NO_CHATS && b !== s.chats) { s.chats = b; save() } },
    send: async (peerId, text, sentAt, re) => {
      const peer = st().peers.find((p) => p.id === peerId)
      if (!peer) throw new Error('not connected')
      await net.sendText(peer, text, sentAt, re)
    },
    now: Date.now,
  }
}

// Messenger links leave this phone ONLY as the answer to an explicit request (onContactRequest), never at connect time
// (Jakob 2026-10-15 22:25: a reach-out via trustweb.one/<name> must not be able to get them).

/** The demo persona, a solo tab and demo accounts never send anything to a phone (hello, profile). */
const noSendTo = (peer: Peer): boolean => isDemoPersona(persona) || solo || demoAccounts().some((t) => t.peerId === peer.id)

/** Wave 7 (profile.ts): sends my profile to one connected peer in a chat text. Only the owner's own "Send my profile" tap calls this, never connect. Wave 19: only the sections their ring may see. */
function sendProfileTo(peer: Peer): void {
  if (noSendTo(peer)) return
  void sendProfile(peer)
}

async function sendProfile(peer: Peer): Promise<void> {
  const person = st().people.find((x) => x.peerId === peer.id)
  const pic = await sharePicture()
  const text = person ? buildProfileText(APP_URL, st().profile, person, pic) : null
  if (!text) { toast(buildProfileText(APP_URL, st().profile, undefined, pic) ? S.profNothingFor(peer.displayName) : S.profEmpty); return }
  net.sendText(peer, text, Date.now(), undefined, sliceFor(st().profile, zoneOf(person!), pic)?.picture).then(() => toast(S.profSent(peer.displayName))).catch(() => toast(S.agrSendFailed))
}

/**
 * Wave 20 (Jakob 2026-10-23, supersedes the 2026-10-15 tap-only rule for the zone slice): sends the slice of `zone` once when a connection
 * lands (`public`: only the sections set to Public) and again when the person is placed on a closer ring (changeRing, the add sheets).
 * Never when switched off in Settings, never to demo phones, never on moving outward. Silent: no toast on this side.
 */
async function autoShareProfile(peer: Peer, zone: Zone | null): Promise<void> {
  const s = st()
  const rank = zone && !s.profileAutoOff && !noSendTo(peer) ? autoSendRank(s.autoSentRank?.[peer.id], zone) : null
  if (rank === null || !zone) return
  const pic = await sharePicture()
  const slice = sliceFor(s.profile, zone, pic)
  const text = slice ? buildProfileText(APP_URL, s.profile, zone, pic) : null
  if (!text) return
  await net.sendText(peer, text, Date.now(), undefined, slice!.picture).then(() => { s.autoSentRank = { ...s.autoSentRank, [peer.id]: rank }; save() }, () => undefined)
}

const autoShareToPerson = (p: Person): void => { const peer = st().peers.find((x) => x.id === p.peerId); if (peer) void autoShareProfile(peer, zoneOf(p)) }

/** Tells a newly connected phone my name (hello.ts): a code link or a bare DID reaches it with no name in it. Never to demo accounts or demo phones. */
function sendHelloTo(peer: Peer): void {
  if (noSendTo(peer)) return
  const text = helloText(APP_URL, st().me.displayName)
  if (text) net.sendText(peer, text).catch(() => { /* the other phone keeps the typed name, or none */ })
}

/** Net: a connected phone told its name. It fills in only a name this phone does not have yet, and it reaches an open add sheet. */
function onHelloText(peer: Peer, text: string): void {
  const name = parseHelloText(APP_URL, text)
  if (!name) return
  const s = st()
  const held = s.peers.find((x) => x.id === peer.id)
  const person = s.people.find((x) => x.peerId === peer.id)
  if (held && wantsHelloName(held.displayName)) held.displayName = name
  if (person && wantsHelloName(person.name)) person.name = cleanHelloName(name)
  save()
  if (connectAdd?.peerId === peer.id) connectAdd.handle.setTheirName(name)
  render()
}

let openChat: { peerId: string; refresh(): void } | null = null

/**
 * The chat with one person. Wave 6i: `open.re`, the ask it was opened from (shown above the composer, carried by the next message,
 * chat_re.ts); `open.scrollTo`, the message a "new message" card was about.
 */
function chatSheet(personId: string, open: StackOpen = {}): void {
  const p = st().people.find((x) => x.id === personId)
  if (!p) return
  hideMsgNotice()
  const handle = renderChat({
    ...chatIo(), doc: document, person: { name: p.name, peerId: p.peerId, reach: primaryReachable(p) }, S: chatStrings(),
    isOnline: () => relayStatus === 'connected', context: open.re ?? null, scrollTo: open.scrollTo,
  })
  openSheet([handle.el])
  if (p.peerId) openChat = { peerId: p.peerId, refresh: handle.refresh }
  drawCardStack()
}

/** Wave 6i: the chat with the person an ask is about, carrying that ask; nothing when they have no card here. */
function messageAbout(peerId: string, qid: string, text: string, at: number): void {
  const person = personOf(st().people, peerId)
  if (person) chatSheet(person.id, { re: makeRe(qid, text, at) })
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
  // Their card is open (the scan just landed on it): show the Message button now, unless the person is typing in it.
  const typing = sheet.contains(document.activeElement) && (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)
  // A link with via=<CHANNEL>: once the add sheet is done, their card opens as soon as their links arrive.
  const viaOpen = viaCard.contact(person.id, connectAdd !== null)
  if (viaOpen || (cardOpenFor === person.id && sheet.classList.contains('on') && !typing)) personSheet(person.id)
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

/** Sends the given channels (each saved, valid, and either ticked or just agreed to) to one paired peer; nothing is remembered as ticked. */
function sendLinksTo(peer: Peer, channels: Channel[]): void {
  const s = st()
  let settings: ShareSettings | undefined = s.contactShare
  for (const ch of channels) settings = withTick(settings, ch, true)
  const built = buildContactPayload(APP_URL, Object.fromEntries(channels.map((ch) => [ch, s.myChannels?.[ch]])), settings)
  if (built) net.sendText(peer, contactText(APP_URL, built.payload)).catch(() => { /* the person asks again */ })
}

/** Wave 9: a paired person asks for my links. Ticked ones go at once, saved-unticked ones are asked one by one, the rest is silence. */
function onContactRequest(peer: Peer, text: string): void {
  const s = st()
  const wanted = parseRequestText(APP_URL, text)
  const person = s.people.find((p) => p.peerId === peer.id)
  if (!wanted || !person || noSendTo(peer)) return
  // Someone who came in through the public link stays on Intending until I move them: until then a request is dropped, not answered.
  if (!mayAnswerRequest(peer, person)) return
  const plan = answerPlan(s.myChannels, s.contactShare, wanted)
  if (plan.auto.length) sendLinksTo(peer, plan.auto)
  const next = (rest: Channel[]): void => {
    const [ch, ...more] = rest
    if (!ch) { hideNotice(); return }
    showNotice(S.chReqNotice(person.name, chName(ch)), '', [
      el('button', { class: 'btn btn-ghost btn-sm', 'data-req-share': ch, onclick: () => { sendLinksTo(peer, [ch]); next(more) } }, [S.chReqShare]),
      el('button', { class: 'notice-dismiss', 'data-req-not-now': ch, onclick: () => next(more) }, [S.chReqNotNow]),
    ])
  }
  next(plan.ask)
}

function sendProfileRow(p: Person): HTMLElement | null {
  const peer = st().peers.find((x) => x.id === p.peerId)
  return peer ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-send-profile': p.id, onclick: () => sendProfileTo(peer) }, [S.profSendTo(p.name)]) : null
}

/** The Agreements section of a card (agreements.ts). A proposal or an accept goes as one chat-envelope text to the connected phone; nothing else leaves. */
function agreementsFor(p: Person): HTMLElement {
  // The record may have been replaced since the card opened: look the person and the connection up on every call.
  const now = (): Person => st().people.find((x) => x.id === p.id) ?? p
  const peerNow = (): Peer | undefined => { const pid = now().peerId; return pid ? st().peers.find((x) => x.id === pid) : undefined }
  const find = (id: string) => now().agreements?.find((a) => a.id === id)
  const redraw = (): void => { save(); personSheet(p.id) }
  const send = (text: string | null, onFail: () => void): void => {
    const peer = peerNow()
    if (!peer || !text) { onFail(); if (!text) toast(S.agrTooLong); return }
    net.sendText(peer, text).catch(() => { onFail(); toast(S.agrSendFailed) })
  }
  return agreementsSection({
    name: p.name, agreements: () => now().agreements ?? [], now: Date.now, canPropose: !!peerNow(),
    consensualLink: consensualReachable(now()) ? CONSENSUAL_AGREEMENTS_LINK : undefined,
    add: (text, expiresAt, propose) => {
      const wantsSend = propose && !!peerNow()
      const a = addAgreement(now(), randomId(8), text, Date.now(), { proposed: wantsSend, expiresAt, appUrl: APP_URL })
      if (!a) toast(wantsSend ? S.agrTooLong : S.agrRefused)
      else if (a.status === AgreementStatus.Proposed) send(proposalText(APP_URL, a), () => { /* stays "waiting"; Send again */ })
      redraw()
    },
    remove: (id) => { removeAgreement(now(), id); redraw() },
    accept: (id) => {
      if (!acceptAgreement(now(), id)) return
      send(acceptText(APP_URL, id), () => { const a = find(id); if (a) { a.status = AgreementStatus.Incoming; redraw() } })
      redraw()
    },
    resend: (id) => { const a = find(id); if (a) send(proposalText(APP_URL, a), () => { /* the toast says so */ }) },
  })
}

/** Net: a connected phone proposed an agreement, or said yes to mine. */
function onAgreementText(peer: Peer, text: string): void {
  const person = st().people.find((p) => p.peerId === peer.id)
  const msg = parseAgreementText(APP_URL, text)
  if (!person || !msg || !mayAnswerRequest(peer, person) || !receiveAgreement(person, msg, Date.now())) return
  save()
  toast(msg.kind === 'accept' ? S.agrAccepted(peer.displayName) : S.agrProposedToast(peer.displayName))
  if (cardOpenFor === person.id && sheet.classList.contains('on') && !sheet.contains(document.activeElement)) personSheet(person.id)
  render()
}

/** Net: a connected phone shared its profile; it lands on their card (profile.ts). Nothing is held for a card that does not exist yet. */
function onProfileText(peer: Peer, text: string, pic?: string): void {
  const person = st().people.find((p) => p.peerId === peer.id)
  if (!person || !receiveProfileText(APP_URL, person, text, Date.now(), pic)) return
  save()
  toast(S.profReceivedToast(peer.displayName))
  render()
}

function onChatText(peer: Peer, text: string, ts: number, re?: ChatRe): void {
  const s = st()
  const now = Date.now()
  // Wave 6i (chat_re.ts): the ask it answers, bound to this phone's own ask when the qid names one it sent to that connection.
  const r = receiveText(s.chats ?? NO_CHATS, peer.id, text, ts, now, bindRe(re, s.sentAsks, peer.id, now))
  if (!r.message) return
  s.chats = r.book
  save()
  if (isBlocked(personOf(s.people, peer.id))) return
  if (openChat?.peerId === peer.id) { openChat.refresh(); return }
  notify('chat', S.chatNotifBody(peer.displayName))
  newMessageNotice(peer, r.message.key)
}

/**
 * Wave 6i: "New message from <name>", tappable, with an underlined "open" on its right. On the Web screen it is a card in the stack
 * above the rings (it stays until read); anywhere else (or under an open sheet or dock) a notice of its own for a few seconds. Both open
 * the chat at that message.
 */
function newMessageNotice(peer: Peer, key: string): void {
  const person = personOf(st().people, peer.id)
  const sheetOpen = sheet.classList.contains('on')
  drawCardStack()
  if (screen === Screen.Web && !queryOpen && !sheetOpen) return
  const title = S.chatNewToast(person?.name ?? peer.displayName)
  // Review 6i (card_stack.ts msgNoticePlace): never over a control: not over the consent prompt, at the top over an open sheet.
  const place = msgNoticePlace(overlay.classList.contains('on'), sheetOpen)
  if (place === NoticePlace.None) { toast(title); return }
  showMsgNotice(title, person ? () => chatSheet(person.id, { scrollTo: key }) : null, place)
}

function showMsgNotice(title: string, open: (() => void) | null, place: NoticePlace): void {
  const openIt = (): void => { hideMsgNotice(); open?.() }
  msgNoticeEl.replaceChildren(
    el('span', { class: 'msg-notice-text' }, [title]),
    ...(open ? [el('button', { class: 'stack-open', type: 'button', 'data-card-open': 'message', 'aria-label': S.cardOpenAria(title), onclick: openIt }, [S.cardOpen])] : []),
  )
  msgNoticeEl.onclick = (e) => { if (!(e.target as HTMLElement).closest('button')) openIt() }
  msgNoticeEl.classList.toggle('tappable', open !== null)
  msgNoticeEl.classList.toggle('top', place === NoticePlace.Top)
  msgNoticeEl.classList.add('on')
  clearTimeout(msgNoticeTimer)
  msgNoticeTimer = setTimeout(hideMsgNotice, MSG_NOTICE_MS)
}

function hideMsgNotice(): void {
  clearTimeout(msgNoticeTimer)
  msgNoticeEl.classList.remove('on')
}

/** Net onText: share link / contact payload / chat message; malformed protocol text is shown nowhere. */
function onIncomingText(peer: Peer, text: string, ts: number, re?: ChatRe, pic?: string): void {
  const kind = routeText(APP_URL, text)
  // Wave 15: a blocked person's chat texts are stored (onChatText) but nothing else of theirs is acted on.
  if (kind !== TextKind.Chat && isBlocked(personOf(st().people, peer.id))) return
  switch (kind) {
    case TextKind.Share: onSharedText(peer, text); return
    case TextKind.Contact: onContactText(peer, text); return
    case TextKind.ContactRequest: onContactRequest(peer, text); return
    case TextKind.Keep: onKeepText(peer, text); return
    case TextKind.Hello: onHelloText(peer, text); return
    case TextKind.Profile: onProfileText(peer, text, pic); return
    case TextKind.Agreement: onAgreementText(peer, text); return
    case TextKind.Chat: onChatText(peer, text, ts, re); return
    case TextKind.Ignore: return
  }
}

function channelRow(owner: ChannelOwner, ch: Channel, edit: boolean, redraw: (edit?: Channel) => void): HTMLElement {
  const value = owner.get()[ch]
  const label = el('span', { class: 'ch-name ch-' + ch }, [chName(ch)])
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
    el('a', { class: 'ch-open', href: channelLink(ch, value), target: '_blank', rel: 'noopener noreferrer' }, [S.chOpen(chName(ch))]),
    el('button', { class: 'mini', 'aria-label': S.chEdit(S.chLabel[ch]), onclick: () => redraw(ch) }, [S.chEditShort]),
  ])
}

/**
 * Wave 6i (reask.ts): the ONE place a person's ring changes after they were placed (their card, a note about them). A TIGHTER ring
 * sends their phone one sealed ask-again, so their earlier asks come back as prompts; the same ring or a looser one sends nothing at
 * all ("unfriending should be invisible"). The first pick on the add sheet after a scan is a placement, not a tightening.
 */
function changeRing(p: Person, ring: Ring): void {
  const peer = st().peers.find((x) => x.id === p.peerId)
  const before = peer?.ring
  p.ring = ring
  if (peer) peer.ring = ring
  save()
  autoShareToPerson(p)
  if (peer && before !== undefined && ringRaised(before, ring) && mayAskAgainWith(peer)) { void net.askAgain(peer); return }
  // A tightening that never left (offline) and is undone before it could: nothing goes at all.
  if (peer && peer.askAgainDue !== undefined && before !== undefined && ringRaised(ring, before)) { delete peer.askAgainDue; save() }
}

/**
 * Wave 6i: ask-again and re-asks are for real phones only: never the side-by-side demo, a demo persona, a demo account (either side),
 * this site's front door or anybody's front door (doors never ask on their own, and an older door would keep the envelope forever).
 */
function mayAskAgainWith(peer: Peer): boolean {
  const s = st()
  return !solo && !isDemoPersona(persona) && !s.testOf && !demoAccounts().some((t) => t.peerId === peer.id)
    && peer.did !== demoPeer?.did && !s.people.some((x) => x.doorPeerId === peer.id)
}

/** Wave 6i: under Advanced on a connected person's card: "Get <name>'s earlier asks again" (the same envelope as a tightening). */
function askAgainRow(p: Person): HTMLElement | null {
  const peer = p.peerId ? st().peers.find((x) => x.id === p.peerId) : undefined
  if (!peer || !mayAskAgainWith(peer)) return null
  return el('div', { class: 'ask-again-row', 'data-ask-again-row': '1' }, [
    el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', 'data-ask-again': p.id,
      onclick: () => { void net.askAgain(peer).then((sent) => toast(sent ? S.askAgainSent(p.name) : S.askAgainQueued(p.name))) },
    }, [S.askAgainButton(p.name)]),
    el('p', { class: 'meta' }, [S.askAgainHint]),
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
      draft.extraLines.push({ id: randomId(8), text, tag, audience: RECORD_LINE_AUDIENCE, ...(recorder.live ? { atMs: totalMs() + recorder.elapsed() } : {}) })
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
  // Lines travel as part of the whole person record: save() is all the Curator/vault/device sync need (as for the checkedAt edit in the review sheet).
  editLine: (personId, lineId, text) => { if (state && editLineText(state, personId, lineId, text)) save() },
  removeLine: (personId, lineId) => { if (state && removeLine(state, personId, lineId)) save() },
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
const snapshots = createSnapshotView({
  persona, storeCtx, state: () => state, sheet, openSheet, toast, when: whenLabel,
  replaceRecord: (s) => { state = s; save(); location.reload() },
})
const devices = createSyncView({
  persona, storeCtx, state: stateForSync, peek: () => state, save, sheet, openSheet, closeSheet, toast, when: whenLabel, changed: render, snapshots,
  askDid: () => state?.identity?.did,
  codeDeps: () => (connectEligible() && canRegister(SERVER_ORIGIN)
    ? { origin: SERVER_ORIGIN, fetch: (input, init) => fetch(input, init), now: () => Date.now(), state: st, save }
    : null),
  connectLink: async () => { await net.start(); return net.connectLink(CONNECT_URL) },
})

/** The record; on a device that has none yet (a new phone linking before it has a name) the empty one is made first, as a fresh personal phone makes it. */
function stateForSync(): AppState {
  if (!state) {
    createMe(S.dvDefaultName)
    screen = Screen.Web
    void net.start().then(announceLink)
  }
  return st()
}
const images = new ImageStore(persona, storeCtx)
const curator = createCurator({
  record: () => (state ? structuredClone(state) : null),
  setRing: (id, ring) => {
    const p = state?.people.find((x) => x.id === id)
    if (!p) return
    p.ring = ring
    delete p.ringSuggested
    save()
    autoShareToPerson(p)
    if (screen === Screen.Web) render()
  },
  setFamily: (id, on) => {
    const p = state?.people.find((x) => x.id === id)
    if (!p) return
    p.fields = { ...p.fields, [FAMILY_FIELD]: on as unknown as string }
    save()
    if (screen === Screen.Web) render()
  },
  setFlag: (id, key, on) => {
    const p = state?.people.find((x) => x.id === id)
    if (!p) return
    p.fields = { ...p.fields, [key]: on as unknown as string }
    save()
    if (screen === Screen.Web) render()
  },
  removePerson: (id) => {
    if (!state) return
    state.people = state.people.filter((x) => x.id !== id)
    save()
    if (screen === Screen.Web) render()
  },
  restorePerson: (person) => {
    if (!state) return
    if (person.pendingInvite) { reopenInvite(person.pendingInvite); return }
    if (person.wantsToConnect) { addWant(state, person.wantsToConnect); save(); if (screen === Screen.Web) render(); return }
    if (state.people.some((x) => x.id === person.id)) return
    state.people.push(person)
    save()
    if (screen === Screen.Web) render()
  },
  // Curator > Settings "Hide people known only from …" moves the web at once (Jakob 2026-10-16: "reflected in the visual").
  setHiddenSources: (kinds) => {
    if (!state) return
    setHiddenSources(state, kinds)
    save()
    if (screen === Screen.Web) render()
  },
  // A bullet written next to the person in the vault (notes bridge) lands as a line of theirs, provenance local.
  addLine: (id, line) => {
    const p = state?.people.find((x) => x.id === id)
    if (!p || p.lines.some((l) => l.id === line.id || l.text === line.text)) return
    p.lines.push(line)
    save()
    if (screen === Screen.Web) render()
  },
  showRings: () => { closeSheet(); if (screen !== Screen.Web) go(Screen.Web) },
  // The class stays through a close: the Desk is still mounted and does not announce itself again on the next open (the CSS needs .on and data-kind=curator).
  viewChanged: (view) => { curatorFace = view; applyDeskWide() },
  // The Desk's Web page: the same rings as the Web screen, from the same record (so the shared geometry singletons hold the same values).
  renderRings: (o) => ringsView(shown(st(), curatorHiddenIds()), askMarks(), o),
  // Wave 19: the Desk's profile button (top right) replaces the sheet's "× Home" on a wide tab.
  renderProfile: profileEditor,
  myPicture: () => ownPictureUrl,
  closeDesk: closeSheet,
  showPhoneVersion,
})
const eventsView = createEventsView({
  state: st, save, header, leave: () => go(Screen.Web), redraw: render, curatorPerson, avatar,
  undoNotice: (title, onUndo) => showNotice(title, '', [el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-event': '', onclick: () => { hideNotice(); onUndo() } }, [S.eventsUndo])], 30000),
  newId: () => randomId(8), copyLink, joinLink, origin: linkOrigin(location.origin),
  by: () => (st().me.displayName ? { name: st().me.displayName, ...(st().identity?.did ? { did: st().identity?.did } : {}) } : undefined),
})

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
        ...linesFromTranscript(draft.segments).filter((l) => !have.has(l.text)).map((l) => ({ id: randomId(8), text: l.text, tag: l.tag, audience: RECORD_LINE_AUDIENCE, atMs: l.atMs, line: l.line })),
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
function recordPastMeeting(opts: { personId?: string; reviewed?: boolean } = {}): void {
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
    // The audience is stored only from a Review save (the person saw each line's audience there): a meeting stored at End meeting, before
    // Review, carries none, so no extraction default ever answers an ask (notes_source.ts: no audience, no match).
    text: l.text.trim(), tag: l.tag, ...(opts.reviewed ? { audience: l.audience } : {}), ...(l.atMs === undefined ? {} : { atMs: l.atMs }), ...(l.line === undefined ? {} : { line: l.line }),
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
  notify('chat', S.recvTitle(peer.displayName))
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

/** A pasted event link (the whole URL or just its fragment): opens the join sheet. */
function joinLink(text: string): boolean {
  const ev = decodeEventLink(text.slice(Math.max(0, text.indexOf('#'))))
  if (!ev) return false
  pendingEvent = ev
  maybeOpenPendingEvent()
  return true
}

/** An event link opened: "You were at ..." with Add / Not me. The fragment is already gone from the address bar. */
const openedHits = new Set<string>()
function maybeOpenPendingEvent(): void {
  if (!pendingEvent || !state) return
  const ev = pendingEvent
  pendingEvent = null
  if (!featureOn(st(), 'events')) {
    // Events are switched off (Settings > Features): the invite is not dropped, the app asks once whether to turn them on.
    openSheet([
      el('h2', {}, [S.featureEventsPrompt]),
      el('button', {
        class: 'btn btn-electric wide', 'data-feature-events-on': '',
        onclick: () => { setFeature(st(), 'events', true); save(); renderTabs(); render(); pendingEvent = ev; maybeOpenPendingEvent() },
      }, [S.featureEventsOn]),
      el('button', { class: 'btn btn-ghost wide', 'data-feature-events-later': '', onclick: closeSheet }, [S.featureEventsLater]),
    ])
    return
  }
  if (st().events?.some((e) => e.id === ev.id)) { applyHostLink(st(), ev); save(); openEvents(ev.id); return }
  if (ev.srv && !openedHits.has(ev.srv)) { openedHits.add(ev.srv); sendHit(ev.srv, 'opened') }
  const addBox = el('input', { type: 'checkbox', checked: true, 'data-event-add-inviter': '' }) as HTMLInputElement
  const add = (): void => {
    const now = Date.now()
    const id = joinEvent(st(), ev, now)
    if (ev.by && addBox.checked) addInviter(st(), ev.by, id, S.eventInvitedContext(ev.name), randomId(8), now)
    save(); closeSheet(); openEvents(id)
  }
  openSheet([
    el('h2', {}, [S.eventLinkJoinTitle(ev.name, eventWhen(ev), ev.where)]),
    ev.by ? el('p', { class: 'meta', 'data-event-invited-by': '' }, [S.eventInvitedBy(ev.by.name)]) : null,
    ev.kind === 'host' ? el('p', { class: 'meta', 'data-event-hosted': '' }, [ev.hosts?.length ? `${S.eventLinkHostedBy(ev.hosts)}. ` : '', S.eventLinkHostNames]) : null,
    ev.srv ? el('p', { class: 'meta', 'data-org-counts-note': '' }, [S.evOrgCounts]) : null,
    ev.conditions ? el('p', {}, [ev.conditions]) : null,
    ev.themes ? el('div', { class: 'chips' }, ev.themes.map((t) => el('span', { class: 'chip' }, [t]))) : null,
    ev.by ? el('label', { class: 'meta' }, [addBox, ` ${S.eventAddInviter(ev.by.name)}`]) : null,
    el('button', { class: 'btn btn-electric wide', 'data-event-join': '', onclick: add }, [S.eventLinkAdd]),
    el('button', { class: 'btn btn-ghost wide', 'data-event-notme': '', onclick: closeSheet }, [S.eventLinkNotMe]),
  ])
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
      ...linesFromTranscript(draft.segments).map((l) => ({ id: randomId(8), text: l.text, tag: l.tag, audience: RECORD_LINE_AUDIENCE, atMs: l.atMs, line: l.line })),
      ...extractLines(draft.text).map((l) => ({ id: randomId(8), text: l.text, tag: l.tag, audience: RECORD_LINE_AUDIENCE })),
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

/**
 * The pages of Meet: the one code, then Demo account. Wave 6b: my Signal and Matrix codes are no longer pages to swipe to; the Signal link
 * rides in the one code (the sharing line) or becomes the code under Advanced > Only Signal/Molly, and both are edited in Settings.
 */
enum MeetPage {
  TrustWeb = 'trustweb',
  /** A test account for the person in front of you (owner 2026-10-06). */
  Demo = 'demo',
}

let meetPage: MeetPage = MeetPage.TrustWeb

/** The share mode in force (share_modes.ts): the remembered one while its link is still saved, else Only TrustWeb. */
function shareModeNow(): ShareMode {
  const s = st()
  return effectiveMode(s.shareMode, s.myChannels)
}

function setShareMode(mode: ShareMode): void {
  st().shareMode = mode
  save()
}

/** The Advanced panel stays open while Meet redraws; Meet opens with it closed. */
let meetAdvancedOpen = false

function meetPages(): MeetPage[] {
  // Demo phones (solo) and demo accounts do not hand out demo accounts of their own.
  const demo = solo || st().testOf ? [] : [MeetPage.Demo]
  return [MeetPage.TrustWeb, ...demo]
}

function openMeet(from: Screen, notes = ''): void {
  meetFrom = from
  meetNotes = notes
  meetShare = null
  meetPage = MeetPage.TrustWeb
  meetAdvancedOpen = false
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
  const body = meetPage === MeetPage.Demo ? meetDemoPage() : meetTrustWebPage()
  return [
    header(name ? S.meetTitleWith(name) : S.meetTitle, { back: () => go(meetFrom), qr: false }),
    el('div', { class: 'scroll pad' }, [pages.length > 1 ? tabs : null, body]),
  ]
}

/** One short-link maker per visit: it remembers each long link's short form, so a tap never asks the server twice for the same link. */
let shortLinker: ShortLinker | null = null

/** Copies a link and says so (the toast shows the link itself where the clipboard is refused). */
function copyLink(text: string, done: string = S.meetCopied): void {
  void navigator.clipboard?.writeText(text).then(() => toast(done), () => toast(text))
}

/** The short-link choice for a connect code: its QR follows the choice, as do Copy, Send and NFC (chooser.current()). Not offered in an embedded demo phone. */
function connectLinkChooser(qr: HTMLElement): LinkChooser {
  shortLinker ??= createShortLinker({ origin: SERVER_ORIGIN, fetch: (input, init) => fetch(input, init), now: () => Date.now() })
  return createLinkChooser({ origin: SERVER_ORIGIN, offer: !solo, linker: shortLinker, qr, renderQr, copy: copyLink })
}

/** One connect-code keeper per visit (connect_code.ts): the record lives in the app state, the requests only go out from the two app origins. */
let connectKeeper: ConnectKeeper | null = null

function codeKeeper(): ConnectKeeper {
  connectKeeper ??= createConnectKeeper({
    origin: SERVER_ORIGIN,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    load: () => state?.connectCode,
    store: (record) => { st().connectCode = record; save() },
  })
  return connectKeeper
}

/** One names client per visit (names_sync.ts): the names a code holds on the server, read when Meet opens, claimed and released from Advanced. */
let namesSyncer: NamesSync | null = null

function namesSync(): NamesSync {
  namesSyncer ??= createNamesSync({
    origin: SERVER_ORIGIN,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    load: () => state?.connectCode,
    store: (record) => { st().connectCode = record; save() },
    keeper: codeKeeper(),
    offer: connectEligible(),
  })
  return namesSyncer
}

/** Only this phone's own personal account asks for a code: not a demo phone, a demo account's tab, or an embedded frame. */
function connectEligible(): boolean {
  return !!state && !state.testOf && deviceSyncEligible()
}

/** A phone's own personal account (record or not yet): the one that may link its other devices. Not a demo phone, a demo account's tab or an embedded frame. */
function deviceSyncEligible(): boolean {
  return !solo && persona === 'me' && window.top === window
}

/** Registers or updates this phone's connect code when due (boot where a code exists, a new name, the Meet page); never throws, never blocks. */
async function ensureConnectCode(): Promise<void> {
  if (!connectEligible()) return
  try {
    await net.start()
    await codeKeeper().ensure(net.connectLink(CONNECT_URL))
    // Wave 15: the records another device owns are kept alive here (the keeper leaves them alone), once per 30 days each.
    if (state?.connectCode?.owner === 'other' || state?.otherCodes?.length || state?.pendingRenew?.length) await careForCodes({ origin: SERVER_ORIGIN, fetch: (input, init) => fetch(input, init), now: () => Date.now(), state: st, save, log: () => {} })
  } catch { /* the long link stays; the keeper tries again on the next ensure */ }
}

/** owner 2026-10-17: off for now. The button, nfc.ts and the strings stay. */
const NFC_WRITE_OFFERED = false

function meetTrustWebPage(): HTMLElement {
  const notes = meetNotes
  const qr = el('div', { class: 'qrwrap' })
  const view: ConnectView = createConnectView({ origin: SERVER_ORIGIN, offer: connectEligible(), keeper: codeKeeper(), qr, renderQr, copy: copyLink })
  const nfcStatus = el('p', { class: 'meta' })
  const cameraNote = el('p', { class: 'meta', 'data-camera-app': '', hidden: true }, [S.needsCameraApp])
  const copy = el('button', {
    class: 'btn btn-ghost', disabled: true,
    onclick: () => { if (view.current()) copyLink(view.current()) },
  }, [S.meetCopy])
  const inviteCount = el('p', { class: 'meta', 'data-invite-count': '', hidden: !st().invitesSent }, [S.inviteCount(st().invitesSent ?? 0)])
  const inviteBtn = el('button', {
    class: 'btn btn-ghost', 'data-invite-someone': '',
    onclick: () => {
      const inv = inviteText(namesSync().names().name ?? null, view.current())
      void sendInvite(inv, {
        share: typeof navigator.share === 'function' ? (d) => navigator.share({ title: d.title, text: d.text }) : undefined,
        copy: (t) => navigator.clipboard.writeText(t),
      }).then((ok) => {
        if (!ok) return
        st().invitesSent = (st().invitesSent ?? 0) + 1
        save()
        inviteCount.textContent = S.inviteCount(st().invitesSent ?? 0)
        inviteCount.hidden = false
        if (typeof navigator.share !== 'function') toast(S.meetCopied)
      })
    },
  }, [S.inviteButton])
  const nfc = NFC_WRITE_OFFERED && nfcWriteSupported()
    ? el('button', {
        class: 'btn btn-ghost', disabled: true,
        onclick: () => {
          if (!view.current()) return
          nfcStatus.textContent = S.meetNfcWaiting
          // The code link never changes, so a tag keeps working; before the server answered the long link goes on it.
          writeLinkToTag(view.current()).then(() => { nfcStatus.textContent = S.meetNfcDone }, () => { nfcStatus.textContent = S.meetNfcFailed })
        },
      }, [S.meetNfcWrite])
    : null
  const sharedDd = el('dd', {}, [notes ? S.meetSharedValue : S.meetSharedNoNotes])
  const mine = (): Partial<Record<Channel, string>> => st().myChannels ?? {}
  // The mode in force may change under this page (a link removed in Settings); everything below asks shareModeNow() each time.
  const modeChannel = (): Channel | null => channelOf(shareModeNow())
  const pick = (m: ShareMode): void => { setShareMode(m); apply() }
  const box: ContactBox = buildContactBox({
    changed: () => apply(),
    ticked: () => apply(true),
  })
  const publicVia = el('p', { class: 'meta', 'data-public-link-via': '', hidden: true })
  const sharing = createSharingLine({
    sharing: () => modeSharing(shareModeNow(), st().myChannels, st().contactShare),
    channel: modeChannel,
    controls: () => { const ch = modeChannel(); return ch && mine()[ch] ? tickControlsFor(ch, () => apply(true)) : null },
    addLink: (ch) => box.edit(ch),
  })
  // The long link is set again only when the mode changes its fragment (TrustWeb + Signal / WhatsApp add `via=`).
  let link = ''
  let baseFrag = ''
  let appliedFrag: string | null = null
  const apply = (ticksOnly = false): void => {
    const mode = shareModeNow()
    const frag = [baseFrag, viaFragment(mode)].filter(Boolean).join('&')
    if (link && frag !== appliedFrag) { appliedFrag = frag; view.setLink(link, frag) }
    // Only Signal / Only WhatsApp: the QR, Copy and NFC carry the messenger's own link; none (number not ticked) -> no QR, Copy / NFC off.
    view.setOverride(isOnlyMessenger(mode) ? modePayload(mode, '', mine(), st().contactShare) ?? '' : null)
    cameraNote.hidden = !needsCameraApp(mode, mine())
    copy.disabled = !view.current()
    if (nfc) nfc.disabled = !view.current()
    row.refresh()
    const via = publicLinkVia(mode)
    publicVia.hidden = !via
    publicVia.textContent = via ? S.publicLinkOffers(reachOutLink(), S.chLabel[via]) : ''
    sharing.refresh()
    if (ticksOnly) box.refreshTicks()
    else advanced.refresh()
    advanced.setOpen(meetAdvancedOpen)
  }
  const row = createShareRow({
    modes: () => defaultModes(mine()),
    current: shareModeNow,
    pick,
    isOpen: () => meetAdvancedOpen,
    toggleAdvanced: () => { meetAdvancedOpen = !meetAdvancedOpen; apply(true) },
  })
  const namesView = createNamesView({
    names: () => namesSync().names(),
    claim: (name, isAlias) => namesSync().claim(name, isAlias),
    release: (name) => namesSync().release(name),
  })
  const advanced = createAdvanced({
    modes: { list: () => advancedModes(mine()), current: shareModeNow, pick },
    names: { available: () => connectEligible() && st().connectCode !== undefined, el: namesView.el },
  })
  // The names block appears once the code is on the server, and asks the server which names the code holds (also the ones the operator granted).
  let shown = false
  const stopListening = codeKeeper().onChange(() => {
    if (qr.isConnected) { shown = true; advanced.refresh(); void namesSync().refresh() } else if (shown) stopListening()
  })
  const stopNames = namesSync().onChange(() => { if (qr.isConnected) namesView.update(); else stopNames() })
  // Meet was opened by the person: ask (names the operator granted show at once after a reload; a read at most every 30 s, because POST /name shares
  // the per-address budget of POST /connect and many phones can sit behind one venue address).
  if (st().connectCode) void namesSync().refresh()
  void (async () => {
    await net.start()
    link = net.connectLink(CONNECT_URL)
    // After a meeting the code also carries the notes and the transcript, encrypted (share.ts); the key rides in the fragment only,
    // which a browser never sends to a server, and which the redirect of /c/<code> keeps.
    baseFrag = notes ? 'n=' + encodeURIComponent(notes.slice(0, 300)) : ''
    const share = await meetSharePack()
    if (share) {
      baseFrag += (baseFrag ? '&' : '') + shareFragment(share)
      sharedDd.textContent = transcriptStillComing(draftMeeting()) ? S.meetSharedPending : S.meetSharedTranscript
    }
    apply()
  })()
  return el('div', { class: 'meet-page' }, [
    el('p', { class: 'hint' }, [S.meetLead]),
    row.el,
    publicVia,
    qr,
    cameraNote,
    sharing.el,
    el('div', { 'data-contact-box-on-meet': '' }, [
      el('h4', { class: 'eyebrow', 'data-adv-links': '' }, [S.advLinksTitle]),
      el('p', { class: 'meta' }, [S.advLinksHint]),
      box.el,
    ]),
    el('dl', { class: 'qr-facts' }, [
      el('dt', {}, [S.meetRing]), el('dd', {}, [S.meetRingValue]),
      el('dt', {}, [S.meetShared]), sharedDd,
    ]),
    notes ? el('blockquote', { class: 'shared-notes' }, [notes.slice(0, 300)]) : null,
    copy,
    inviteBtn,
    inviteCount,
    view.el,
    advanced.el,
    el('h4', { class: 'eyebrow' }, [S.meetWaysTitle]),
    el('p', { class: 'meta', 'data-ways': 'now' }, [S.meetWaysNow]),
    el('p', { class: 'meta', 'data-ways': 'soon' }, [S.meetWaysSoon]),
    el('p', { class: 'meta', 'data-ways': 'later' }, [S.meetWaysLater]),
    // Where the browser can write a tag (Chrome on Android), the link can go onto one; phone to phone stays "later".
    nfc,
    nfc ? nfcStatus : null,
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

/** Is demo-peer.json known yet? If not, it is asked for once and the waiting connect-acks are re-sent when it is (ack_retry.ts). */
function demoPeerKnown(): boolean {
  if (demoPeer !== undefined) return true
  if (!demoPeerProbe) void probeDemoPeer().then(() => net.resendAcks())
  return false
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
  } else if (notice === KeepNotice.Yes && s.testOf && s.testOf.name === peer.displayName
    && s.people.some((p) => p.peerId === peer.id && p.name === s.testOf?.name) && guestGranted(s.testOf)) {
    save()
    toast(S.demoKeptByOwner(peer.displayName))
    render()
  }
}

/** Guest: "Make it your personal account" asks the owner to keep this account; its own end stays until he says yes. */
function askOwnerToKeep(): void {
  const s = st()
  const t = s.testOf
  if (!t || guestKept(t)) return
  // Asking again is allowed: a yes lost on a relay outage would otherwise leave the account to run out (the owner's phone answers every ask).
  guestAsk(t)
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
/** A peer that is gone: its chat thread (with any message still waiting for it) and the record of what contact it was sent go too. */
function forgetPeerTraces(s: AppState, peerId: string): void {
  if (s.chats) s.chats = removeThread(s.chats, peerId)
  if (s.contactSent && typeof s.contactSent === 'object' && peerId in s.contactSent) {
    const next = { ...s.contactSent }
    delete next[peerId]
    s.contactSent = next
  }
}

function removeDemoAccount(id: string, why: 'ended' | 'expired' = 'ended'): void {
  const s = st()
  const acct = (s.testAccounts ?? []).find((t) => t.id === id)
  // Never the account this tab runs as: the current device is not removed (demo_devices.ts).
  if (!acct || !canEndDemoAccount(s.testOf, id)) return
  if (acct.peerId) {
    s.peers = s.peers.filter((p) => p.id !== acct.peerId)
    s.people = s.people.filter((p) => p.peerId !== acct.peerId)
    forgetPeerTraces(s, acct.peerId)
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
  if (!yes) { save(); hideNotice(); toast(S.demoAcctDenied(acct.name)); render(); showAskCards(); return }
  // A second phone on the same code replaces the first.
  if (acct.peerId && acct.peerId !== held.id) {
    s.peers = s.peers.filter((p) => p.id !== acct.peerId)
    s.people = s.people.filter((p) => p.peerId !== acct.peerId)
    forgetPeerTraces(s, acct.peerId)
  }
  const peer = await net.admitPeer(held)
  acct.peerId = peer.id
  // Kept before this phone was admitted (or by a second phone on the same code): the guest learns it now, not never.
  if (isKept(acct)) void net.sendText(peer, keepText(APP_URL, KeepNotice.Yes)).catch(() => { /* the guest can ask again */ })
  let person = s.people.find((p) => p.peerId === peer.id)
  if (!person) {
    person = { id: randomId(8), name: peer.displayName, context: S.demoAccountContext, ring: peer.ring, metAt: Date.now(), lines: [], peerId: peer.id }
    s.people.push(person)
  }
  save()
  hideNotice()
  toast(S.demoAcctAllowed(acct.name))
  render()
  showAskCards()
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
    const base = net.connectLink(CONNECT_URL)
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
  // Another phone's bytes: no bidi overrides or control characters kept (safe_text.ts), clipped.
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? stripUnsafe(v).slice(0, max) : '')
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
  if (guestAsked(t)) {
    return el('div', { class: 'keep-ask' }, [
      el('p', { class: 'meta', 'data-keep-asked': '1' }, [S.demoKeepAsked(t.name)]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-keep-ask-again': '1', onclick: askOwnerToKeep }, [S.demoKeepAskAgain]),
    ])
  }
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
      // The public link and its secret are the owner's, not the demo account's (F17).
      const { connectCode: _c, otherCodes: _o, pendingRenew: _p, ...rest } = s
      const pack: AppState = { ...rest, testOf: { ...t, own: undefined } }
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
        onclick: () => { draft.lines.push({ id: randomId(8), text: '', tag: Tag.Note, audience: RECORD_LINE_AUDIENCE }); render() },
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
  const target = contextTarget()
  // The meeting is stored first, so every item can point at it (the chain of proof). Its lines carry an audience only when the
  // screen showed one per line (screenPlaceWhat); the context screen of an existing thing shows none, so none is stored (notes_source.ts).
  if (draftIsMeeting()) recordPastMeeting({ reviewed: !target })
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
  // No audience is stored: the Review screen of a plain note shows none per line, so its lines never answer an ask (notes_source.ts, fail closed).
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
  changeRing(p, draft.ring)
  if (draft.context.trim()) p.context = draft.context.trim()
  // The meeting is stored first, so every note can point at it (the chain of proof).
  if (draftIsMeeting()) recordPastMeeting({ personId: p.id, reviewed: true })
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

function screenStillTrue(): Node[] {
  const r = review
  const p = r ? st().people.find((x) => x.id === r.personId) : undefined
  if (!r || !p) { screen = Screen.Web; return screenWeb() }
  const now = Date.now()
  const cards = p.lines.filter((l) => l.status === LineStatus.Current && lineShown(st(), l, p)).map((l: NoteLine) => {
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
function editNameSheet(fromWeb = false): void {
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
    // Wave 6b: the connect link carries the name, so the server's copy under the same code is updated (only where a code was ever made).
    if (s.connectCode) void ensureConnectCode()
  }
  name.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') saveName() })
  openSheet([
    el('h3', {}, [S.meNameTitle]),
    name,
    el('p', { class: 'meta' }, [S.meNameHint]),
    el('button', { class: 'btn btn-electric', onclick: saveName }, [S.meNameSave]),
    // Tapped in the Web view: a line, then the section for the web itself.
    ...(fromWeb ? [
      el('hr', { class: 'sheet-line' }),
      el('h4', { class: 'eyebrow' }, [S.myWebTitle]),
      el('button', { class: 'btn btn-ghost', 'data-space-out': 'all', onclick: () => { closeSheet(); spaceOutWeb() } }, [S.ringsSpaceAll]),
    ] : []),
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

/** What the owner's public link reads as in Settings: trustweb.one/<primary name> once claimed. */
function reachOutLink(): string {
  const name = namesSync().names().name
  return name ? `trustweb.one/${name}` : 'your link'
}

/**
 * Settings sections: a folded <details> each; the open state is remembered per device (trustweb.ui.settings.<key>);
 * `first` opens when nothing is remembered. An empty section is not drawn.
 */
function settingsSection(key: string, title: string, children: (Node | null)[], first = false): Node | null {
  if (!children.some(Boolean)) return null
  const attrs: Record<string, string> = { 'data-settings-section': key, class: 'settings-adv' }
  if (key === 'advanced') attrs['data-settings-advanced'] = '1'
  const d = el('details', attrs, [el('summary', { class: 'adv-toggle' }, [title]), ...children]) as HTMLDetailsElement
  const k = `trustweb.ui.settings.${key}`
  try { const v = localStorage.getItem(k); d.open = v === null ? first : v === '1' } catch { d.open = first }
  d.addEventListener('toggle', () => { try { localStorage.setItem(k, d.open ? '1' : '0') } catch { /* ignore */ } })
  return d
}

/** A Settings > Features switch; off is the only stored state (featureOn in model.ts). */
function featureSwitch(s: AppState, key: 'events' | 'inventory', label: string, hint: string): HTMLElement {
  const on = featureOn(s, key)
  return el('button', {
    class: 'radio' + (on ? ' on' : ''), 'aria-pressed': String(on), [`data-feature-${key}`]: '1',
    onclick: () => {
      setFeature(s, key, !on); save(); renderTabs()
      if (!featureOn(s, 'inventory') && screen === Screen.Inventory) screen = Screen.Web
      render(); settingsSheet()
    },
  }, [el('b', {}, [label]), el('small', {}, [hint])])
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
    viewRow(),
    apkSettingsRow(apkHintEnv()) ? el('div', { class: 'inst-apk', 'data-apk-settings-hint': '' }, [el('b', {}, [S.apkSettingsTitle]), apkPart(S.apkSettingsShown)]) : null,
    s.testOf ? el('p', { class: 'meta' }, [s.testOf.own ? S.setDemoOfOwn(s.me.displayName) : guestKept(s.testOf) ? S.setDemoKeptOf(s.testOf.name) : S.setDemoOf(s.testOf.name)]) : null,
    s.testOf && demoOfLine(s) ? el('p', { class: 'meta' }, [demoOfLine(s)]) : null,
    keepAskRow(s),
    s.testOf && !s.testOf.handedOverAt ? el('button', { class: 'btn btn-ghost', onclick: handoverSheet }, [S.handTitle]) : null,
    settingsSection('you', S.setSecYou, [
      el('button', { class: 'conn-row name-row', 'aria-label': S.meNameAria(s.me.displayName), onclick: () => editNameSheet() }, [
        el('b', {}, [S.setYourName]), el('span', {}, [s.me.displayName]), el('em', {}, [S.setYourNameEdit]),
      ]),
      connectionRow(),
      buildContactBox({}).el,
      el('button', {
        class: 'radio' + (s.profileAutoOff ? '' : ' on'), 'aria-pressed': String(!s.profileAutoOff), 'data-profile-auto': '1',
        // Only "off" is stored: absent means on.
        onclick: () => { if (s.profileAutoOff) delete s.profileAutoOff; else s.profileAutoOff = true; save(); settingsSheet() },
      }, [el('b', {}, [S.profAutoShare]), el('small', {}, [S.profAutoShareHint])]),
    ], true),
    settingsSection('web', S.setSecWeb, [
      el('button', { class: 'btn btn-ghost', 'data-settings-curate': '', onclick: curatorSheet }, [S.searchCurate]),
    ]),
    settingsSection('reach', S.reachOutsTitle, solo || s.testOf ? [] : [
      el('button', {
        class: 'radio' + (s.reachOutsPaused ? ' on' : ''), 'aria-pressed': String(Boolean(s.reachOutsPaused)), 'data-reach-outs-pause': '1',
        onclick: () => { if (s.reachOutsPaused) delete s.reachOutsPaused; else s.reachOutsPaused = true; save(); settingsSheet() },
      }, [el('b', {}, [S.reachOutsPause])]),
      el('p', { class: 'meta', 'data-reach-outs-held': '' }, [S.reachOutsHeldCount(s.reachOutHeld ?? 0)]),
      s.reachOutHeld ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { delete s.reachOutHeld; save(); settingsSheet() } }, [S.reachOutsReset]) : null,
      el('p', { class: 'meta' }, [S.reachOutsSettingsHint(reachOutLink())]),
    ]),
    settingsSection('notifications', S.setSecNotify, [notificationsCard(s)]),
    settingsSection('devices', S.setSecDevices, connectEligible() ? devices.settingsGroup() : []),
    settingsSection('features', S.setSecFeatures, [
      ...feed.settingsGroup(),
      featureSwitch(s, 'events', S.setFeatEvents, S.setFeatEventsHint),
      featureSwitch(s, 'inventory', S.setFeatInventory, S.setFeatInventoryHint),
    ]),
    settingsSection('sources', S.setSources, sourcesGroup(s)),
    settingsSection('advanced', S.setAdvanced, [
    el('h4', { class: 'eyebrow' }, [S.setQuery]),
    ...[QueryStyle.Call, QueryStyle.Search].map((q) => el('button', {
      class: 'radio' + (queryStyle() === q ? ' on' : ''),
      onclick: () => { s.queryStyle = q; save(); render(); settingsSheet() },
    }, [el('b', {}, [S.setQueryLabel[q]]), el('small', {}, [S.setQueryHint[q]])])),
    ...recordingSettings(s),
    ...hosting.settingsGroup(),
    ...(solo ? [] : importGroup({ state: st, save, openSheet, closeSheet, toast, changed: render, settings: settingsSheet })),
    el('h4', { class: 'eyebrow' }, [S.setTabs]),
    pick(TabOrder.WebLeft, S.setTabsWebLeft),
    pick(TabOrder.InventoryLeft, S.setTabsInvLeft),
    el('p', { class: 'meta' }, [S.setTabsHint]),
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
    // The installed app offers no demo content (owner 2026-10-07); where some is already on, removing it stays possible.
    demoSettingsShown ? el('h4', { class: 'eyebrow' }, [S.setDemo]) : null,
    demoSettingsShown ? el('button', {
      class: 'radio' + (demoShown(s) ? ' on' : ''),
      'aria-pressed': String(demoShown(s)),
      onclick: () => { toggleDemoContent(); settingsSheet() },
    }, [el('b', {}, [demoShown(s) ? S.demoHide : S.demoAdd]), el('small', {}, [S.setDemoHint])]) : null,
    demoSettingsShown && s.demo ? el('button', {
      class: 'radio',
      'data-remove-demo': '1',
      onclick: () => { removeDemoContent(); settingsSheet() },
    }, [el('b', {}, [S.demoRemove]), el('small', {}, [S.setDemoRemoveHint])]) : null,
    channelsView(myChannels(), { title: S.myTitleMore, add: S.myAdd, hint: S.myHint }, CHANNELS_OTHER),
    el('div', { 'data-blocked-list': '1' }, [
      el('b', {}, [S.blockedTitle]),
      ...(s.people.some(isBlocked)
        ? s.people.filter(isBlocked).map((b) => el('div', { class: 'conn-row' }, [el('span', {}, [b.name]), blockRow(b)]))
        : [el('p', { class: 'meta' }, [S.blockedNone])]),
    ]),
    el('button', {
      class: 'radio' + (s.showRingNames ? ' on' : ''),
      'aria-pressed': String(s.showRingNames === true),
      onclick: () => { s.showRingNames = !s.showRingNames; save(); render(); settingsSheet() },
    }, [el('b', {}, [S.setRingNames]), el('small', {}, [S.setRingNamesHint])]),
    el('button', {
      class: 'radio' + (s.preferConsensual === false ? '' : ' on'), 'aria-pressed': String(s.preferConsensual !== false), 'data-prefer-consensual': '1',
      // Only "off" is stored: absent means on.
      onclick: () => { if (s.preferConsensual === false) delete s.preferConsensual; else s.preferConsensual = false; save(); settingsSheet() },
    }, [el('b', {}, [S.setConsensual]), el('small', {}, [S.setConsensualHint])]),
    el('button', {
      class: 'radio' + (askDirectOnly(s) ? ' on' : ''), 'aria-pressed': String(askDirectOnly(s)), 'data-direct-only': '1',
      // Off is stored as absent: the record keeps only what differs from the default.
      onclick: () => { if (askDirectOnly(s)) delete s.askDirectOnly; else s.askDirectOnly = true; save(); render(); settingsSheet() },
    }, [el('b', {}, [S.setDirectOnly]), el('small', {}, [S.setDirectOnlyHint])]),
    liveTogetherPrefs(s.togetherPrefs, Date.now()).length === 0 ? null : el('div', { 'data-together-prefs': '1' }, [
      el('p', { class: 'meta' }, [S.setTogetherHint(liveTogetherPrefs(s.togetherPrefs, Date.now()).length)]),
      el('button', { class: 'btn', onclick: () => { delete s.togetherPrefs; save(); settingsSheet() } }, [S.setTogetherForget]),
    ]),
    el('button', {
      class: 'radio' + (asksMatchNotes(s) ? ' on' : ''), 'aria-pressed': String(asksMatchNotes(s)), 'data-notes-match': '1',
      // Stored only when it differs from the default of this account type (notes_source.ts), so a change of default never flips a choice.
      onclick: () => { const next = !asksMatchNotes(s); if (next === notesMatchDefault(s)) delete s.asksMatchNotes; else s.asksMatchNotes = next; save(); settingsSheet() },
    }, [el('b', {}, [S.setNotesMatch]), el('small', {}, [S.setNotesMatchHint])]),
    el('button', {
      class: 'radio' + (noticesOff(s) ? ' on' : ''), 'aria-pressed': String(noticesOff(s)), 'data-notices-off': '1',
      onclick: () => { setNoticesOff(s, !noticesOff(s)); save(); settingsSheet() },
    }, [el('b', {}, [S.setNoNotices]), el('small', {}, [S.setNoNoticesHint])]),
    solo ? null : el('button', {
      class: 'radio' + (showsUnmatched(s, demoPhone()) ? ' on' : ''), 'aria-pressed': String(showsUnmatched(s, demoPhone())), 'data-unmatched-switch': '1',
      // Stored only when it differs from this phone's default (unmatched_asks.ts showsUnmatched).
      onclick: () => {
        const next = !showsUnmatched(s, demoPhone())
        if (next === !demoPhone()) delete s.showUnmatchedAsks
        else s.showUnmatchedAsks = next
        save(); settingsSheet(); showAskCards()
      },
    }, [el('b', {}, [S.setUnmatched]), el('small', {}, [S.setUnmatchedHint])]),
    ...HINTS.map((id) => el('button', {
      class: 'radio' + (hintHidden(id) ? '' : ' on'),
      'aria-pressed': String(!hintHidden(id)),
      onclick: () => { setHintHidden(id, !hintHidden(id)); render(); settingsSheet() },
    }, [el('b', {}, [S.setHintsOne(S.hintLabel[id])]), el('small', {}, [S.hintText[id]])])),
    ]),
    el('h4', { class: 'eyebrow' }, [S.setTutorial]),
    el('button', {
      class: 'btn btn-ghost', disabled: !(s.hiddenHints?.length),
      onclick: () => { delete s.hiddenHints; save(); render(); settingsSheet() },
    }, [S.setHintsAll]),
    el('p', { class: 'meta' }, [S.setHintsAllHint]),
    installable && !installedHere() ? el('button', { class: 'btn btn-ghost', 'data-open-install': '1', onclick: openInstallSheet }, [S.setInstall]) : null,
    ...apkUpdatesRow(s),
    ...aboutGroup(),
    // safetyLink(SafetyPlace.Settings, () => openSheet(safetySheetNodes({ place: SafetyPlace.Settings, back: { label: S.safeBackSettings, go: settingsSheet } }))),
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

/**
 * Settings > Sources (Jakob 2026-10-16): each imported source (Tana, your notes) with a show/hide switch (a view choice; the
 * notes still answer asks) and "Remove from this phone" (one shot after a warning; a new import brings it back). Only the
 * sources the record holds are listed.
 */
function sourcesGroup(s: AppState): Node[] {
  const rows = SOURCES.map((kind) => ({ kind, n: sourceCount(s, kind) })).filter((r) => r.n.people || r.n.lines)
  if (!rows.length) return []
  return [
    el('p', { class: 'meta' }, [S.setSourcesHint]),
    ...rows.flatMap(({ kind, n }) => [
      el('button', {
        class: 'radio' + (sourceHidden(s, kind) ? '' : ' on'), 'aria-pressed': String(!sourceHidden(s, kind)), 'data-source-shown': kind,
        onclick: () => { setSourceHidden(s, kind, !sourceHidden(s, kind)); save(); render(); settingsSheet() },
      }, [el('b', {}, [S.setSourceShow(S.provLabel[kind])]), el('small', {}, [S.setSourceCount(n.people, n.lines)])]),
      el('button', {
        class: 'btn btn-ghost btn-sm', 'data-source-remove': kind,
        onclick: () => {
          if (!confirm(S.setSourceRemoveConfirm(S.provLabel[kind], n.people, n.lines))) return
          const gone = removeSource(s, kind, () => randomId(8))
          save(); render(); toast(S.setSourceRemoved(gone.people, gone.lines)); settingsSheet()
        },
      }, [S.setSourceRemove]),
    ]),
  ]
}

// ---------------------------------------------------------------------------
// backup: the card in Inventory and its sheets (backup_view.ts)
// ---------------------------------------------------------------------------

const backup = createBackupView({
  persona, storeCtx, state: st, openSheet, closeSheet, toast,
  replaceRecord: (s) => { state = s; save(); location.reload() },
  beforeRestore: () => snapshots.take(S.snReasonRestore),
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
  return Math.max(0, Math.ceil((startedAt + askWaitMs(reach, net.answerWindowMs) - Date.now()) / 1000))
}

/** A together request waiting for the second tap: the compiled sentence is in the box, its reach and filled settings wait here. */
let togetherPending: { text: string; reach: number | undefined; filled: TogetherRequest } | null = null
/** Wave 19: the place picked with the dock's button (on this phone only until a request with it is sent). */
let togetherPlace: Place | null = null

/** The dock's "Pick a place": the device position on a tap (together_location.ts geoPicker), with the area words typed so far as its name. */
async function pickTogetherPlace(): Promise<void> {
  const typed = readTogetherRequest(queryText, Date.now())?.area ?? ''
  togetherPlace = await geoPicker(navigator.geolocation).pick(typed)
  render()
}

/**
 * Wave 16: the dock's send. A sentence of the pattern "I want to play padel again before Thursday / who wants to go hiking with me"
 * becomes a together request: remembered settings of the same activity fill what it leaves out and the compiled sentence replaces the
 * box text, so the person SEES everything that will go out (area, window) before it does; the second tap sends it. Its friend degree
 * rides on this one ask only (the dock's "How far?" stays as it was); what it chose becomes the next default only when it is sent.
 * Anything that is not a together request is asked as typed, at once.
 */
async function sendFromDock(text: string): Promise<void> {
  const now = Date.now()
  const pending = togetherPending
  togetherPending = null
  if (pending && pending.text === text.trim()) {
    const s = st()
    s.togetherPrefs = rememberTogether(s.togetherPrefs, pending.filled, now, togetherPlace ?? undefined)
    togetherPlace = null
    save()
    void runAsk(pending.text, pending.reach)
    return
  }
  // No model call exists in the app yet: draftOrPlain reads plainly while TOGETHER_LLM_DRAFT is off (together_request.ts).
  const read = await draftOrPlain(text, now, async () => null)
  if (!read) { void runAsk(text); return }
  const req = togetherPlace?.label && !read.area ? { ...read, area: togetherPlace.label } : read
  const filled = fillFromPrefs(req, st().togetherPrefs, now)
  const ask = togetherAsk(filled, navigator.language)
  queryText = ask.text
  togetherPending = { text: ask.text, reach: filled.reach, filled }
  render()
}

async function runAsk(text: string, reach?: number): Promise<void> {
  const t = text.trim()
  if (!t) return
  const peers = askPeers(st())
  askRun = { text: t, asked: peers.length, askedPeerIds: peers.map((p) => p.id), startedAt: Date.now(), results: null, reach: reach !== undefined && !askDirectOnly(st()) ? reach : askReachOf(st()) }
  clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    const w = document.getElementById('tw-wait')
    if (w && askRun && !askRun.results) w.textContent = ' ' + S.queryWaiting(secondsLeft(askRun.startedAt, askRun.reach))
  }, 1000)
  render()
  const results = await net.ask(t, reach)
  clearInterval(countdownTimer)
  if (askRun && askRun.text === t) askRun.results = results
  recordFound(t, results)
  if (screen === Screen.Web) render()
}

function resultsView(results: AskResult[], asked: { text: string; at: number }): HTMLElement[] {
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
    // Wave 6i: a message from the answer carries the question (chat_re.ts).
    personOf(st().people, r.peerId)
      ? el('button', { class: 'btn btn-ghost btn-sm', 'data-answer-message': r.peerId, onclick: () => messageAbout(r.peerId, r.qid, asked.text, asked.at) }, [S.answerMessage(r.peerName)])
      : null,
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
        el('p', { class: 'hint' }, [(run.reach === HOPS_DEFAULT ? S.queryWindow : S.queryWindowFar)(Math.round(askWaitMs(run.reach, net.answerWindowMs) / 1000))]),
        run.results
          ? el('div', {}, [...resultsView(run.results, { text: run.text, at: run.startedAt }), webSearchRow(run.text, webResults).el])
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
      !run && togetherPending ? el('p', { class: 'hint', 'data-together-check': '1' }, [S.queryTogetherCheck]) : null,
      !run && askDirectOnly(s) ? el('p', { class: 'hint', 'data-direct-note': '1' }, [S.queryDirectOnly]) : null,
      // Wave 6: how far the ask travels, remembered on this phone; "Ask only my direct contacts" (Settings > Advanced) holds it at 1.
      reachChooser(askReachOf(s), askDirectOnly(s) || busy, (reach) => {
        if (reach === HOPS_DEFAULT) delete s.askReach; else s.askReach = reach
        save(); render()
      }),
      s.peers.length === 0 ? el('p', { class: 'warn' }, [S.queryNoPeers]) : null,
      demoEnded ? el('p', { class: 'warn' }, [S.demoEndedLine]) : demoWaiting && s.testOf ? el('p', { class: 'warn' }, [S.demoWaitingAsk(s.testOf.name)]) : null,
      box,
      run ? null : el('div', { class: 'chips', 'data-together-place': '1' }, [
        togetherPlace
          ? el('button', { class: 'chip', 'data-together-place-chosen': '1', title: S.togetherPickClear, onclick: () => { togetherPlace = null; render() } }, [S.togetherPicked(togetherPlace.label || S.togetherHere) + ' ×'])
          : el('button', { class: 'chip', 'data-together-pick': '1', title: S.togetherPickHint, onclick: () => { void pickTogetherPlace() } }, ['📍 ' + S.togetherPick]),
      ]),
      run ? null : el('div', { class: 'chips' }, [
        el('span', { class: 'chips-lbl' }, [S.queryTry]),
        ...SUGGESTIONS.map((q) => el('button', { class: 'chip', onclick: () => { queryText = q; render() } }, [q])),
      ]),
      el('button', {
        class: 'btn btn-electric wide', disabled: busy || s.peers.length === 0 || demoWaiting || demoEnded,
        onclick: () => { void sendFromDock(queryText) },
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
  // Review 6i: nothing tappable lies over the consent prompt (its Share and Not now).
  hideMsgNotice()
  overlay.classList.add('on')
  const decided = askDecision
  clear(overlay)
  overlay.append(
    el('div', { class: 'orb orb1' }), el('div', { class: 'orb orb2' }),
    el('div', { class: 'ask' }, [
      el('span', { class: 'eyebrow' }, [a.earlier ? S.askEarlierEyebrow(a.fromName, a.earlier.at !== null ? askWhenLabel(a.earlier.at) : null) : a.arrivedLate ? S.askLateEyebrow : askEyebrow(a)]),
      el('h2', {}, [S.askFrom(a.fromName)]),
      el('p', { class: 'ask-q' }, ['"' + a.text + '"']),
      fitLine(a),
      decided === null
        ? el('div', {}, [
            el('p', { class: 'ask-lbl' }, [S.askMatches]),
            ...a.matches.map((m) => el('div', { class: 'ask-line' }, [el('span', {}, [m.text, threadIsDemo(st(), m.threadId) ? dummyChip() : null]), el('small', {}, [m.context])])),
            el('button', { class: 'btn btn-mint', onclick: () => decide(true) }, [S.askShare]),
            el('button', { class: 'btn btn-ghost', onclick: () => decide(false) }, [S.askDecline]),
            el('p', { class: 'ask-foot' }, [yesIsLate(a) ? S.askLateFoot(a.fromName) : S.askFoot(a.fromName)]),
          ])
        : el('div', {}, [
            el('p', { class: 'ask-done' }, [decided ? S.askSent : S.askNotSent]),
            el('p', { class: 'ask-foot' }, [decided && askDecidedLate ? S.askSentLateSub(a.fromName) : S.askSentSub]),
            askMessageButton(a),
            el('button', { class: 'btn btn-ghost', onclick: showNextAsk }, [S.askClose]),
          ]),
    ]),
  )
}

/** Wave 19: "Fits your padel settings" under an incoming together ask that matches one of the person's own (together_match.ts fitOfAsk). */
function fitLine(a: IncomingAsk): HTMLElement | null {
  const fit = fitOfAsk(a.text, st().togetherPrefs, Date.now())
  return fit ? el('p', { class: 'hint', 'data-together-fit': '1' }, [S.askFitsSettings(fit.activity)]) : null
}

/**
 * Wave 6i: "Message <name>" once the prompt is decided, for an ask straight from its asker: the chat opens carrying this ask, so the
 * reply ("I do") arrives with its question (chat_re.ts).
 */
function askMessageButton(a: IncomingAsk): HTMLElement | null {
  const peerId = a.askerPeerId
  if (!peerId || !personOf(st().people, peerId)) return null
  return el('button', {
    class: 'btn btn-electric', 'data-ask-message': '1',
    // Review 6i: an earlier ask is quoted with its first time, as the asker's phone binds it (chat_re.ts bindRe).
    onclick: () => { showNextAsk(); messageAbout(peerId, a.qid, a.text, a.earlier?.at ?? a.receivedAt) },
  }, [S.askMessage(a.fromName)])
}

/** Who handed this ask over: a front door (older doors name themselves as the asker), the people it came through, or nobody. */
function askEyebrow(a: IncomingAsk): string {
  if (a.doorName) return S.askThroughDoor(a.doorName)
  if (a.relayed) return S.askRelayed(a.fromName)
  return a.through.length ? S.askThrough(a.through) : S.askEyebrow
}

/** Wave 6h: would a yes now reach the asker as "answered later" (after the moment of an ask that carried its window)? */
function yesIsLate(a: IncomingAsk): boolean {
  return a.lateMode && (a.arrivedLate || Date.now() >= a.deadline)
}

function decide(share: boolean): void {
  const a = askShowing
  if (!a || askDecision !== null) return
  askDecidedLate = yesIsLate(a)
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

/** Is the person in an open sheet or a field? Then the screen is not drawn again under them (their sheet and their typing stay). */
function busyOnScreen(): boolean {
  const a = document.activeElement
  const typing = a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || (a instanceof HTMLElement && a.isContentEditable)
  return typing || sheet.classList.contains('on')
}

/** Wave 6f review: what another tab did to this persona's record (tab_sync.ts). */
function onStoredChange(next: AppState | null, removed: boolean): void {
  if (!state || superseded) return
  switch (storedChange(next, removed, state.me.id)) {
    case StoredChange.Adopt:
      if (next) adoptRecord(next)
      return
    case StoredChange.Superseded:
      supersede()
      return
    case StoredChange.Ignore:
      return
  }
}

/**
 * Takes the newer record over in place (tab_sync.ts adoptInPlace): the objects an open sheet or a pending handler holds stay the live
 * ones, so what the person does there is saved with the newer record and never writes the older one back.
 */
function adoptRecord(next: AppState): void {
  if (!state) return
  adoptInPlace(state, next)
  // Handed over to another phone from another tab: this tab never drains for that identity again (one relay identity, one phone).
  if (state.testOf?.handedOverAt) net.stop()
  if (busyOnScreen()) { redrawWaiting = true; return }
  render()
}

/** The sheet closed or the field was left after a take-over: draw the newer record now. */
function redrawAfterAdoption(): void {
  if (!redrawWaiting || busyOnScreen()) return
  redrawWaiting = false
  render()
}

/** Reset or given another identity in another tab: this copy is never written back; the page starts again from what is stored. */
function supersede(): void {
  superseded = true
  net.stop()
  location.reload()
}

// Wave 6f (drain_lock.ts): the tab in front of the person takes the relay drain; after a long time hidden (a laptop that slept) it
// opens a fresh socket, since the one it held may be dead without knowing it.
const WAKE_FRESH_MS = 60_000
let hiddenSince = document.visibilityState === 'hidden' ? Date.now() : 0
document.addEventListener('visibilitychange', () => {
  // Wave 12: the iPhone app in the background holds no drain, so the relay wakes it through Apple (net.ts pause); a fresh one when it is back.
  if (document.visibilityState === 'hidden') { hiddenSince = Date.now(); if (nativeApp) net.pause(); return }
  const slept = hiddenSince > 0 && Date.now() - hiddenSince > WAKE_FRESH_MS
  hiddenSince = 0
  if (!state || state.testOf?.handedOverAt) return
  // Review 6h: back in front after a long time away is an open too (an installed app on a phone is rarely started afresh).
  if (slept && appOpened()) showAskCards()
  net.activate(slept || nativeApp)
})
window.addEventListener('focus', () => { if (state && !state.testOf?.handedOverAt) net.activate(false) })
// Wave 6h (wake_watch.ts): a laptop that slept with this tab behind another window, a network that came back, a page restored from the
// back-forward cache: the socket may be dead without knowing it. A fresh one, without taking the drain from a tab in front.
const refreshDrain = (): void => { if (state && !state.testOf?.handedOverAt) net.refresh() }
watchWake(refreshDrain, { now: () => Date.now(), every: (fn, ms) => setInterval(fn, ms), stop: (h) => clearInterval(h as ReturnType<typeof setInterval>) })
window.addEventListener('online', refreshDrain)
window.addEventListener('pageshow', (e) => { if (e.persisted) refreshDrain() })
// Wave 6f: another tab (or the installed app) of this profile saved the record, e.g. a new connection it received while it held the
// drain: this tab takes it over instead of keeping an older copy and writing that back over it on its next save (tab_sync.ts).
window.addEventListener('storage', (e) => {
  if (e.storageArea !== localStorage || e.key !== storageKey(persona, storeCtx)) return
  onStoredChange(e.newValue === null ? null : parseRecord(e.newValue), e.newValue === null)
})
document.addEventListener('focusout', () => { if (redrawWaiting) setTimeout(redrawAfterAdoption, 0) })

render()
void refreshOwnPicture()
if (installable) setUpInstall(APP_URL, () => { if (sheet.dataset.kind === 'install' && sheet.classList.contains('on')) openInstallSheet() })
const afterCarry = (): void => { if (installable && wantInstall) openInstallSheet() }
if (pendingCarry) installSheets.carryAsk(pendingCarry, () => { pendingCarry = null; afterCarry() })
else {
  if (carryNotice) toast(carryNotice)
  afterCarry()
}
if (state && !state.testOf?.handedOverAt) {
  // Wave 6h: late answers to this phone's asks that came since the last open are released now, all together, and those the relay
  // still holds for it arrive with the drain and are released with them (review 6h, appOpened).
  appOpened()
  // Wave 6h (held_asks.ts): prompts not decided before a reload show again, still answerable (in the tab that drains, review 6h).
  void net.start().then(announceLink).then(() => net.restoreHeldAsks())
  void completePendingConnect()
  maybeOpenPendingShare()
  maybeOpenPendingEvent()
  // Wave 6f/6h: the cards about asks (late answers, nothing matched, asked while away); asks kept while closed arrive with the drain.
  setTimeout(showAskCards, 1500)
  // The server only learns of this phone when its code is first shown (Meet); a phone that has one keeps it current.
  if (state.connectCode) void ensureConnectCode()
  offerApkHint(offerDemoContent)
  offerNotifications()
  setTimeout(() => void offerApkUpdate(), 4000)
  sweepDemoAccounts()
  setInterval(sweepDemoAccounts, 60_000)
  // Wave 6: knowing this site's front door lets its forwarded asks go on through this phone (mayPassOnFrom).
  if (!solo && !state.testOf) void probeDemoPeer().then(() => net.resendAcks())
  // Round B: a cut-off server job reads "may still be charged"; early packs whose transcript is done go out;
  // kept meetings whose transcript was still arriving look for it.
  if (swiss.enabled()) {
    transcription.boot()
    // Someone who uses the Swiss server gets its status at once (the past meetings' buttons depend on it);
    // nobody else is asked anything at app open (review-app-b).
    if (transcription.anyConsent() || transcriptionChoice(st()) === TranscriptionChoice.Server || readHosting(st())?.on === true) void swiss.probe()
    hosting.boot()
  }
  if (connectEligible()) devices.start()
  packs.checkLate()
  // Resume the approve step after a reload while a phone still waits.
  const pending = demoAccounts().find((t) => t.pending)
  if (pending) showAllowCard(pending)
}
