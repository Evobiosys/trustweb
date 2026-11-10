/**
 * TrustWeb: the one merged demo app (app.trustweb.one/).
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
import { applyFamily, parseTreeFragment, treeUrl } from './family_tree_link'
import { fiveRingsOn, flagFromUrl, writeFlag } from './five_rings'
import { fieldOverviewPanel } from './five_rings_view'
import { applyTheme, readTheme, type Theme } from './theme'
import { applyLook, LOOKS, readLook, type Look } from './look'
import { setShowSystemTags, showSystemTags } from './colour_tags'
import { ownDataImported } from './own_data'
import { installMotionGate } from './motion_gate'
import './styles.css'
import { el, clear } from '../../demo/src/ui/dom'
import { COLOUR_TAGS_EVENT, loadColourTags, memberTagsOf, saveColourTags, tagsOf } from './colour_tags'
import type { ColourTag } from './colour_tags'
import { askPeers, isBlocked } from './non_responsive'
import { introForm, setIntroTarget } from './intro_ask_view'
import { introCard } from './intro_card_view'
import { decodeIntroLink, encodeIntroLink, introDraft } from './intro_link'
import type { IntroLink } from './intro_link'
import { introAskText } from './intro_ask'
import { cardInvitationsRow, invitationSheet, invitationsSection } from './invitations_view'
import type { InvitationIo } from './invitations_view'
import { addSupportIn, supportCards, supportForm, supportLine } from './support_ask_view'
import type { SupportIo } from './support_ask_view'
import { ASK_MODES, AskMode, nextAskMode, parseHereText, parseSupportText, recordHere } from './support_ask'
import { allowReachOut } from './reach_out_guard'
import { FAMILY_FIELD, webSlot } from './rings_layout'
import { PROVIDERS, guessProvider, validateEmail, composeHref, senderHint, providerLabel, type PrimaryEmail } from './primary_email'
import { displayName } from '../../../packages/person-fields/src/display_name'
import { renderQr } from '../../demo/src/ui/qr'
import { createShortLinker } from './short_link'
import type { ShortLinker } from './short_link'
import { createLinkChooser } from './short_link_view'
import { aliasUrl, ensureOwnAlias, registerAlias } from './short_alias'
import { createAliasLine } from './short_alias_view'
import { canRegister, createConnectKeeper, readConnectRecord } from './connect_code'
import { createNamesSync } from './names_sync'
import { sendCapRequest } from './name_cap_request'
import type { NamesSync } from './names_sync'
import { createNamesView } from './names_view'
import { GENERAL_NOTE_MAX, createAutosaver, generalNoteOf, setGeneralNote } from './general_notes'
// import { SafetyPlace, markFirstTimeShown, offerFirstTime } from './reassurance'
// import { safetyLink, safetySheetNodes } from './reassurance_view'
import { createTimelineSection, timelineImportButton } from './timeline_view'
import { addTagTo, chatShown, setMetAt, setRing, tagsAddable } from './card_small'
import { addEntries, parseTimelineImport } from './timeline'
import type { ConnectKeeper } from './connect_code'
import { createConnectView } from './connect_view'
import { seeInActionFoot } from './page_foot'
import type { ConnectView } from './connect_view'
import { renderConnectAdd } from './connect_add_view'
import { acceptWant, addWant, dismissWant } from './wants_to_connect'
import { createAdvanced, createShareRow, createSharingLine } from './connect_advanced_view'
import { BOX_CHANNELS, createContactBox } from './contact_box_view'
import type { ContactBox } from './contact_box_view'
import {
  ShareMode, channelOf, advancedModes, defaultModes, effectiveMode, isOnlyMessenger, isShareMode, modePayload, modeSharing, needsCameraApp, parseVia, publicLinkVia, viaFragment,
} from './share_modes'
import { resolveAddInput, ParseError, connectLinkOf } from './add_by_code'
import { check as checkFreshness, remember as rememberNonce } from './connect_freshness'
import { inviteText, sendInvite } from './invite'
import { PASS_ON_DEFAULT_NOTICE, dismissNotice, namePreviousId, noticeShown, noticesOff, passOnDefaultNoticeDue, setNoticesOff } from './notices'
import { cardPopAction, webTabAction } from './page_stack'
import { shouldShowBrowserOnly } from './browser_only_notice'
import { filterSettings } from './settings_search'
import type { AddFailure, StampedLink } from './add_by_code'
import { renamedTo } from './card_name'
import { channelEdit } from './card_view'
import { chatServices, noteUsed, togglePin as toggleChatPin } from './chat_row'
import type { ChatService } from './chat_row'
import { chatRow } from './chat_row_view'
import { cardFace, connectBlock, daysSection, infoNote, noMessengerBlock } from './card_pages_view'
import { cardSections, mergedTimeline } from './card_sections'
import { createPages } from './page_view'
import { createSovereignView } from './sovereign_switch_view'
import { applyForget, forgetText, noteForgetAck, parseForgetText } from './forget'
import { basisOf, seenLine, sharePageBody, sharingSettings } from './share_page_view'
import { linkEntries } from './person_links'
import { decodeModeLink, INTRODUCE_PERMISSIONS, parseIntroducePermission } from './qr_modes'
import type { QrContext } from './qr_modes'
import { openQrPage } from './qr_modes_view'
import { tapEdit } from './tap_edit'
import { HELLO_NAME_MAX, cleanHelloName, helloText, parseHelloText, wantsHelloName } from './hello'
import type { ConnectAddHandle } from './connect_add_view'
import type { LinkChooser } from './short_link_view'
import { type ConnectLinkParams } from '../../demo/src/connect_link'
import { randomId } from '../../demo/src/crypto'
import { Net } from './net'
import { stripUnsafe } from './safe_text'
import type { AskResult, IncomingAsk, RelayStatus } from './net'
import { AboutKind, ageLabel, archivedInvite, askDirectOnly, Audience, AUDIENCES, Channel, CHANNELS, DEFAULT_RECORDINGS, DefaultRecording, defaultRecording, demoAccountScope, demoOnlyForDemoAccounts, enginePlan, featureOn, feedOn, setFeature, HintId, HINTS, isDemoItem, LEANS, LineStatus, LogOutcome, pastMeetings, ProvenanceState, QueryStyle, RECORD_LINE_AUDIENCE, Ring, RINGS, reachOutLegendShown, ringColor, ServerJobState, Tag, TAGS, threadIsDemo, ENGINE_CHOICES, TranscriptionChoice, transcriptionChoice } from './model'
import { CONSENSUAL_AGREEMENTS_LINK, channelLink, normalizeHandle, waLink } from './channel'
import {
  REQUESTABLE, answerPlan, buildContactPayload, chatOnConsensual, consensualReachable, contactText, holdContact, mayAnswerRequest, mayAskAgain, parseRequestText, primaryReachable, reachableChannels,
  receiveContactText, requestText, settleDefaultTick, sharedReachables, takeContact, withTick,
} from './contact_share'
import { messengerLinksShown, shownChannels, toggleMessengerLinks } from './channel_visibility'
import type { HeldContacts, Reachable, ShareSettings } from './contact_share'
import { mergeContact } from './contact_share'
import { parsePersonShare, personShareLink } from './person_share_link'
import { parseNoteShare } from './notes_outline'
import { addReceivedNote, sharedNotesSection } from './shared_notes_view'
import { pollRelay, postNote, readRelayOn, type RelayDeps } from './notes_relay'
import { guestShell } from './ext/co_notes/co_invite'
import { deserializeIdentity } from '../../demo/src/did'
import { notesOutlineView } from './notes_view'
import { parseZoneShare, zoneItems, zoneShareLink, type ZoneLink } from './zone_share_link'
import { zoneLinksSettings } from './zone_share_link_view'
import { candidates, seenBy } from './share_page'
import { CHAT_TEXT_MAX, TextKind, markRead, peersWithPending, receiveText, removeThread, routeText, unreadTotal } from './chat'
import { chatFindRows, chatListRows, chatPickerRows, messengerSymbols } from './chat_list'
import type { ChatListPerson } from './chat_list'
import { skinsFor, skinOf, chooseSkin } from './skins'
import { PHONE_MAX, PROFILES, activeProfile, addBar, applyProfile, barChoices, barLayout, customFrom, modOfBar, moveBar, overflowChoices, resolveBar, setPrimary, showViewInBar, toggleBar, viewOfBar, type BarFlags, type BarId } from './bottom_bar'
import { contextPress } from './context_press'
import { sectionOfScreen, settingsOrder, type SettingsSection } from './settings_sections'
import { dismissOnOutside } from './key_press'
import { groupsView } from './groups_view'
import { expandedOf, pinnedViews, screenViews, togglePin, viewHeading, viewMenuEntries, webViewOf } from './view_menu'
import { advancedKeyOf, HEADER_PINS, headerControls, headerPins, qrTarget, showsSettingsGear, togglePinned } from './header_controls'
import type { HeaderPin } from './header_controls'
import { isAdvanced, setWebDefault, webDefaultOf, webTabLabel } from './web_default_view'
import { disclosureGlyph } from './disclosure'
import { LAYOUT_KEY, type Layout, isPhone, pickLayout } from './layout_pick'
import type { ViewKey, WebView } from './view_menu'
import { firstChatNotice } from './notify_first'
import { FEATURES, latestFeature, notifSeenOf, shouldOfferNotifications } from './features'
import type { ChatBook } from './chat'
import { bindRe, makeRe } from './chat_re'
import type { ChatRe } from './chat_re'
import { askWhenLabel, flushPending, renderChat, safeHref, renderShareControls, submitText } from './chat_view'
import type { ChatIo, ChatStrings, ShareStrings } from './chat_view'
import type { TwEvent, AppState, DemoAccount, Found, InventoryItem, ItemSource, NoteLine, PastMeeting, Peer, Person, ReceivedShare } from './model'
import { SOURCES, lineShown, removeSource, setHiddenSources, setSourceHidden, shown, sourceCount, sourceHidden } from './sources'
import { parseShareFragment, parseShareText, SHARE_PARAM, shareFragment, shareUrl } from './share'
import type { MeetingPack, ShareLink } from './share'
import { extractLines } from './notes'
import { S } from './strings'
import { createNetworkView } from './network_view'
import { createMapView } from './map_view'
import { peopleListBody, resetPeopleList, peopleQuery, setPeopleQuery } from './people_list_view'
import { keepNoticeDue, noticeText, overduePeople } from './keep_in_touch'
import { keepInTouchRow } from './keep_in_touch_view'
import { birthdayNoticeDue, birthdayRemindersOn, dismissAction, notifyBirthdays, upcoming } from './birthdays'
import { birthdayRow, thoughtRow } from './people_fields_view'
import { touchFromSync } from './touch_sync'
import { activeLineDue, recordThought } from './thought_of'
import { completeQuery, completeView, resetComplete, setCompleteQuery } from './complete_view'
import type { RowEdit } from './people_list_view'
import { knowsRow } from './knows_view'
import { clearStated, setStated } from './relations_model'
import { relationsSection } from './relations_view'
import { personImageOk } from './person_image'
import { applyImageMode, imageMode, pictureUrl } from './image_mode'
import { clearPhotosDb } from './ext/photos/photos_data'
import { faceMatchRow } from './ext/photos/photos_settings'
import { migrate } from './schema_version'
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
import type { BackupView } from './backup_view'
import { RecordOrigin, eventForDraft, recordModeFor } from './record_origin'
import { aboutGroup } from './about'
import { createUpdateCheck, reloadFresh, shouldReloadOnce } from './app_update'
import { devicesSectionChildren } from './devices_section'
import { linkButton, openLinkChange } from './link_change_view'
import { devEventsFile, mergeDevEvents, pushDevEvents } from './dev_events'
import { devMatchesOn, pollDevMatches, type MatchStatus } from './dev_matches'
import { mergeIncoming } from './matches'
import { matchesView } from './matches_view'
import { devRecordFile, seedDevRecord, seedHostedDevRecord } from './dev_record'
import { fetchEditStream, liveDevActive, liveSyncedAt, pushLiveDevRecord, seedLiveDevRecord } from './dev_record_live'
import { addNetworkDemo } from './network_seed'
import { demoShown, hideDemoContent, showDemoContent } from './demo_hide'
import { initDevFeature } from './dev_feature'
import { AgreementStatus, acceptAgreement, acceptText, addAgreement, parseAgreementText, proposalText, receiveAgreement, removeAgreement } from './agreements'
import { agreementsSection } from './agreements_view'
import { isJpegDataUrl } from '../../demo/src/types'
import { addNorm, autoSendRank, buildProfileText, profileFor, receiveProfileText, removeNorm, setOne, setScope, sliceFor, zoneOf } from './profile'
import type { Zone } from './profile'
import type { MyProfile } from './profile'
import { profileSheetNodes, scopePageNodes, theirProfileBlock, type ProfileViewDeps } from './profile_view'
import { APK_URL, apkPart, currentEnv, isAndroidAgent, isIosAgent, onApkDownload, setUpInstall } from './install'
import { apkHintKind, apkSettingsRow, type ApkHintEnv } from './apk_hint'
import { runsAsInstalledApp } from './standalone_app'
import { DEX_URL, SETTINGS_VIEWS, UiView, wideAllowed } from './desktop_view'
import { createInstallSheets } from './install_sheets'
import { DismissScope, removeDummyContent } from './demo_dismiss'
import { canEndDemoAccount } from './demo_devices'
import { GENERAL_NOTES_MAX, addContextLines, cleanGeneralNotes, contextOf, noteKey, travelsInPack } from './note_fields'
import { CarryPlan, carryPlan, demoContentForLivePhone, dropCarry, dummyIds, freshFromCarry, mergeCarryOver, readCarry } from './demo_to_live'
import type { CarryOver } from './demo_to_live'
import { KeepNotice, dueForTakeDown, guestAsk, guestAsked, guestEnded, guestGranted, guestKept, isKept, keepAccount, keepText, parseKeepText, unkeepAccount } from './account_keep'
import { asksMatchNotes, notesMatchDefault } from './notes_source'
import { focusFor, linesFromTranscript, markDemo, markReviewed, provenanceState, recordedSource, sharedSource, typedSource } from './provenance'
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
import { careForCodes } from './sync_codes'
import { exportEntry, resumeGoogle } from './contacts_sync_view'
import { googleFlagSet, setGoogleConnect } from './google_flag'
import { offerContacts, openServicesImport } from './services_view'
import type { ImportedContact } from '../../crm/src/import/types'
import type { ServicesHooks } from './services_view'
import { mountOnboardingNotice, onboardingCard } from './onboarding_whatsapp_view'
import type { OnboardingHooks } from './onboarding_whatsapp_view'
import { createCurator, curatorHiddenIds } from './curator'
import { addReminder, dismissReminder, drawReminders } from './reminders_inbox'
import { LIMIT_MAX, limitOf, parseLimit, pinnedModeOf, togglePin as togglePersonPin, wholeZone, withTag, collidingLabels } from './membranes_five'
import { connectedPlaces } from './connected_places'
import { resourceList, recentChip } from './resource_list'
import { addPeerItem, peerItems } from './peer_items'
import { pinButton, restList, smallCard, tagFilterChip, zoneTagsRow } from './membranes_five_view'
import { kindKey, visibleVia } from './zone_visibility'
import { addResourceIn, renameResource } from './resource_edit'
import { addZoneTag, removeZoneTag, suggestZoneTags, zoneTagIds } from './zone_tags'
import { communityOf, isArchived, zoneFor } from './trustzones'
import { archivedPeopleView } from './archived_people_view'
import { purgeDue, recentlyDeleted } from './deleted_people'
import { trustZonesGroup, zoneSidebar } from './trustzones_view'
import { ringShown } from './rings_filter'
import { ownProfilePage } from './own_profile_view'
import { ringFilterShown } from './select_tool'
import { ENGAGEMENT_DEFAULT_DAYS, dismissReleases, engagementDays, ensureBaseline, expiringSoon, localDay, noticeDue, parseDays, soonNames, undoAllReleases, undoOffered, undoRelease } from './engagement'
import { createFeedView } from './feed_view'
import { createEventsView } from './events_view'
import { EXT_MODULES, TW_PROFILES, bindTw, createBus, isEnabled, listModules, profileDef, profileOf, twRegistry, type ExtHooks, type ProfileId, type ThreadSummary, type TwCtx } from './ext/registry'
import { createActions } from './actions'
import { defineAppActions, PLACE_TARGET, type Place as AppPlace } from './app_actions'
import { ensureTags } from './import_curate_view'
import { curatePage as curateImportPage } from './services_view'
import { createViewHost } from './ext/view_host'
import { alphaHeading, alphaSub } from './alpha_heading'
import { tagManagerView } from './tag_manager_view'
import { gateScreen } from './screen_gate'
import { appLinkFor, browserOpenEnv, openLocalFirst } from './messenger_links'
import { chatView } from './messenger_combined_view'
import { addInviter, applyHostLink, eventLabel, joinEvent, revealedBy, tagLabel, whenLabel as eventWhen } from './events'
import { decodeEventLink, encodeEventLink, linkOrigin, toBase64Url } from './event_link'
import type { EventBy } from './event_link'
import { acceptEvent, dragPerson } from './drag_payload'
import { eventDropItem } from './event_drop'
import { sendHit } from './org_hits'
import { loadPublic } from './org_public'
import type { LinkedEvent } from './event_link'
import { ImageStore, SHARE_SIDE, shrink } from './image_store'
import { PersistState, persistState } from './storage_persist'
import type { JobTake } from './server_transcription'
import { createPackView } from './pack_view'
import { addToOutbox, transcriptStillComing } from './late_pack'
import { ICONS } from './icons'
import { BRAND_MARK_SVG } from './brand_mark'
import { askWebIcon, recordIcon } from './icons/ask_web'
import { RECORD_TAB_GLYPH, recordTabGlyph } from './record_glyph'
import { PULSE_IDLE_PX, pulseSpreadPx } from './audio_level'
import { type RecStart, recStartFailure, recStartNext, resolveAbout } from './record_start'
import { spareRoomExample } from './ask_examples'
import type { PastFocus } from './past_meetings_view'
import { DEMO_LIFETIME_MS, DEMO_SUFFIX, demoAccountName, demoFragment, demoPersona, handoverFragment, isDemoPeerRef, isDemoPersona, parseDemoFragment, parseHandoverFragment, timeLeft } from './demo_account'
import type { DemoPeerRef, HandoverLink } from './demo_account'
import { askReachOf, askWaitMs, HOPS_DEFAULT, readVia } from './hops'
import { fitOfAsk, queueAsk, togetherAsk } from './together_match'
import { zoneRank } from './search_rank'
import { geoPicker } from './together_location'
import type { Place } from './together_location'
import { fillFromPrefs, liveTogetherPrefs, rememberTogether } from './together_prefs'
import { draftOrPlain, readTogetherRequest } from './together_request'
import { askEndpoint, configured } from './llm_endpoint'
import { aiSettings, bootAi } from './llm_endpoint_view'
import { aiButtonTarget } from './ai_button'
import { agentSettings } from './agent_view'
import { ownChannels } from './channel_readers'
import { readersBlock } from './channel_readers_view'
import { askWebPanel, askWebSettings } from './ask_web_view'
import type { TogetherRequest } from './together_request'
import { answerTitle, cascadeInfoButton, cascadeInfoContent, degreesChooser, degreesPill, onOffSwitch, passOnRow, reachChooser, throughTag } from './hops_view'
import { createWebView, RINGS_SIZE } from './web_view'
import { expanseList } from './expanse'
import { joinFrontDoor, mergeOneJakob, ownFrontDoor, passOnAllowed, personOfPeer, samePersonTarget } from './one_jakob'
import { kindsOf, NOTIFY_KINDS, wantsKind } from './notify_kinds'
import { route as notifyHome, type NotifyHome } from './notify_route'
import type { NotifyKind } from './notify_kinds'
import { pushBundleOf, pushSupported, showNotification, subscribePush, unsubscribePush, workerRegistration } from './push'
import { apkParam, apkSessionVersion, isApkSession, latestApkVersion, newerVersion, rememberApkSession, updateCheckDue } from './apk'
import { createToast, fadeHost, type ToastOpts } from './toast'
import { nativeApp, routeFetchToServer, SERVER_ORIGIN } from './native_app'
import { clearNativeBundle, nativePushAvailable, nativePushPermission, registerNativePush, writeNativeBundle } from './native_push'
// Static, not import(): a lazy import made Rolldown put its namespace helper into this entry's chunk, so the demo pages (solo.ts
// imports walkthrough too) ran this whole app without an #app and stayed blank (live 2026-10-19). test/scan_demo_entries.mjs (CI, after the build) guards it.
import { mountWalkthrough } from './walkthrough'
import { ZOOM_OUT, back as zoomBack, itemRows, press, type ItemSort, type Zoom, type ZoomTab } from './zoom'

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
  /** Wave 24: every chat, newest first (bottom row). */
  Chat = 'chat',
  /** Wave 25: the people list page (search, trust zones), opened from the Web screen with Back. */
  People = 'people',
  /** Wave 32: the Notes outliner (eye menu), a page like People. */
  Notes = 'notes',
  /** Wave 36: Groups I could join or help (eye menu > Other views), a page like People. */
  Groups = 'groups',
  /** Wave 39: an extension module's view (ext/tw_registry.ts views()), `extViewId` names which. */
  Ext = 'ext',
}
/** Wave 39: which extension module view Screen.Ext shows, and the kept element it is mounted in (ext/view_host.ts). */
let extViewId: string | null = null
const extViews = createViewHost(() => twCtx())

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
  /** Wave 24 (calendar): started while I was at this event; the saved notes carry it. One tap on the chip drops it. */
  eventId?: string
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
// Wave 30 (person_share_link.ts): a link made for one person also carries contact channels and the things their zone may see; shown on the start screen, merged only after their tap.
const personShare = pendingConnect ? parsePersonShare(location.hash) : null
// Wave 31 (zone_share_link.ts): the same link made for a whole zone; the box names the zone and says there is more to ask for.
const zoneShare = pendingConnect ? parseZoneShare(location.hash, Date.now()) : null
// Wave 31 (notes_outline.ts): a link may carry an outline note with its provenance; kept on the sender's card after their tap.
const noteShare = pendingConnect ? parseNoteShare(location.hash) : null
// A demo-account link (QR > Demo account on the inviter's phone, 2026-10-06):
// the account name and, optionally, the demo inventory peer, also in the fragment.
const demoLink = pendingConnect ? parseDemoFragment(location.hash) : null
// A link from the Stammbaum (#tree=…&k=…[&family=1], family_tree_link.ts): the key stays in this fragment and in the url built below, on this phone.
const treeLink = pendingConnect ? parseTreeFragment(location.hash) : null
// A hand-over link (?handover=1#k=...): a demo account moves to this phone.
const handover: HandoverLink | null = params.get('handover') === '1' ? parseHandoverFragment(location.hash) : null
// A meeting sent inside TrustWeb (?share=1#k=...&t=...), or riding in a Meet
// code after a meeting (#n=...&k=...&t=...): opened once the app is up (share.ts).
let pendingShare: ShareLink | null = params.get(SHARE_PARAM) === '1' || pendingConnect ? parseShareFragment(location.hash) : null
// An event link (#ev=..., event_link.ts): the join sheet opens once the app has a record; the fragment goes below either way.
let pendingEvent: LinkedEvent | null = decodeEventLink(location.hash)
// An intro link (#intro=..., intro_link.ts): the "Intro request" card opens once the app has a record.
let pendingIntro: IntroLink | null = decodeIntroLink(location.hash)
// A QR mode (qr_modes.ts, wave 27): what the code shares besides the connect; an old code or an unknown mode is a plain connect.
const qrBody = pendingConnect ? decodeModeLink(location.href) : null
// ?install=1 (the website's and the demo's Install button): open the Install sheet once the app is up (install.ts).
// A scheduling link (#book= or #booked=, ext/calendar/scheduling.ts): its sheet opens once the app has a record.
let pendingBook = /[#&]book(ed)?=/.test(location.hash) ? location.hash : ''
const wantInstall = params.get('install') === '1'
// Wave 11 (apk.ts): opened by the Android app, which names its shell version; remembered for this session before the URL is cleaned.
const apkLaunch = apkParam(params)
if (apkLaunch) rememberApkSession(apkLaunch)
// Five-ring prototype (five_rings.ts): ?five_rings=1|0 switches its flag, remembered before the URL is cleaned.
{
  const f = flagFromUrl(location.search)
  if (f !== null) writeFlag(f)
}
/** The app on a home screen: a standalone PWA, this session inside the APK (which runs as a tab until the origin vouches for it), or the iPhone app. */
function installedHere(): boolean {
  return runsAsInstalledApp() || isApkSession() || nativeApp
}
// Wave 27 review: the extension modules read their pairing links from this copy, taken before the clean below.
const bootHash = location.hash
const bootSearch = location.search
// Wave 40: Google's return trip (?code=...) is read from the address as opened; the clean below removes it.
const bootHref = location.href
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
/** Set once the backup card exists (far below); declared here, above the boot-time saves (migration, carry, repair, dev events), so save() can read it from the first call on. */
let autoBackup: BackupView | null = null
// A preview slot (dev.trustweb.one) opens with Jakob's record too (dev_record.ts, 2026-10-19): fetched after boot; when it changed
// what is stored, this tab stops saving and reloads into it.
if (!solo) void seedHostedDevRecord(persona).then((changed) => { if (changed) { superseded = true; location.reload() } })
// A personal preview takes the record another preview shared when it is newer (dev_record_live.ts, 2026-11-07).
if (!solo) void seedLiveDevRecord(persona).then((changed) => { if (changed) { superseded = true; location.reload() } })
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
    const migrated = migrate(state)
    // Wave 6 (N6): a demo account made before had its inviter and his front door as two people; now one (one_jakob.ts).
    const merged = mergeOneJakob(state, S.demoPeerContext)
    // Wave 6 (notes_source.ts): the side-by-side demo phones do not let asks match notes (their content is imaginary); stored once, so it also holds after "Add demo content" changes the default.
    const soloOff = solo && state.asksMatchNotes === undefined
    if (soloOff) state.asksMatchNotes = false
    // Wave 6 (chat.ts): a corrupted `chats` value is repaired, never thrown on.
    if (migrated || merged || soloOff) save()
  }
} catch {
  state = loadState(persona, storeCtx)
}
// Wave 36 ai-subscription: legacy pc24 -> Custom, Jakob's dev record seeds pc24 as Custom, a pending sign-up is polled once.
if (state && !solo) bootAi({ state: st, save, dev: Boolean(devRecordFile()) })
// The field repairs of waves 6b to 7 (connect code, share modes, general notes, profile, agreements) run in the migrate() chain above (schema_version.ts).
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
    if (!solo) pushLiveDevRecord(persona, state)
    mirrorPushBundle(state)
    autoBackup?.changed()
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
let askMode: AskMode = AskMode.Hints
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
let levelFrame = 0
// Recordings kept on this phone with their meetings (audio_store.ts), per persona like the record.
const audioStore = new AudioStore(persona, storeCtx)
// Every take of the current draft, oldest first: a new take never overwrites one.
let takes: Recording[] = []
let recNotice = ''
/** Where a tap on the record circle stands: asking for the microphone, recording, refused (record_start.ts). */
let recStartState: RecStart = 'idle'
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
    ring: p?.ring ?? Ring.Acquaintance, about: AboutKind.Who, extraLines: [], pauses: [], generalNotes: '', plain: false, eventId: state ? eventForDraft(state) : undefined,
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
    queueAsk(askQueue, ask, (a) => fitOfAsk(a.text, st().togetherPrefs, Date.now()) !== null, askOvertaken,
      // Wave 27 sovereign-switch: among fitting asks the asker in the closer zone first (search_rank.ts; matched by name, 0 when unknown).
      (a) => { const who = st().people.find((p) => p.name === a.fromName); return who ? zoneRank(who) : 0 })
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
  undoAllReleases: (): void => { undoAllReleases(st(), Date.now()); save(); render() },
  openPerson: (personId: string): void => personSheet(personId),
}

/**
 * Wave 24b (engagement.ts): ties past their window move one ring outward (card with Undo); at the first check from 12:00 local, once a day,
 * everyone whose window ends within 48 h gets a reminder (reminder switch, system notification while hidden). At open, on return and every 15 min.
 */
function checkEngagement(): void {
  if (!state || solo || state.testOf) return
  const now = Date.now()
  if (state.engagementSince === undefined) { ensureBaseline(state, now); save() }
  // Wave 28 (Jakob 2026-11-01): nothing moves by itself any more; a quiet tie gets a zzz marker on the TrustZones and moves on a tap (zzzAccept).
  checkKeepInTouch(now)
  checkBirthdays(now)
  if (!noticeDue(state, new Date(now))) return
  const soon = expiringSoon(state, now)
  const { names, more } = soonNames(soon)
  // Stamped once the warning was shown; in the Events panel that is when its row is drawn, so a reload before then shows it again.
  const stamp = (): void => { if (state) { state.engagementNoticeDay = localDay(new Date(now)); save() } }
  if (soon.length === 0) stamp()
  else notifyKind('reminder', S.engagementSoonTitle(names, more), S.engagementSoonOpen, () => personSheet(soon[0].id), stamp)
}

/** Wave 36 keep-in-touch: once a day one grouped notice for everyone past their cadence; its button opens the complete view filtered to Overdue. */
function checkKeepInTouch(now: number): void {
  if (!state || !keepNoticeDue(state, new Date(now))) return
  const late = overduePeople(state, now)
  const stamp = (): void => { if (state) { state.keepNoticeDay = localDay(new Date(now)); save() } }
  if (late.length === 0) stamp()
  else notifyKind('reminder', noticeText(late.map((p) => p.name)), S.keepNoticeOpen, () => openComplete(true), stamp)
}

const BIRTHDAY_RETRY_MS = 5_000
let birthdayRetry: ReturnType<typeof setTimeout> | undefined
/** Wave 37 people-fields: once a day, at the first check, an in-app line for birthdays today and this week (notifyBirthdays is the hook a later browser push goes through). */
function checkBirthdays(now: number): void {
  if (!state || !birthdayRemindersOn(state) || !birthdayNoticeDue(state, new Date(now))) return
  // Review: another notice is up (keep in touch, the demo offer): the birthday line waits until the slot is free instead of covering it.
  if (!friendsEl.hidden) { clearTimeout(birthdayRetry); birthdayRetry = setTimeout(() => checkBirthdays(Date.now()), BIRTHDAY_RETRY_MS); return }
  const list = upcoming(state.people, new Date(now), 7)
  state.birthdayNoticeDay = localDay(new Date(now))
  save()
  const shown = notifyBirthdays(list, (text) => showNotice(text, '', [
    el('button', { class: 'btn btn-ghost btn-sm', 'data-birthday-open': '', onclick: () => { hideNotice(); openComplete(false, true) } }, [S.birthdayOpen]),
    el('button', { class: 'notice-dismiss', 'data-birthday-never': '', onclick: () => { hideNotice(); dismissAction(st()); save() } }, [S.birthdayNever]),
    el('small', { class: 'meta' }, [S.birthdayNeverHint]),
  ]))
  if (shown) friendsEl.setAttribute('data-birthday-notice', '') // review: only when the birthday line is what shows
}

/** Wave 37 people-fields (thought_of.ts): the owner wrote to or about this person today; 'active' tells them once a day. */
function thoughtOf(p: Person): void {
  const now = new Date()
  if (!recordThought(p, now)) return
  save()
  if (!p.peerId || !activeLineDue(p, now, true)) return
  void submitText(chatIo(), p.peerId, S.thoughtLine).then((ok) => {
    if (!ok) return
    p.thoughtSentDay = localDay(now)
    st().log.unshift({ id: randomId(8), at: Date.now(), from: p.name, text: S.thoughtLine, outcome: LogOutcome.Shared, peerId: p.peerId })
    save()
  })
}

function dismissCard(card: StackCard): void {
  const s = st()
  const now = Date.now()
  switch (card.kind) {
    case StackCardKind.Message: s.chats = markRead(s.chats ?? NO_CHATS, card.peerId); break
    case StackCardKind.Late: s.lateAnswers = dismissLateAnswer(s.lateAnswers, card.answer.id, now); break
    case StackCardKind.Unmatched: s.unmatchedAsks = dismissUnmatchedAsk(s.unmatchedAsks, card.ask.id, now); break
    case StackCardKind.Away: s.awayAsks = dismissAwayAsk(s.awayAsks, card.ask.id, now); break
    case StackCardKind.Released: dismissReleases(s); break
  }
  save()
}

/** The did of this site's front door when it is this phone's own (one_jakob.ts ownFrontDoor); null: none known. */
function ownDoorDid(): string | null {
  return solo || !state ? null : ownFrontDoor(state, demoPeer)
}

/** Wave 11: every arrival has a kind, each with its own switch (notify_kinds.ts); shown only while the page is hidden. */
function notify(kind: NotifyKind, body: string, offerOff = false): void {
  if (!state || !wantsKind(state, kind) || !document.hidden || typeof Notification === 'undefined') return
  if (Notification.permission === 'granted') { void showNotification(S.appName, body, offerOff ? S.chatNotifOff : undefined); arrivalHome = notifyHome(kind) }
}
/** Wave 27 (notify_route.ts): the screen that owns the last arrival told while the page was hidden; the person lands there on return, unless something is open. */
let arrivalHome: NotifyHome | null = null
const HOME_SCREEN: Record<NotifyHome, Screen> = { chat: Screen.Chat, inventory: Screen.Inventory, web: Screen.Web, events: Screen.Events }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !arrivalHome) return
  const home = HOME_SCREEN[arrivalHome]
  arrivalHome = null
  if (state && !solo && screen !== home && !sheet.classList.contains('on') && !overlay.classList.contains('on')) go(home)
})

/**
 * A task or resource reminder came due (calendar module). Hidden page: a system notification when notifications and the reminder switch
 * are on; page open: a notice with an Open button when the reminder switch is on.
 */
function notifyKind(kind: 'reminder' | 'event', title: string, body: string, onOpen: () => void, onShown?: () => void): boolean {
  if (!state || !kindsOf(state)[kind]) return false
  if (document.hidden) {
    if (!wantsKind(state, kind) || typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
    void showNotification(S.appName, title)
    onShown?.()
    return true
  }
  // Wave 27: a reminder waits in the Events panel (reminders_inbox.ts) while Events is on; an event notice, or Events switched off, stays a notice.
  if (kind === 'reminder' && featureOn(state, 'events')) { addReminder({ title, openLabel: body, onOpen, onShown }); if (screen === Screen.Events) render(); return true }
  showNotice(title, '', [el('button', { class: 'btn btn-ghost btn-sm', 'data-reminder-open': '', onclick: () => { hideNotice(); onOpen() } }, [body])])
  onShown?.()
  return true
}

/** "Turn these off" on the first chat notification: the chat switch under Settings > Notifications goes off, with the way back said. */
function turnChatNotificationsOff(): void {
  const s = st()
  s.notifyKinds = { ...kindsOf(s), chat: false }
  save()
  hideMsgNotice()
  toast(S.chatNotifOffDone)
}
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if ((e.data as { t?: string } | null)?.t === 'chat-off' && state) turnChatNotificationsOff() })

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

installMotionGate(window)
const root = document.getElementById('app') as HTMLElement
const phone = el('div', { class: 'phone' + (solo ? ' embedded' : '') })
const host = el('div', { class: 'screen on' })
const tabs = el('nav', { class: 'tabs', 'aria-label': 'Main' })
const veil = el('div', { class: 'sheet-veil', onclick: () => closeSheet() })
const sheet = el('div', { class: 'sheet', role: 'dialog', inert: true })
/** Wave 25: lists and tools open as a page above the web (Back = browser Back), never as a sheet. */
const pages = createPages(phone)
/** Wave 30: Trust Hub onboarding from a WhatsApp export (empty-web card, import page, running notice). */
/** Wave 39: the one Import page (contacts, resources file, Tana, earlier imports with Undo); every old entry point opens it. */
const importHooks = (): ServicesHooks => ({
  state: st, save, toast, changed: render, pages, actions: appActions,
  // Wave 40: the AI button on an import row looks that person up in the assistant; without the assistant it opens Your AI as before.
  openAi: (row) => { if (row && isEnabled('assistant')) void twRegistry.sync().then(() => twBus.emit('assistant-person', { row })); else openAiButton() },
})
const importEntry = (): HTMLElement => el('button', { class: 'btn btn-ghost', 'data-people-import': '1', onclick: () => openServicesImport(importHooks()) }, [S.svcEntry])
const onboardHooks: OnboardingHooks = { state: st, save, toast: (msg) => toast(msg), changed: () => render(), pages, host: phone, more: () => openServicesImport(importHooks()) }
mountOnboardingNotice(onboardHooks)
// Wave 33: back from Google's sign-in with a code in the address: finish it and show the contacts in the import summary.
void resumeGoogle({ state: st, toast: (msg) => toast(msg), pages }, (contacts) => offerContacts({ state: st, save, toast, changed: render, pages }, contacts), bootHref)
/** Wave 27: Settings > Sovereign Switch (export everything, be forgotten). */
const sovereign = createSovereignView({
  state: st, save, page: (title, body, mark) => pages.open(title, body, mark), toast: (msg) => toast(msg), appUrl: APP_URL,
  peers: () => st().peers.filter((p) => !isBlocked(personOf(st().people, p.id))),
  send: (peer, text) => net.sendText(peer, text),
  importRows: () => (solo ? [] : [importEntry()]),
})
const overlay = el('div', { class: 'overlay cosmic', role: 'alertdialog' })
const toastEl = el('div', { class: 'toast', role: 'status' })
const toastShow = createToast(toastEl, S.toastClose)
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
let statusPill: HTMLElement | null = null
/** Wave 39: the desktop dock (Add a device, See TrustWeb in action); hidden from the main flow once the person has brought in their own data. */
let pageDock: HTMLElement | null = null
let demoSeedSize: number | undefined
/** True once the record holds more own people than the demo seed (see own_data.ts); the demo helpers then live in Settings > Advanced. */
function ownDataBrought(): boolean {
  if (!state) return false
  demoSeedSize ??= demoContentForLivePhone(0, ctx).people.length
  if (state.people.length <= demoSeedSize) return false
  return ownDataImported(state.people, dummyIds(state, ctx).people, demoSeedSize)
}
/** A newer build is deployed (app_update.ts): small banner above the tab bar, only its button takes taps. */
const updateBanner = el('div', { class: 'update-banner', role: 'status', 'aria-live': 'polite', 'data-update-banner': '1', hidden: true }, [
  el('span', {}, [S.updBanner]),
  el('button', { class: 'btn btn-electric btn-sm', 'data-update-reload': '1', onclick: () => void reloadNow() }, [S.updReload]),
])
phone.append(host, tabs, veil, sheet, overlay, toastEl, friendsEl, msgNoticeEl, updateBanner)
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
  pageDock = el('div', { class: 'page-dock' }, runsAsInstalledApp() ? [see] : [add, see])
  root.append(pageDock, demoToggle, ...(DESK_PILL_SHOWN ? [deskToggle] : []))
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

function tabButton(target: string, label: string, name: string, onclick: () => void = () => tabTap(target as Screen)): HTMLElement {
  const b = el('button', { class: 'tab', 'data-go': target, 'aria-label': label, onclick })
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

const viewGlyph: Record<string, string> = { rings: 'web', network: 'network', people: 'stones', complete: 'table', map: 'map', dex: 'curator', compact: 'list', groups: 'users' }
const TAB_ICON: Record<string, string> = { web: 'web', chat: 'chat', events: 'calendar', inventory: 'inventory', feed: 'feed', network: 'web', people: 'web', map: 'web' }

/** Dev only (preview or vite dev): ?askicon=plain shows the "?" glyph without the arcs, to compare (wave 25). */
const askIconVariant = ((typeof __TW_PREVIEW__ !== 'undefined' && __TW_PREVIEW__) || import.meta.env.DEV) && params.get('askicon') === 'plain' ? 'plain' : 'rings'

/** Wave 35: a bar entry's name; a `view:<id>` entry takes its view's name. */
function barName(id: BarId): string {
  const mod = modOfBar(id)
  if (mod) return twRegistry.views().find((v) => v.id === mod)?.title ?? mod
  const view = viewOfBar(id)
  return view ? S.viewNames[view] ?? view : S.barNames[id] ?? S.navRecord
}

/** What a bottom-bar view does when tapped. */
function barOpen(id: BarId): void {
  const view = viewOfBar(id) // wave 35: a view pinned into the row
  if (view) { chooseView(view as ViewKey); return }
  const mod = modOfBar(id) // wave 39: an extension module's view
  if (mod) { openExtView(mod); return }
  switch (id) {
    case 'web': if (webTabAction(webPage) === 'leave-page') { cardExpanded = false; webPage = null } // wave 37: Web from a card lands on the main Web view
      if (state && webDefaultOf(state) !== 'rings') chooseView(webDefaultOf(state) as ViewKey); else tabTap(Screen.Web); break
    case 'events': openEvents(state?.coGuest?.eventId); break
    case 'ask': openQuery(); break
    case 'network': case 'people': case 'map': chooseView(id); break
    case 'record': onRecordTap(); break
    default: tabTap(id as Screen)
  }
}

/** Wave 31: one bottom-bar button. The primary view is the raised round one; a long press or right click takes a view out (with Undo). */
function barButton(id: BarId, primary: boolean): HTMLElement {
  if (id === 'record' && primary) return recordButton()
  const view = viewOfBar(id)
  const name = id === 'web' && state ? webTabLabel(state, S.viewNames) : barName(id) // wave 35: the Web tab carries the pinned default view's name
  const mod = modOfBar(id)
  const b = tabButton(id, id === 'web' ? name : view || mod ? barName(id) : S.tabLabel[id] ?? S.navRecord, id === 'record' ? 'mic' : id === 'ask' ? 'query' : view ? viewGlyph[view] ?? 'web' : mod ? twRegistry.views().find((v) => v.id === mod)?.icon ?? 'users' : TAB_ICON[id], () => tapBar(id))
  b.setAttribute('aria-label', name)
  if (id === 'ask') b.querySelector('svg')!.outerHTML = askWebIcon(askIconVariant)
  if (primary) b.classList.add('tab-primary')
  if (id !== 'record') contextPress(b, () => removeFromBar(id, name))
  return b
}

function barFlags(): BarFlags {
  // HAS_MAP_VIEW is declared further down (this runs at load), so the Map is simply on.
  return { ...tabFlags(), people: !state || state.people.length > 0, map: true, advanced: !!state && isAdvanced(state), mods: twRegistry.views().map((v) => v.id) }
}

function removeFromBar(id: BarId, name: string): void {
  const s = st()
  const before = s.uiBar
  s.uiBar = toggleBar(before, id, barFlags())
  save()
  renderTabs()
  render()
  toast(S.barRemoved(name), { onClick: () => { if (before) s.uiBar = before; else delete s.uiBar; save(); renderTabs(); render() } })
}

function tabFlags(): { events: boolean; feed: boolean; inventory: boolean } {
  return { events: !state || featureOn(state, 'events'), feed: Boolean(state) && feedOn(state as AppState), inventory: !state || featureOn(state, 'inventory') }
}

/** The bar width the phone allows: six buttons and the ⋮; wider screens show all. */
function barMax(): number {
  return window.innerWidth < 600 ? PHONE_MAX : 10
}

function renderTabs(): void {
  // Wave 31: AppState.uiBar (bottom_bar.ts) decides the buttons; the ⋮ sheet holds the rest. Ask your web in the bar replaces its floating button.
  // Wave 37 (co-notes-link): a guest of a co-note link gets the nested shell instead (Web, Chat in the centre, Resources; Events too for an event note).
  const guest = state?.coGuest && state.coNotesOn ? guestShell(Boolean(state.coGuest.eventId)) : null
  const { ids, primary } = guest ? { ids: guest.tabs, primary: guest.primary } : resolveBar(state?.uiBar, barFlags())
  const { shown } = guest ? { shown: ids } : barLayout(ids, primary, barMax())
  const more = el('button', { class: 'bar-more', 'data-bar-more': '', 'aria-label': S.barMore, onclick: barMoreTap }, ['⋮'])
  tabs.toggleAttribute('data-guest-shell', guest !== null)
  tabs.replaceChildren(...shown.map((id) => barButton(id, id === primary)), ...(guest ? [] : [more]))
  tabs.classList.toggle('four', shown.length > 3)
  tabs.classList.toggle('many', shown.length > 5)
  phone.classList.toggle('ask-in-bar', shown.includes('ask'))
  updateChatBadge()
}
renderTabs()

/** Wave 35: ⋮ lists the views that are not in the bar as direct buttons; with none to list it opens the sheet at once. */
function barMoreTap(): void {
  const s = st()
  const { ids, primary } = resolveBar(s.uiBar, barFlags())
  const rest = [...barLayout(ids, primary, barMax()).overflow, ...overflowChoices(ids, s.uiBar?.hidden ?? [], barFlags())]
  if (!rest.length) { barSheet(); return }
  openSheet([
    el('h3', {}, [S.barMoreViews]),
    ...rest.map((id) => el('button', { class: 'btn btn-ghost bar-more-view', 'data-bar-view': id, onclick: () => { closeSheet(); barOpen(id) } }, [barName(id)])),
    el('button', { class: 'linkbtn', 'data-bar-open-settings': '', onclick: barSheet }, [S.barOpenSettings]),
  ])
}

/** Wave 35: "Default view: <name>" under the Web row of the bottom-row sheet; the select changes the view the Web tab opens. */
function webDefaultLine(s: AppState, changed: () => void): HTMLElement {
  const now = webDefaultOf(s)
  const select = el('select', {
    class: 'web-default-select', 'data-web-default': '', 'aria-label': S.webDefaultLabel,
    onchange: (e: Event) => { const v = setWebDefault(s.uiViews, (e.target as HTMLSelectElement).value); if (v) s.uiViews = v; else delete s.uiViews; changed() },
  }, viewMenuEntries({ current: 'rings', hasMap: HAS_MAP_VIEW, pins: undefined }).map((i) => el('option', { value: i.view, ...(i.view === now ? { selected: '' } : {}) }, [S.viewNames[i.view]])))
  return el('div', { class: 'web-default-line' }, [el('span', { class: 'meta' }, [S.webDefaultLabel + ':']), select])
}

/** The ⋮ sheet: the bubble at the left of each view turns it on or off per view, order arrows, "highlight one"; views the phone bar has no room for are marked and open from here. */
function barSheet(): void {
  const s = st()
  const flags = barFlags()
  const redraw = (next: typeof s.uiBar): void => { if (next) s.uiBar = next; else delete s.uiBar; save(); renderTabs(); render(); barSheet() }
  const { ids, primary } = resolveBar(s.uiBar, flags)
  const { overflow } = barLayout(ids, primary, barMax())
  // "Add" turns into a place picker: left or right of each button now in the bar. Feed is switched on first when it was off.
  const addPicker = (id: BarId): HTMLElement => el('select', {
    class: 'bar-add-pos', 'data-bar-add-pos': id, 'aria-label': S.barAddPick(barName(id)),
    onchange: (e: Event) => {
      const [side, ref] = (e.target as HTMLSelectElement).value.split(':') as ['left' | 'right', string]
      const f = id === 'feed' ? { ...flags, feed: true } : flags
      if (id === 'feed' && !flags.feed) s.feed = { ...s.feed, on: true }
      redraw(addBar(s.uiBar, id, ref, side, f))
    },
  }, [el('option', { value: '' }, [S.barAddPlace]), ...ids.flatMap((ref) => (['left', 'right'] as const).map((side) => el('option', { value: `${side}:${ref}` }, [(side === 'left' ? S.barLeftOf : S.barRightOf)(barName(ref))])))])
  const arrow = (id: BarId, dir: -1 | 1): HTMLElement => el('button', {
    class: 'btn btn-ghost btn-sm', 'data-bar-move': `${id}:${dir}`, 'aria-label': dir < 0 ? S.barUp(barName(id)) : S.barDown(barName(id)),
    onclick: () => redraw(moveBar(s.uiBar, id, dir, flags)),
  }, [dir < 0 ? '←' : '→'])
  openSheet([
    el('h3', {}, [S.barSheetTitle]),
    el('p', { class: 'hint' }, [S.barSheetHint]),
    el('h4', { class: 'eyebrow' }, [S.barProfilesTitle]),
    el('div', { class: 'bar-profiles' }, [...PROFILES.map((prof) => {
      const name = S.barProfileNames[prof.id]
      const on = prof.id === activeProfile(s.uiBar, flags)
      // The mini preview: the preset's five glyphs with their real icons, the centre one enlarged.
      return el('button', {
        class: 'bar-profile' + (on ? ' on' : ''), 'data-bar-profile': prof.id, 'aria-label': S.barProfilePick(name), 'aria-pressed': String(on),
        onclick: () => { if (prof.order.includes('feed') && !flags.feed) s.feed = { ...s.feed, on: true }; redraw(applyProfile(s.uiBar, prof.id)) },
      }, [
        el('span', { class: 'bar-profile-prev' }, prof.order.map((id) => {
          const g = el('span', { class: 'bar-glyph' + (id === prof.primary ? ' bar-glyph-primary' : '') })
          g.innerHTML = icon(id === 'record' ? 'mic' : id === 'ask' ? 'query' : TAB_ICON[id])
          return g
        })),
        el('b', {}, [name]),
      ])
    }), (() => {
      // One empty dashed card: starts a custom bar from the bar as it is now and jumps to the per-view rows.
      const on = activeProfile(s.uiBar, flags) === 'custom'
      return el('button', {
        class: 'bar-profile bar-profile-custom' + (on ? ' on' : ''), 'data-bar-profile': 'custom', 'aria-label': S.barProfilePick(S.barProfileNames.custom), 'aria-pressed': String(on),
        onclick: () => {
          s.uiBar = customFrom(s.uiBar, ids, primary); save(); renderTabs(); render(); barSheet()
          document.querySelector<HTMLElement>('[data-bar-row]')?.scrollIntoView({ block: 'start' })
        },
      }, [el('span', { class: 'bar-profile-prev bar-profile-plus' }, ['+']), el('b', {}, [S.barProfileNames.custom])])
    })()]),
    // The Feed is an opt-in feature: it is always offered here, and ticking it switches the feature on.
    ...barChoices(s.uiBar, { ...flags, feed: true }).map((c) => (c.id === 'feed' && !flags.feed ? { ...c, on: false } : c)).flatMap(({ id, on }) => [el('div', { class: 'bar-opt-row', 'data-bar-row': id }, [
      el('label', { class: 'radio bar-bubble' + (on ? ' on' : ''), 'data-bar-opt': id }, [
        el('input', { type: 'checkbox', class: 'bar-hide-input', 'aria-label': barName(id), ...(on ? { checked: '' } : {}), onchange: () => {
          if (id === 'feed' && !flags.feed) { s.feed = { ...s.feed, on: true }; redraw(resolveBar(s.uiBar, { ...flags, feed: true }).ids.includes('feed') ? s.uiBar : toggleBar(s.uiBar, id, { ...flags, feed: true })); return }
          redraw(toggleBar(s.uiBar, id, flags))
        } }),
        el('b', {}, [barName(id)]),
      ]),
      on ? el('span', { class: 'bar-opt-acts' }, [arrow(id, -1), arrow(id, 1)]) : el('button', { class: 'linkbtn', 'data-bar-add': id, onclick: (e: Event) => (e.currentTarget as HTMLElement).replaceWith(addPicker(id)) }, [S.barAdd]),
      overflow.includes(id) ? el('button', { class: 'linkbtn', 'data-bar-open': id, onclick: () => { closeSheet(); barOpen(id) } }, [S.barOpen]) : null,
    ]), ...(id === 'web' ? [webDefaultLine(s, () => { save(); renderTabs(); render(); barSheet() })] : [])]),
    el('h4', { class: 'eyebrow' }, [S.barHighlight]),
    el('p', { class: 'meta' }, [S.barHighlightHint]),
    ...(['none', ...ids] as (BarId | 'none')[]).map((id) => el('label', { class: 'radio bar-bubble' + ((id === 'none' ? primary === null : id === primary) ? ' on' : ''), 'data-bar-primary': id }, [
      el('input', { type: 'radio', class: 'bar-hide-input', name: 'bar-primary', ...((id === 'none' ? primary === null : id === primary) ? { checked: '' } : {}), 'aria-label': S.barHighlightPick(id === 'none' ? S.barHighlightNone : barName(id)), onchange: () => redraw(setPrimary(s.uiBar, id, flags)) }),
      el('b', {}, [id === 'none' ? S.barHighlightNone : barName(id)]),
    ])),
    overflow.length ? el('p', { class: 'meta' }, [S.barOverflow + ': ' + overflow.map((id) => barName(id)).join(', ')]) : null,
  ])
}

/** The unread count on the Chat tab: filled in the tab's own colour, never red. */
function updateChatBadge(): void {
  const chat = tabs.querySelector<HTMLElement>('[data-go="chat"]')
  if (!chat) return
  const n = state && !state.chatsHidden ? unreadTotal(state.chats ?? {}) : 0
  chat.querySelector('.tab-badge')?.remove()
  if (n > 0) chat.append(el('span', { class: 'tab-badge', role: 'img', 'aria-label': S.chatTabUnread(n) }, [el('b', {}, [n > 99 ? '99+' : String(n)])]))
}

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
    case Screen.Chat:
    case Screen.People:
    case Screen.Notes:
    case Screen.Groups:
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
  // On the Record screen, mid-take: the round tab pauses and resumes like the circle (Jakob 2026-11-01).
  if (recorder.live && screen === recordScreen()) { togglePause(); return }
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

/** Wave 24b/25: the zoom level of the Resources tab (Membranes no longer zooms). Zooming in pushes one history entry, so Back zooms out (popstate below). */
let zoom: Zoom = ZOOM_OUT
let resQuery = ''
let resSort: ItemSort = 'new'
const zoomedIn = (): boolean => zoom.inventory

/** A tab tap: the second press on the active Resources tab zooms in; everything else goes there as before. */
function tabTap(target: Screen): void {
  const next = press(target, screen)
  if (target !== screen || zoomedIn() || next === ZOOM_OUT) { go(target); return }
  zoom = next
  history.pushState({ twZoom: target }, '')
  render()
}
window.addEventListener('popstate', (e) => { if (peoplePage && ((t) => t === 'people' || typeof t === 'number')((e.state as { twPage?: unknown } | null)?.twPage)) return; if (peoplePage) { peoplePage = false; go(pageBack) } else if (zoomedIn() && !(e.state as { twZoom?: string } | null)?.twZoom) { zoom = zoomBack(); render() } })

/** Wave 25: the people list is a page, not a sheet; opening it pushes one history entry so Back (browser, phone or the ‹) returns to the Web. */
let peoplePage = false
/** Where Back from the People / Notes page lands. */
let pageBack = Screen.Web
/** Wave 30: the header magnifier's filter field under the People header; it filters the list as you type, Escape clears and closes it. */
let peopleSearchOpen = false
function openPeople(query = '', complete = false, overdue = false, birthdays = false): void {
  completeMode = complete
  if (complete) resetComplete('', overdue, false, birthdays)
  resetPeopleList(query)
  peopleSearchOpen = query !== ''
  peoplePage = true
  pageBack = Screen.Web
  history.pushState({ twPage: 'people' }, '')
  go(Screen.People)
}
/** Wave 36 complete-view: the People page showing everyone as a table (the 'complete' view). */
let completeMode = false
function openComplete(overdue = false, birthdays = false): void {
  openPeople('', true, overdue, birthdays)
}
/** The header search field feeds whichever list the People page shows. */
const peopleSearchQuery = (): string => (completeMode ? completeQuery() : peopleQuery())
const setPeopleSearch = (q: string): void => (completeMode ? setCompleteQuery(q) : setPeopleQuery(q))
/** Wave 32: the Notes outliner opens as a page the same way; wave 33: it hangs under Resources, so Back returns there. */
function openNotes(): void {
  peoplePage = true
  pageBack = Screen.Inventory
  history.pushState({ twPage: 'people' }, '')
  go(Screen.Notes)
}
/** Wave 36: Groups I could join or help opens as a page like People, Back returns to the Web. */
function openGroups(): void {
  peoplePage = true
  pageBack = Screen.Web
  history.pushState({ twPage: 'people' }, '')
  go(Screen.Groups)
}
function screenGroups(): Node[] {
  return [
    header(S.groups.heading, { back: () => history.back() }),
    el('div', { class: 'scroll pad' }, [groupsView({ st, save, askIntro: (target) => { setIntroTarget(target); askMode = AskMode.Intros; queryOpen = true; go(Screen.Web) } })]),
  ]
}
/** Wave 39: the extension module view `extViewId`; gone (module off) = the Web. */
function screenExt(): Node[] {
  const v = twRegistry.views().find((x) => x.id === extViewId)
  if (!v) { screen = Screen.Web; extViews.release(); return screenWeb() }
  return [header(v.title), extViews.show(v)]
}
function openExtView(id: string): void {
  extViewId = id
  eyeOpen = false
  go(Screen.Ext)
}
function screenNotes(): Node[] {
  const s = st()
  return [
    header(S.viewNames.notes, { back: () => history.back() }),
    el('div', { class: 'scroll pad' }, [notesOutlineView({ people: () => st().people, me: { did: s.me.id, name: s.me.displayName }, save }), ...(coNotes?.notesSection?.() ?? [])]),
  ]
}
/** Wave 30: what a People / Map row may do to the record (inline name edit, archive, drag to another zone); a tap on the toast undoes. */
const rowEdit: RowEdit = { save, place: (id, ring) => placePerson(id, ring, true), toast: (msg, undo) => toast(msg, { onClick: undo }),
  tagZones: (rings, name) => {
    const rec = st()
    const before = rec.zoneTags
    const beforeTags = loadColourTags()
    let tags: readonly ColourTag[] = beforeTags
    for (const ring of rings) { const out = addZoneTag(rec, tags, ring, name, Date.now()); tags = out.tags }
    if (tags !== beforeTags) saveColourTags([...tags])
    save()
    return () => { rec.zoneTags = before; saveColourTags(beforeTags); save() }
  } }

function peopleSearchField(): HTMLElement {
  const input = el('input', {
    class: 'field people-search', type: 'search', placeholder: S.peopleSearchPh, 'aria-label': S.viewSearchAria, 'data-people-search': '', value: peopleSearchQuery(),
    oninput: (e: Event) => setPeopleSearch((e.target as HTMLInputElement).value),
    onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Escape') { peopleSearchOpen = false; setPeopleSearch(''); render() } },
  })
  setTimeout(() => input.focus(), 0)
  return input
}
function screenPeople(): Node[] {
  return [
    header(completeMode ? S.viewNames.complete : S.peopleTitle, { back: () => history.back() }),
    ...(peopleSearchOpen ? [peopleSearchField()] : []),
    el('div', { class: 'scroll pad' }, [
      completeMode
        ? completeView({ state: st, save, open: openCardPage, place: (id, ring) => placePerson(id, ring, true), toast: (msg, undo) => toast(msg, { onClick: undo }), tags: loadColourTags, saveTags: (t) => saveColourTags([...t]), focusSearch: () => { peopleSearchOpen = true; render() } })
        : peopleListBody(st, openCardPage, addPersonSheet, undefined, rowEdit),
    ]),
  ]
}

/** The glyph next to the heading: zoomed out it zooms in, zoomed in it is the second way out (Back is the first). */
function zoomGlyph(tab: ZoomTab): HTMLElement {
  const on = zoom[tab]
  const b = iconButton('zoom', on ? S.zoomOutAria : S.zoomInAria, () => (on ? history.back() : tabTap(tab as Screen)), 'zoom-glyph' + (on ? ' on' : ''))
  b.setAttribute('aria-pressed', String(on))
  b.dataset.zoomGlyph = tab
  return b
}

/** Wave 39 review: which switchable parts are on now (screen_gate.ts); a part that is off never shows, however it is reached. */
function shownScreen(target: Screen): Screen {
  if (!state) return target
  return gateScreen(target, { events: featureOn(state, 'events'), inventory: featureOn(state, 'inventory'), feed: feedOn(state), resources: isEnabled('resources') }) as Screen
}

function go(to: Screen): void {
  const s = shownScreen(to)
  const onPage = (x: Screen): boolean => x === Screen.People || x === Screen.Notes || x === Screen.Groups
  if (!onPage(s) && peoplePage) { peoplePage = false; history.back() }
  // The people page sits on top of a zoomed Web: going there, and Back from it to the Web, keep the zoom.
  if (s !== screen && zoomedIn() && !onPage(s) && !(onPage(screen) && s === Screen.Web)) { zoom = zoomBack(); history.back() }
  // Coming to Record from Inventory means "what", from Web "who" (owner
  // 2026-10-06), whichever of Record or Meeting the tap opens; only while
  // nothing has been named or recorded yet.
  if ((s === Screen.Record || s === Screen.Meeting) && !draftInProgress() && !draft.name.trim()) {
    if (screen === Screen.Inventory) draft.about = AboutKind.What
    else if (screen === Screen.Web) draft.about = AboutKind.Who
  }
  // The past-meeting search belongs to Record and Meeting; leaving them closes it.
  if (s !== Screen.Record && s !== Screen.Meeting) pastSearchOpen = false
  if (s !== Screen.Web) web.resetZoom()
  if (s !== Screen.Inventory) { invOnly = null; invMatches = false }
  screen = s
  // Wave 6h/6i: the cards belong to the Web screen (card_stack.ts); render() draws them there.
  closeSheet()
  render()
}

/** Wave 37: the logo family's one-ring mark: top-left of every header that has no Back button, and the start screens' logo. */
function brandMark(cls = 'brand-mark'): HTMLElement {
  const m = el('span', { class: cls })
  m.dataset.brandMark = ''
  m.innerHTML = BRAND_MARK_SVG
  return m
}

/**
 * Every header: title left; right, the screen's own button and then the
 * QR button that opens Meet (with a tiny relay-status dot on it). While a
 * take is open the QR gives way to the "Recording" pill, on every screen.
 */
function header(title: string, opts: { back?: () => void; glyph?: Node | null; right?: Node | null; after?: Node | null; qr?: boolean; pill?: boolean; more?: boolean } = {}): HTMLElement {
  statusPill = el('button', { class: 'status-pill' })
  // Record and Meeting show their own recording state, so the QR stays put there (owner 2026-10-06).
  statusPill.dataset.pill = opts.pill === false ? '0' : '1'
  const qr = withHint(statusPill, HintId.Qr)
  updateStatusPill(opts.qr !== false)
  return el('div', { class: 'hdr' }, [
    el('div', { class: 'hdr-left' }, [
      opts.back ? el('button', { class: 'back', 'aria-label': S.back, onclick: opts.back }, ['‹']) : brandMark(),
      el('h2', {}, [title]),
      opts.glyph ?? null,
    ]),
    el('div', { class: 'hdr-right' }, [opts.right ?? null, qr, opts.more ? moreButton() : opts.after ?? null]),
  ])
}

/** Wave 27: every main screen carries the settings gear in its header (Web and Resources draw their own). */
function mountSettingsGear(): void {
  if (!showsSettingsGear(screen) || host.querySelector(`.hdr [aria-label="${S.invSettings}"]`)) return
  const right = host.querySelector('.hdr .hdr-right')
  if (!right) return
  const gear = iconButton('settings', S.invSettings, settingsSheet)
  gear.dataset.settingsGear = '1'
  right.insertBefore(gear, right.querySelector('[data-chat-dots]'))
}

/** Wave 39: the AI button, a sparkle, at the far right of every header (after the settings gear). Same behaviour as in wave 37 (openAiButton). */
function mountAiButton(): void {
  if (!isEnabled('ai-button')) return   // wave 39 review: the Extensions switch "AI button" (and the profiles) decide
  const right = host.querySelector('.hdr .hdr-right')
  if (!right || right.querySelector('[data-ai-button]')) return
  const ai = iconButton('sparkle', S.aiButton, openAiButton, 'ai-btn')
  ai.setAttribute('data-ai-button', '')
  right.append(ai)
}

/** Wave 28: what the QR button shows for what is on screen: an open event, the tag the web is filtered to, else the connect code (Meet). */
function screenQr(plain = false): void {
  const ev = screen === Screen.Events ? eventsView.current() : undefined
  const tag = screen === Screen.Web && !webPage ? tagFilter : null
  switch (qrTarget({ eventOpen: !!ev, tag })) {
    case 'event': if (ev) eventQr(ev, plain); break
    case 'tag': if (tag) tagQr(tag, plain); break
    default: openMeet(screen === Screen.Meet ? meetFrom : screen)
  }
}

function eventQr(ev: TwEvent, plain = false): void {
  // E3: every event link says of me only what that event's name reveal allows (events.ts revealedBy).
  void qrPage((link) => ({ kind: 'event', link, eventLink: encodeEventLink(ev, linkOrigin(location.origin), 'peer', revealedBy(eventsBy(), ev)) }), plain)
}

/** The tag's code carries the tag and the public usernames of the people who carry it (never those who asked to be asked first). */
function tagQr(tag: string, plain = false): void {
  const people = withTag(st().people, tag).filter((p) => p.publicUsername && parseIntroducePermission(p.introducePermission) !== 'ask-first').map((p) => p.publicUsername ?? '')
  void qrPage((link) => ({ kind: 'community', link, tag: loadColourTags().find((x) => x.id === tag)?.label ?? tag, people }), plain)
}

/** One search button for every view: the Web's and Resources' field opens in place, Chat focuses its field, Events shows the list with its filter. */
function headerSearch(): void {
  if (screen === Screen.Web) { webSearchOpen = !webSearchOpen; render() }
  else if (screen === Screen.Chat) document.querySelector<HTMLInputElement>('[data-chat-search]')?.focus()
  else if (screen === Screen.People) { peopleSearchOpen = !peopleSearchOpen; if (!peopleSearchOpen) setPeopleSearch(''); render() }
  else if (screen === Screen.Events) { eventsView.showList(); window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-event-filter]')?.focus(), 0) }
  else { invSearchOpen = !invSearchOpen; if (!invSearchOpen) invQuery = ''; render() }
}

/** Do Not Disturb: the Android stop sign; pressed = no new chats shown. */
function dndButton(): HTMLElement {
  const s = st()
  const dnd = iconButton('dnd', S.chatDnd, () => { s.chatsHidden = !s.chatsHidden; if (s.chatsHidden) s.chatsHiddenAt = Date.now(); else delete s.chatsHiddenAt; save(); render() }, 'chat-dnd' + (s.chatsHidden ? ' on' : ''))
  dnd.setAttribute('data-dnd', '')
  dnd.setAttribute('aria-pressed', String(!!s.chatsHidden))
  return dnd
}

/** Opens Settings on the Advanced part of the group of the screen it is pressed on. */
function openAdvancedSettings(): void {
  try { localStorage.setItem(`trustweb.ui.settings.${advancedKeyOf(sectionOfScreen(screen))}`, '1') } catch { /* not remembered */ }
  settingsSheet()
}

/** Wave 37: the Web header's AI button: Ask with an endpoint, else Settings > Advanced > Your AI at the plan choice. */
function openAiButton(): void {
  // Wave 40 ai-edit-chat: with the assistant switched on, the sparkle opens its chat (which leads to the plans when no AI is set up).
  if (isEnabled('assistant')) { void twRegistry.sync().then(() => twBus.emit('assistant-open')); return }
  const to = aiButtonTarget(configured(st().advanced?.ai))
  if (to.kind === 'ask') { openQuery(); return }
  openSettingsAt(to.anchor)
}

/** Opens Settings at that element: its groups and sections unfold and it scrolls into view (Your AI, Variations, Extensions, Theme). */
function openSettingsAt(anchor: string): void {
  try { localStorage.setItem('trustweb.ui.settings.advanced', '1') } catch { /* not remembered */ }
  settingsSheet()
  const at = sheet.querySelector<HTMLElement>(anchor)
  if (at instanceof HTMLDetailsElement) at.open = true
  for (let d = at?.closest('details'); d; d = d.parentElement?.closest('details')) { d.open = true; if (d.dataset.settingsGroup) settingsOpen.add(d.dataset.settingsGroup) }
  at?.scrollIntoView({ block: 'start' })
}

const PIN_ACTIONS: Record<HeaderPin, { icon: string; run: () => void }> = {
  dnd: { icon: 'dnd', run: () => undefined },
  advanced: { icon: 'more', run: openAdvancedSettings },
  'qr-only': { icon: 'qr', run: () => screenQr(true) },
  select: { icon: 'select', run: () => undefined },
}

/** Wave 28: the header of Web, Chat, Events and Resources in one order, right to left: settings, the QR, the pinned buttons (Do Not Disturb on by default), the views, search. */
function mountHeaderControls(): void {
  const order = headerControls(screen)
  const right = host.querySelector('.hdr .hdr-right')
  if (!order || !right || (screen === Screen.Web && webPage)) return
  const qr = statusPill && right.contains(statusPill) ? (statusPill.closest('.hdr-right > *') ?? statusPill) : null
  const gear = iconButton('settings', S.invSettings, settingsSheet)
  gear.dataset.settingsGear = '1'
  const find = iconButton('search', S.headerSearchAria, headerSearch, 'web-search-btn')
  find.setAttribute('aria-expanded', String(screen === Screen.Web ? webSearchOpen : screen === Screen.People ? peopleSearchOpen : invSearchOpen && screen === Screen.Inventory))
  const views: Node = screen === Screen.Web ? viewControls(webViewNow)
    : screen === Screen.People ? viewControls(completeMode ? 'complete' : 'people')
    : iconButton('eye', S.viewMenuAria, () => { eyeOpen = !eyeOpen; render() }, 'view-menu-btn')
  // The select tool belongs to the Web's rings view only.
  const pinIds = headerPins(st().uiPins?.header).filter((id) => id !== 'select' || (screen === Screen.Web && webViewNow === 'rings' && !webPage))
  const pins = pinIds.map((id) => {
    const b = id === 'dnd' ? dndButton() : id === 'select' ? selectToolButton('hdr-pin') : iconButton(PIN_ACTIONS[id].icon, S.headerPinNames[id], PIN_ACTIONS[id].run, 'hdr-pin')
    b.setAttribute('data-header-pin', id)
    return b
  })
  const dots = screen === Screen.Chat ? right.querySelector('[data-chat-dots]') : null // the combined chat view's source menu button (messenger_combined_view.ts) rides with the views
  const chatSwitch = screen === Screen.Chat ? right.querySelector('[data-chat-switch]') : null // wave 29: the messenger switch takes the eye's slot
  const parts: Record<string, (Node | null)[]> = { search: [find], views: [views, dots], switch: [chatSwitch], pins, qr: [qr], settings: [gear] }
  right.replaceChildren(...order.flatMap((c) => parts[c]).filter((n): n is Node => n !== null))
  const drop = screen === Screen.Events || screen === Screen.Inventory || screen === Screen.Notes ? screenViewDrop() : screen === Screen.People ? viewDrop(completeMode ? 'complete' : 'people') : null
  if (drop) host.querySelector('.hdr')?.after(drop)
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
    el('button', { class: 'btn btn-ghost btn-sm', 'data-hint-dismiss': id, 'aria-label': S.hintDismiss, title: S.hintDismiss, onclick: () => { hideNotice(); setHintHidden(id, true); render() } }, ['×']),
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
  p.onclick = (): void => screenQr()
}

function render(): void {
  screen = shownScreen(screen)
  const showTabs = screen !== Screen.Start
  tabs.style.display = showTabs ? 'flex' : 'none'
  tabs.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => {
    const target = b.getAttribute('data-go')
    const on = target === screen
      || (target === Screen.Record && (screen === Screen.Meeting || screen === Screen.Review || screen === Screen.Place))
      || (target === Screen.Web && (screen === Screen.StillTrue || screen === Screen.People || screen === Screen.Groups))
      || (target === Screen.Inventory && screen === Screen.Notes)
      || (screen === Screen.Ext && target === `mod:${extViewId}`)
    b.classList.toggle('on', on)
  })
  tabs.querySelector('.tab-record')?.classList.toggle('live', recorder.live && !recorder.paused)
  const recTab = tabs.querySelector<HTMLElement>('.tab-record')
  const { glyph: recGlyph, pulse: recPulse } = recordTabGlyph(RECORD_TAB_GLYPH, { live: recorder.live, solo: draft.mode === RecordMode.Solo, onRecord: screen === Screen.Record })
  recTab?.classList.toggle('pulse', recPulse)
  if (recTab && recTab.dataset.glyph !== recGlyph) {
    recTab.dataset.glyph = recGlyph
    recTab.querySelector('svg')?.remove()
    recTab.insertAdjacentHTML('afterbegin', recGlyph === 'solo' ? recordIcon() : icon(recGlyph === 'waves' ? 'solo' : 'mic'))
  }
  updateChatBadge()
  if (screen !== Screen.Ext) extViews.release()
  host.className = 'screen on ' + screen + (screen === Screen.Web && queryOpen ? ' querying' : '')
  const frame = screen === Screen.Start ? null : cal?.frame?.()
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
      case Screen.Events: { const b = cal && eventsView.atList() ? cal.body() : eventsView.body(); return [...b.slice(0, 1), ...reminderRows(), ...b.slice(1)] }
      case Screen.Chat: return screenChat()
      case Screen.People: return screenPeople()
      case Screen.Notes: return screenNotes()
      case Screen.Groups: return screenGroups()
      case Screen.Ext: return screenExt()
    }
  })()
  const kept = screen === Screen.Ext ? (body[body.length - 1] as Element) : null
  // Wave 39: a mounted module view stays in place (moving it would reload any frame inside it); only what surrounds it is redrawn.
  if (kept && kept.parentNode === host) { for (const n of [...host.childNodes]) if (n !== kept) n.remove(); kept.before(...(frame ? [frame] : []), ...body.slice(0, -1)) }
  else host.replaceChildren(...(frame ? [frame] : []), ...body)
  mountHeaderControls()
  mountSettingsGear()
  mountAiButton()
  if (screen === Screen.Web) { drawCardStack(); requestAnimationFrame(fitRings) }
  updateDemoToggle()
  applyLayout()
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
  pages.closeAll()
  const wasDesk = deskOpen()
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
const friendsFade = fadeHost(friendsEl, () => { friendsEl.hidden = true })
function hideNotice(): void { friendsFade.close() }
/** A small card under the header: non-blocking, only its own buttons take taps. */
function showNotice(title: string, body: string, actions: HTMLElement[], autoHideMs?: number): void {
  friendsEl.classList.remove('stack', 'line', 'tap-close')
  friendsEl.removeAttribute('data-birthday-notice') // review: the birthday line marks the box only while it shows
  friendsEl.onclick = null
  friendsEl.replaceChildren(
    el('b', {}, [title]),
    el('span', {}, [body]),
    el('div', { class: 'notice-actions' }, actions),
    friendsFade.x(S.toastClose),
  )
  friendsEl.hidden = false
  friendsFade.start(autoHideMs)
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
 * Wave 11: the installed app (APK or home-screen PWA) asks whether to turn notifications on; wave 31 (features.ts): only when a major
 * new feature shipped since the last time, as one small line. The browser's permission prompt follows the tap (the TWA relays it to
 * Android's own dialog). Not in a browser tab: there Settings > Notifications is the place.
 */
function offerNotifications(): void {
  const s = state
  const latest = latestFeature(FEATURES)
  if (!s || solo || !latest || s.notificationsOn || !shouldOfferNotifications(notifSeenOf(s), FEATURES) || !installedHere() || (typeof Notification === 'undefined' && !nativePushAvailable())) return
  if (!nativeApp && Notification.permission === 'denied') { s.notifOffered = true; s.notifFeatureSeen = latest.version; save(); return }
  const answer = async (yes: boolean): Promise<void> => {
    st().notifOffered = true
    st().notifFeatureSeen = latest.version
    save()
    hideNotice()
    if (!yes) return
    if (!(await notificationPermission())) { toast(S.notifBlocked); return }
    st().notificationsOn = true
    save()
    await refreshPush()
    toast(S.notifOnTitle)
  }
  showNotice(S.notifOfferTitle, '', [
    el('button', { class: 'notice-dismiss', 'data-notif-offer': 'yes', onclick: () => void answer(true) }, [S.notifOfferYes]),
    el('button', { class: 'notice-dismiss', 'data-notif-offer': 'no', onclick: () => void answer(false) }, [S.notifOfferNo]),
  ])
  friendsEl.classList.add('line')
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
  const own = ownDataBrought()
  if (pageDock) pageDock.hidden = own
  demoToggle.hidden = !state || solo || Boolean(state.testOf) || window.top !== window || runsAsInstalledApp() || own
  if (state) demoToggle.textContent = demoShown(state) ? S.demoHide : S.demoAdd
  updateDeskToggle()
}

const wideTab = (): boolean => window.matchMedia('(min-width: 900px)').matches
/** Wave 25: the Curator's whole-window face needs the responsive layout on a wide tab; TrustWeb mobile keeps it in the phone frame. */
const currentLayout = (): Layout => {
  let stored: string | null = null
  try { stored = window.localStorage.getItem(LAYOUT_KEY) } catch { /* storage blocked: the default */ }
  return pickLayout(stored, isPhone(window.matchMedia('(pointer: coarse)').matches, window.innerWidth))
}
const storedDesktop = (): string | null => (currentLayout() === 'mobile' ? 'phone' : null)
const deskOpen = (): boolean => sheet.classList.contains('on') && sheet.classList.contains('desk-wide') && sheet.dataset.kind === 'curator'

let curatorFace: 'desk' | 'classic' = 'classic'
/** The Curator sheet takes the whole window only on the Desk face AND while the device does not hold the phone version. */
function applyDeskWide(): void {
  sheet.classList.toggle('desk-wide', curatorFace === 'desk' && wideAllowed(storedDesktop(), wideTab(), solo, runsAsInstalledApp()))
  updateDeskToggle()
}

function updateDeskToggle(): void {
  deskToggle.hidden = !DESK_PILL_SHOWN || demoToggle.hidden || !wideTab()
  deskToggle.textContent = deskOpen() ? S.views.mobile : S.views.trustweb
}

/** Wave 27: Dex, Contacts (wide) and Contacts compact open as a page with Back, no longer as a sheet over the web (the sheet code is archived in DEVLOG/wave27/archive/views-eye). */
function openDeskSheet(variant?: UiView): void {
  closeSheet()
  if (screen !== Screen.Web) go(Screen.Web)
  openWebPage({ kind: 'curator', variant })
  if (variant === UiView.Classic) curator.openClassic(); else curator.openDesk(variant)
}

// Escape closes an open sheet, except while typing in a field inside it (the Curator is a shadow root: read the composed path).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !sheet.classList.contains('on')) return
  const path = e.composedPath()
  const typing = path.some((n) => n instanceof HTMLElement && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)))
  if (!typing && !document.querySelector('.wt-modal')) closeSheet()
})

function showPhoneVersion(): void {
  setLayout('mobile')
  go(Screen.Web)
}

/** Wave 25: the frame follows the stored layout (TrustWeb fills the window, TrustWeb mobile keeps the phone frame); stored on this device only. */
function applyLayout(): void {
  phone.classList.toggle('fluid', !solo && currentLayout() === 'trustweb')
  applyDeskWide()
}

function setLayout(l: Layout): void {
  try { window.localStorage.setItem(LAYOUT_KEY, l) } catch { /* not remembered */ }
  applyLayout()
}

/** Wave 39: Settings > General > Theme, next to the view picker: the look of the app (Default, Sleek, Dex-like); light or dark stays under Advanced. */
function themeRow(): HTMLElement {
  const now = readLook(localStorage)
  return el('div', { class: 'theme-row', 'data-theme-row': '' }, [
    el('b', {}, [S.themeTitle]),
    el('div', { class: 'look-pick', role: 'radiogroup', 'aria-label': S.themeTitle }, LOOKS.map((l: Look) => el('button', {
      class: 'radio' + (now === l ? ' on' : ''), role: 'radio', 'aria-checked': String(now === l), 'data-look-choice': l,
      onclick: () => appActions.do('set-look', { look: l }),
    }, [el('b', {}, [S.themeLooks[l]]), el('small', {}, [S.themeLookHints[l]])]))),
  ])
}

/** Wave 19 (Jakob 2026-10-23): the phone's Settings > View row. This sheet shows only in the TrustWeb view; Dex and Classic lead back to the Curator. */
function viewRow(): HTMLElement {
  // Wave 39: only Dex and TrustWeb are offered here; Contacts and Contacts (wide) stay in the eye menu.
  const items = SETTINGS_VIEWS.map((v) => el('button', {
    role: 'menuitemradio', 'aria-checked': String(v === UiView.TrustWeb), 'data-view': v,
    ...(v === UiView.Dex ? { title: S.views.dexAbout, 'aria-describedby': 'view-dex-info' } : {}),
    onclick: () => { if (v === UiView.Dex) showDesktopVersion(v); else toggle(false) },
  }, [S.views[v]]))
  const menu = el('div', { class: 'view-menu', role: 'menu', 'aria-label': S.views.pickAria, hidden: true }, [
    ...items,
    el('p', { class: 'meta view-dex-info', id: 'view-dex-info', 'data-dex-info': '' }, [el('a', { href: DEX_URL, target: '_blank', rel: 'noopener' }, [S.views.dexInfo])]),
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
  if (treeLink?.family) applyFamily(person)
  if (personShare?.contact) mergeContact(person, personShare.contact, Date.now())
  if (noteShare) addReceivedNote(person, noteShare)
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
  if (treeLink) {
    const url = treeUrl(treeLink)
    showNotice(S.treeCardTitle(peer.displayName), S.treeCardBody, [el('a', { class: 'btn btn-electric btn-sm', href: url, target: '_blank', rel: 'noopener noreferrer', 'data-tree-link': '1', onclick: hideNotice }, [S.treeCardOpen])])
  }
  if (qrBody?.kind === 'person' && qrBody.username) toast(S.qrScanUsername(peer.displayName, qrBody.username))
  else if (qrBody?.kind === 'tag') toast(S.qrScanTag(qrBody.tag))
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
    void net.start().then(announceLink).then(() => refreshPush()).then(pollNotesRelay)
    if (invite && !solo && !demo) offerPendingConnect()
    else void completePendingConnect()
    coNotes?.start?.()
    maybeOpenPendingShare()
    maybeOpenPendingEvent()
    maybeOpenPendingIntro()
    maybeOpenPendingBook()
  }
  name.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') submit() })
  return [el('div', { class: 'start' }, [
    brandMark('logo logo-mark'),
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
            noteShare ? el('p', { class: 'meta', 'data-note-share-in': '' }, [S.noteShareIn(inviter, noteShare.title)]) : null,
            zoneShare || personShare ? personShareBox(inviter, (zoneShare ?? personShare) as NonNullable<typeof personShare>, zoneShare) : null,
          ])
        : coNotes?.startLine?.() ?? el('p', { class: 'lead' }, [S.startLead]),
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
    brandMark('logo logo-mark'),
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
  const shown = pictureUrl(imageMode(), url)   // wave 40: Tools > Images (hide: the initials stay)
  if (shown) { face.style.background = `url("${shown}") center/cover`; face.textContent = ''; face.dataset.pic = '1' }
  return face
}

/** Wave 28: a person's stored picture (person_image.ts) or their initials. */
const personFace = (p: Person): HTMLElement => pictured(avatar(p.name, p.id), personImageOk(p.image) ? p.image : undefined)
/** People for lists and pickers: no archived contact (the Curator's hidden ids). */
const activePeople = (): Person[] => shown(st(), curatorHiddenIds()).people
/** Wave 40 hover-sources: the person card's "How they relate to others I know"; a change saves and redraws the card. */
const relationsRowFor = (p: Person): HTMLElement => relationsSection(p, st(), activePeople(), (id) => openWebPage({ kind: 'card', id }), {
  set: (a, b, kind) => { setStated(st(), a, b, kind, Date.now()); save(); personSheet(p.id) },
  clear: (a, b) => { clearStated(st(), a, b); save(); personSheet(p.id) },
})

/** Wave 25: a tag the small card picked; the Membranes show only the people holding it. View state only. */
let tagFilter: string | null = null

/** Wave 25: a page over the Membranes (never a sheet): a person's small card, or the people beyond a membrane's five. Back = the browser's. */
type WebPage = { kind: 'card'; id: string } | { kind: 'more'; ring: Ring } | { kind: 'curator'; variant?: UiView } | { kind: 'me' }
let webPage: WebPage | null = null
/** Wave 27: the small card page is expanded in place (card_sections.ts order); Back collapses it first, a second Back leaves. */
let cardExpanded = false

function openWebPage(page: WebPage): void {
  webPage = page
  cardExpanded = false
  history.pushState({ twPage: page.kind }, '')
  render()
}
/** A person's card as a page on the Web (no overlay): from the People list, Network, Map and Feed. */
function openCardPage(id: string): void {
  closeSheet()
  peoplePage = false
  go(Screen.Web)
  openWebPage({ kind: 'card', id })
}
window.addEventListener('popstate', (e) => {
  const act = cardPopAction(e.state, cardExpanded)
  if (act === 'collapse') { cardExpanded = false; render() } else if (act === 'leave' && webPage) { cardExpanded = false; webPage = null; render() }
})

function toggleCardExpanded(): void {
  if (cardExpanded) { history.back(); return }
  cardExpanded = true
  history.pushState({ twPage: 'card-expanded' }, '')
  render()
}

/** The owner puts a person on a zone (the Curator's ring chooser, the card's zone chip): saved, the automatic zone slice sent, the Web redrawn; `toTana` when the Curator did not already sync it. */
function placePerson(id: string, ring: Ring, toTana: boolean): void {
  const p = state?.people.find((x) => x.id === id)
  if (!p) return
  setRing(p, ring)
  save()
  autoShareToPerson(p)
  if (toTana) web.ringToTana(p, ring)
  if (screen === Screen.Web) render()
}

function curatorPageTitle(variant?: UiView): string {
  return variant === UiView.Dex ? S.viewNames.dex : variant === UiView.Classic ? S.viewNames.compact : S.views.desk
}

/** The page body for `webPage`, with its header and Back. */
function webPageScreen(page: WebPage): Node[] {
  const s = shown(st(), curatorHiddenIds())
  const back = (): void => history.back()
  if (page.kind === 'curator') return [header(curatorPageTitle(page.variant), { back }), el('div', { class: 'scroll curator-page' }, [curator.el])]
  if (page.kind === 'me') {
    return [header(S.ownProfileTitle, { back }), ownProfilePage({
      profile: () => st().profile, basis: () => basisOf(st()), now: () => new Date(), face: () => pictured(avatar(st().me.displayName, st().me.id), ownPictureUrl), name: () => st().me.displayName,
      editProfile: profileSheet, editName: () => editNameSheet(true),
    })]
  }
  if (page.kind === 'more') {
    const people = s.people.filter((p) => !isBlocked(p) && !isArchived(p) && zoneFor(p, communityOf(s)) === page.ring)
    const zone = S.ringLabel[page.ring]
    const rec = st()
    const tagList = loadColourTags()
    const zoneTags = zoneTagIds(rec, page.ring).flatMap((id) => tagList.filter((t) => t.id === id))
    const zoneTagRow = zoneTagsRow(page.ring, zoneTags, (text) => suggestZoneTags(rec, tagList, page.ring, text),
      (name) => { const out = addZoneTag(rec, tagList, page.ring, name, Date.now()); if (out.created) saveColourTags(out.tags); save(); render() },
      (id) => { removeZoneTag(rec, page.ring, id, Date.now()); save(); render() })
    return [header(zone, { back }), el('div', { class: 'scroll' }, [zoneTagRow, restList(wholeZone(withTag(people, tagFilter), s, Date.now()), zone, (id) => openWebPage({ kind: 'card', id }), () => addPersonSheet(page.ring))])]
  }
  const p = s.people.find((x) => x.id === page.id)
  if (!p) { webPage = null; return screenWeb() }
  const tags = loadColourTags()
  return [header(S.cardPageTitle, { back }), el('div', { class: 'scroll' }, [smallCard({
    person: p, zone: S.ringLabel[webSlot(p)], tags: memberTagsOf(p, s.people, tags),
    visible: visibleVia(s.inventory ?? [], webSlot(p), tagsOf(p, tags), { zone: S.ringLabel[webSlot(p)], web: S.cardSharesWeb }),
    kindOf: (i) => S.cardSharesKind[kindKey(i.source?.kind)],
    onRenameResource: (id, next) => { if (renameResource(st(), id, next)) save(); render() },
    onAddResource: (c, title) => { if (addResourceIn(st(), c, title, randomId(8), Date.now())) save(); render() },
    onOpenResources: (c) => { invOnly = { label: c.label, ids: new Set(c.items.map((i) => i.id)) }; go(Screen.Inventory) },
    face: cardFace(p, personFace(p), { save, redraw: render, toast }),
    heading: cardNameHeading(p), places: connectedPlaces(p), onChat: () => chatSheet(p.id), expanded: cardExpanded, more: cardExpanded ? cardMore(p) : undefined,
    onOpen: toggleCardExpanded,
    onPin: () => { togglePersonPin(p, Date.now()); save(); render() },
    onQr: () => personQr(p),
    rings: RINGS.map((ring) => ({ ring, label: S.ringLabel[ring], current: webSlot(p) === ring })),
    onRing: (ring) => placePerson(p.id, ring, true),
    addableTags: tagsAddable(p, tags), onAddTag: (id) => { addTagTo(p, id); save(); render() },
    chat: cardChatButton(p, false),
    inventory: {
      list: () => peerItemList(p.id),
      onAdd: (title, category) => { addPeerItem(st(), p.id, title, category, 'self', Date.now()); save() },
    },
    onTag: (id) => { tagFilter = id; if (cardExpanded) { cardExpanded = false; history.go(-2) } else back() },
  })])]
}

/** Wave 31: what we know of a person's resources, in the same list as My Resources (whose = theirs). */
function peerItemList(personId: string): HTMLElement {
  const rows = peerItems(st(), personId).map((i) => ({ id: String(i.at) + i.title, title: i.title, chips: [i.category, i.source === 'self' ? null : i.source], at: i.at }))
  return rows.length ? resourceList('theirs', rows, Date.now()) : el('p', { class: 'meta' }, [S.cardInventoryNone])
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
const WEB_EXPAND_KEY = 'trustweb.ui.webExpand'

/** Wave 27: the eye (where the outliner glyph sat) opens the view menu; the magnifier beside the heading expands into the people search. */
let eyeOpen = false
// Escape or a tap outside the dropdown (and the eye itself, which toggles) closes it.
dismissOnOutside((t) => !eyeOpen || (t instanceof Element && !!t.closest('[data-view-drop], .view-menu-btn')), () => { if (eyeOpen) { eyeOpen = false; render() } })
let webSearchOpen = false
const HAS_MAP_VIEW = true
/** The Solar calendar is an extension module that does not exist yet: its entry stays greyed (wave 28). */
const SOLAR_INSTALLED = false
/** Wave 28: "Other views" starts collapsed. */
let otherViewsOpen = false
let webViewNow: ViewKey = 'rings'
let invSearchOpen = false
/** Wave 31: Resources shows the Matches view (eye menu) and polls the dev endpoint every 10 s while it does. */
let invMatches = false
let matchStatus: MatchStatus | null = null
let matchTimer: ReturnType<typeof setInterval> | null = null
function pollMatches(): void {
  void pollDevMatches().then((r) => {
    if (!r || !invMatches) return
    matchStatus = r.status
    const m = mergeIncoming(st().matches ?? [], r.items)
    if (m.changed) { st().matches = m.items; save() }
    if (m.changed || r.status) render()
    if (r.status?.phase === 'done' && matchTimer) { clearInterval(matchTimer); matchTimer = null }
  })
}
function setMatchesView(on: boolean): void {
  invMatches = on
  if (matchTimer) { clearInterval(matchTimer); matchTimer = null }
  if (on && devMatchesOn()) { pollMatches(); matchTimer = setInterval(() => { if (invMatches && screen === Screen.Inventory) pollMatches(); else setMatchesView(false) }, 10000) }
}
let invQuery = ''
/** Wave 29: Resources limited to the items one card category grants (membranes_five_view sharesLine); the chip clears it. */
let invOnly: { label: string; ids: Set<string> } | null = null


/** The web-view-row: the heading of the chosen view or the search field (the magnifier sits in the header, wave 28; expand all sits in the TrustZones sidebar, wave 28b). */
function webViewRow(view: WebView): HTMLElement {
  const heading = viewHeading(view)
  const mid = webSearchOpen
    ? el('input', {
      class: 'field web-search', type: 'search', placeholder: S.peopleSearchPh, 'aria-label': S.viewSearchAria, 'data-web-search': '',
      oninput: (e: Event) => { if (view === 'map') setPeopleQuery((e.target as HTMLInputElement).value) }, // wave 30: the Map's people list filters as you type
      onkeydown: (ev: Event) => {
        const e = ev as KeyboardEvent
        const input = e.target as HTMLInputElement
        if (e.key === 'Escape') { webSearchOpen = false; render() } else if (e.key === 'Enter') { webSearchOpen = false; openPeople(input.value) }
      },
    })
    : el('span', { class: 'web-view' }, [heading ? S.viewNames[heading] : ''])
  if (webSearchOpen) setTimeout(() => (mid as HTMLInputElement).focus(), 0)
  return el('div', { class: 'web-view-row' }, [mid])
}

/** The eye, preceded by the pinned views' glyph buttons, for the header's right end. */
function viewControls(current: ViewKey): Node {
  const pins = st().uiPins?.views
  const frag = document.createDocumentFragment()
  for (const v of pinnedViews(pins, HAS_MAP_VIEW)) {
    const b = iconButton(viewGlyph[v], S.viewNames[v], () => chooseView(v), 'view-pin' + (v === current ? ' on' : ''))
    b.setAttribute('data-view-pin', v)
    frag.append(b)
  }
  const eye = iconButton('eye', S.viewMenuAria, () => { eyeOpen = !eyeOpen; render() }, 'view-menu-btn' + (Date.now() < curatorPulseUntil ? ' pulse' : ''))
  eye.setAttribute('aria-expanded', String(eyeOpen))
  frag.append(eye)
  return frag
}

/** Wave 35: the view whose ⋮ menu is open in the eye's dropdown. */
let viewMoreOpen: string | null = null

/** Wave 35: a view's row in the eye menu with its ⋮ button; the menu pins it as the default view of Web and, in advanced mode, also puts it in the bottom row. */
function viewRowMore(view: ViewKey, row: HTMLElement): HTMLElement {
  const s = st()
  const open = viewMoreOpen === view
  const more = el('button', { class: 'view-more-btn', 'data-view-more': view, 'aria-haspopup': 'menu', 'aria-expanded': String(open), 'aria-label': S.viewMoreAria(S.viewNames[view]), onclick: () => { viewMoreOpen = open ? null : view; render() } }, ['⋮'])
  const pinned = webDefaultOf(s) === view
  const menu = open ? el('div', { class: 'view-more-menu', role: 'menu' }, [
    el('button', { class: 'linkbtn', role: 'menuitem', 'data-view-pin': view, ...(pinned ? { disabled: '' } : {}), onclick: () => {
      const v = setWebDefault(s.uiViews, view)
      if (v) s.uiViews = v; else delete s.uiViews
      viewMoreOpen = null; eyeOpen = false; save(); renderTabs(); render()
    } }, [pinned ? S.viewPinned : S.viewPinDefault]),
    isAdvanced(s) && view !== 'rings' ? el('label', { class: 'view-in-bar', 'data-view-in-bar': view }, [
      el('input', { type: 'checkbox', ...(resolveBar(s.uiBar, barFlags()).ids.includes(`view:${view}` as BarId) ? { checked: '' } : {}), onchange: (e: Event) => {
        s.uiBar = showViewInBar(s.uiBar, view, (e.target as HTMLInputElement).checked); save(); renderTabs(); render()
      } }),
      el('b', {}, [S.viewInBar]),
    ]) : null,
  ]) : null
  return el('div', { class: 'view-opt-wrap' }, [el('div', { class: 'view-opt-line' }, [row, more]), menu])
}

/** The eye's dropdown under the header: Web, Network, People, Map; then "Other views": Dex, Contacts compact. */
function viewDrop(current: ViewKey): HTMLElement | null {
  if (!eyeOpen) return null
  const items = viewMenuEntries({ current, hasMap: HAS_MAP_VIEW, pins: st().uiPins?.views })
  const btn = (i: { view: ViewKey; on: boolean }): HTMLElement => {
    const b = el('button', { class: 'view-opt' + (i.on ? ' on' : ''), role: 'menuitemradio', 'aria-checked': String(i.on), 'data-view': i.view, onclick: () => chooseView(i.view) })
    b.innerHTML = icon(viewGlyph[i.view])
    b.append(el('b', {}, [S.viewNames[i.view]]))
    return viewRowMore(i.view, b)
  }
  const other = items.filter((i) => i.group === 'other')
  const alt = items.filter((i) => i.group === 'alt')
  // Wave 28: "Other views" is one collapsed group holding the views beneath it; Dex sits under its own beta label inside.
  return el('div', { class: 'view-drop', role: 'menu', 'aria-label': S.viewMenuAria, 'data-view-drop': '' }, [
    ...items.filter((i) => !i.other).map(btn),
    ...twRegistry.views().map((v) => { // wave 39: the views of the extension modules that are on
      const b = el('button', { class: 'view-opt', role: 'menuitemradio', 'aria-checked': 'false', 'data-mod-view': v.id, onclick: () => openExtView(v.id) })
      b.innerHTML = icon(v.icon)
      b.append(el('b', {}, [v.title]))
      return b
    }),
    other.length || alt.length ? el('button', { class: 'view-drop-sep view-other-toggle', 'data-view-other': '', 'aria-expanded': String(otherViewsOpen), onclick: () => { otherViewsOpen = !otherViewsOpen; render() } }, [disclosureGlyph(otherViewsOpen) + ' ' + S.viewOther]) : null,
    ...(otherViewsOpen ? [...other.map(btn), alt.length ? el('div', { class: 'view-drop-sep', 'data-view-alt': '' }, [S.viewAlt]) : null, ...alt.map(btn)] : []),
  ])
}

/** The dropdown of Events and Resources (their own views), under the header like the Web's. */
function screenViewDrop(): HTMLElement | null {
  const which = screen === Screen.Events ? 'events' : 'inventory'
  if (!eyeOpen) return null
  const current = which === 'events' ? (cal && eventsView.atList() ? 'calendar' : 'list') : screen === Screen.Notes ? 'notes' : invMatches ? 'matches' : zoom.inventory ? 'outline' : 'list'
  return el('div', { class: 'view-drop', role: 'menu', 'aria-label': S.viewMenuAria, 'data-view-drop': '' }, screenViews(which, SOLAR_INSTALLED).filter((v) => v.key !== 'matches' || isEnabled('matches')).map((v) => {
    const b = el('button', { class: 'view-opt' + (v.key === current ? ' on' : ''), role: 'menuitemradio', 'aria-checked': String(v.key === current), 'data-view': v.key, disabled: !v.available, onclick: () => chooseScreenView(which, v.key) })
    b.innerHTML = icon(v.key === 'list' || v.key === 'matches' || v.key === 'notes' ? 'list' : v.key === 'outline' ? 'zoom' : 'calendar')
    b.append(el('b', {}, [v.available ? S.screenViewNames[v.key] : S.viewSolarOff]))
    return b
  }))
}

function chooseScreenView(which: 'events' | 'inventory', key: string): void {
  eyeOpen = false
  if (which === 'events') { if (key === 'list') eventsView.showList(); else eventsView.open(); render(); return }
  if (key === 'notes') { if (screen === Screen.Notes) render(); else openNotes(); return }
  if (screen === Screen.Notes) go(Screen.Inventory)
  if (key === 'matches') { setMatchesView(true); render(); return }
  setMatchesView(false)
  if (key === 'outline' && !zoom.inventory) tabTap(Screen.Inventory)
  else if (key === 'list' && zoom.inventory) history.back()
  else render()
}

function toggleExpand(expanded: boolean): void {
  try { window.localStorage.setItem(WEB_EXPAND_KEY, expanded ? '0' : '1') } catch { /* not remembered */ }
  go(Screen.Web)
}

/** Web and Network are remembered (WEB_VIEW_KEY); People, Dex and Contacts compact open as pages with Back. */
function chooseView(view: ViewKey): void {
  eyeOpen = false
  if (view === 'people') { if (screen === Screen.People && !completeMode) render(); else openPeople(); return }
  if (view === 'complete') { if (screen === Screen.People && completeMode) render(); else openComplete(); return }
  if (view === 'dex') { openDeskSheet(UiView.Dex); return }
  if (view === 'compact') { openDeskSheet(UiView.Classic); return }
  if (view === 'groups') { if (screen === Screen.Groups) render(); else openGroups(); return }
  try { window.localStorage.setItem(WEB_VIEW_KEY, view) } catch { /* not remembered */ }
  go(Screen.Web)
}

/** Wave 25: the Chat tab as Signal lays it out: search and the Do Not Disturb moon on top, one row per chat, a folded "find people" section below. */
let chatQuery = ''

function chatPeople(): ChatListPerson[] {
  return st().people.map((p) => ({ id: p.id, peerId: p.peerId, name: displayName(p.name).text, channels: p.channels }))
}

/** The small messenger symbols on a row: TrustWeb is the chat itself, Signal / WhatsApp open their link. */
function messengerChips(p: ChatListPerson): HTMLElement {
  const label = { trustweb: S.chatViaTrustweb, signal: 'Signal', whatsapp: 'WhatsApp' }
  return el('span', { class: 'msgr' }, messengerSymbols(p).map((m) => {
    const person = m.kind === 'whatsapp' ? st().people.find((x) => x.id === p.id) : undefined
    const href = m.href && safeHref(person ? waLink(m.href, waDraft(person)) : m.href)
    const text = label[m.kind].charAt(0)
    return href
      ? el('a', { class: 'msgr-ico ' + m.kind, href, target: '_blank', rel: 'noopener', 'data-messenger': m.kind, 'aria-label': S.chatOnMessenger(p.name, label[m.kind]), onclick: (e: Event) => e.stopPropagation() }, [text])
      : el('span', { class: 'msgr-ico ' + m.kind, 'data-messenger': m.kind, title: label[m.kind] }, [text])
  }))
}

function chatListBody(): Node[] {
  const s = st()
  const now = Date.now()
  const people = chatPeople()
  const rows = chatListRows(s.chats, people, { query: chatQuery, since: dndSince() })
  const find = chatFindRows(s.chats, people, chatQuery)
  return [
    ...(rows.length ? rows.map((r) => el('div', { class: 'prow chat-row', role: 'button', tabindex: '0', 'data-chat-row': r.personId, onclick: () => chatSheet(r.personId) }, [
      avatar(r.name, r.personId),
      el('div', { class: 'who' }, [el('b', {}, [r.name]), el('i', {}, [r.last])]),
      messengerChips(people.find((p) => p.id === r.personId) ?? { id: r.personId, name: r.name }),
      el('span', { class: 'when' }, [ageLabel(r.at, now)]),
      r.unread > 0 ? el('span', { class: 'dot', role: 'img', 'aria-label': S.chatTabUnread(r.unread) }) : null,
    ])) : [el('p', { class: 'empty' }, [chatQuery.trim() ? S.chatNoMatch : S.chatListEmpty])]),
    el('details', { class: 'chat-find', 'data-chat-find': '' }, [
      el('summary', {}, [S.chatFindTitle]),
      ...(find.length ? find.map((r) => el('button', { class: 'prow', 'data-chat-pick': r.personId, onclick: () => chatSheet(r.personId) }, [
        avatar(r.name, r.personId),
        el('div', { class: 'who' }, [el('b', {}, [r.name])]),
      ])) : [el('p', { class: 'meta' }, [S.chatFindEmpty])]),
    ]),
  ]
}

/** Wave 27: reminders that came due, at the top of the Events panel; each with Open and a dismiss. */
function reminderRows(): Node[] {
  return drawReminders().map((r) => el('div', { class: 'prow reminder-row', 'data-reminder': '' }, [
    el('span', { class: 'who' }, [el('b', {}, [r.title])]),
    el('button', { class: 'btn btn-ghost btn-sm', 'data-reminder-open': '', onclick: () => { dismissReminder(r); r.onOpen() } }, [r.openLabel]),
    el('button', { class: 'x', 'aria-label': S.remove, onclick: () => { dismissReminder(r); render() } }, ['×']),
  ]))
}

/** Wave 28: Do Not Disturb keeps the state of the moment it was switched on (nothing newer shows); 0 for a record from before that field. */
const dndSince = (): number | undefined => (st().chatsHidden ? st().chatsHiddenAt ?? 0 : undefined)

/** Wave 28: TrustWeb's own chats as the combined view's thread rows. */
function trustwebThreads(): ThreadSummary[] {
  return chatListRows(st().chats, chatPeople(), { since: dndSince() }).map((r) => ({ id: r.personId, title: r.name, lastAt: r.at, unread: r.unread }))
}

/** Wave 24: every chat, newest first; a tap opens the chat sheet. Wave 28: the pill and the three dots choose which messengers join the list. */
const supportIo: SupportIo = {
  st, save, render, openSheet, closeSheet, toast, send: (peer, text) => net.sendText(peer, text), openChat: chatSheet, appUrl: APP_URL, env: browserOpenEnv(),
}

function screenChat(): Node[] {
  const s = st()
  const guest = coNotes?.guest?.()
  if (guest) return guest.body()
  const view = chatView({ sources: messengers, trustweb: trustwebThreads, openTrustweb: chatSheet, dndSince, redraw: () => go(Screen.Chat) })
  const body = el('div', { class: 'chat-body' }, chatListBody())
  const search = el('input', { class: 'field', type: 'search', placeholder: S.chatSearch, 'aria-label': S.chatSearch, 'data-chat-search': '', value: chatQuery })
  search.addEventListener('input', () => { chatQuery = search.value; body.replaceChildren(...chatListBody()) })
  return [
    header(view.title, { right: view.pill, after: view.dots }),
    el('div', { class: 'scroll ppl' }, [
      s.chatsHidden ? el('p', { class: 'meta', 'data-chats-hidden': '' }, [S.chatDndHint]) : null,
      view.body,
      view.simple ? search : null,
      view.simple ? el('button', { class: 'btn btn-electric btn-sm', 'data-chat-new': '', onclick: chatNewSheet }, [S.chatNew]) : null,
      view.simple ? body : null,
    ]),
    queryFab(),
  ]
}

/** Chat > New message: a search bar, the people who can be chatted with; a typed name that is not connected says to connect first. */
function chatNewSheet(): void {
  const list = el('div', { class: 'ppl', 'data-chat-picker': '' })
  const fill = (q: string): void => {
    list.replaceChildren(...chatPickerRows(chatPeople(), q).map((r) => el('div', { class: 'prow', 'data-chat-pick': r.personId, onclick: () => { if (r.connected) chatSheet(r.personId) } }, [
      avatar(r.name, r.personId),
      el('div', { class: 'who' }, [el('b', {}, [r.name]), r.connected ? null : el('i', {}, [S.chatConnectFirst, ' ', el('button', { class: 'link', 'data-connect-first': r.personId, onclick: (e: Event) => { e.stopPropagation(); closeSheet(); personSheet(r.personId) } }, [S.chatConnect])])]),
    ])))
  }
  const search = el('input', { class: 'field', type: 'search', placeholder: S.chatSearch, 'aria-label': S.chatSearch, 'data-chat-search': '' })
  search.addEventListener('input', () => fill(search.value))
  fill('')
  openSheet([el('h3', {}, [S.chatNewTitle]), search, list])
}

/** Wave 27 (D2): once after the upgrade, an honest line that the pass-on default narrowed; drawn once, then marked dismissed. */
function passOnNotice(): null {
  if (!passOnDefaultNoticeDue(st())) return null
  dismissNotice(st(), PASS_ON_DEFAULT_NOTICE); save()
  // Wave 36b: the top notice layer (above the Tools panel, wraps, x and a tap on the text close it), not a line inside the zoomed rings.
  showNotice(S.passOnDefaultNotice, '', [], 30000)
  friendsEl.classList.add('tap-close')
  friendsEl.onclick = hideNotice
  return null
}

/** Wave 37: the visit began here; hidden once = the person left and came back (browser_only_notice.ts). */
const visitOpenedAt = Date.now()
let visitWasHidden = document.visibilityState === 'hidden'
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') visitWasHidden = true; else if (visitWasHidden && screen === Screen.Web) render() })
setTimeout(() => { if (screen === Screen.Web) render() }, 5 * 60_000 + 1000)
function browserOnlyNotice(): HTMLElement | null {
  if (!state || !shouldShowBrowserOnly({ dismissed: Boolean(state.browserOnlyDismissed), demo: demoPhone(), openedAt: visitOpenedAt, wasHidden: visitWasHidden }, Date.now())) return null
  return el('div', { class: 'browser-only', 'data-browser-only-notice': '' }, [
    el('span', { class: 'browser-only-text' }, [
      S.browserOnlyNotice + ' ',
      el('a', { href: 'https://trustintheweb.com/', target: '_blank', rel: 'noopener noreferrer' }, [S.browserOnlyLink]),
      ' ' + S.browserOnlyNoticeEnd,
    ]),
    el('button', { class: 'browser-only-x', type: 'button', 'data-browser-only-dismiss': '', onclick: () => { st().browserOnlyDismissed = true; save(); render() } }, [S.browserOnlyDismiss]),
  ])
}

function screenWeb(): Node[] {
  if (webPage) return webPageScreen(webPage)
  const full = shown(st(), curatorHiddenIds())
  const s = full
  let stored: string | null = null
  try { stored = window.localStorage.getItem(WEB_VIEW_KEY) } catch { /* storage blocked: Rings */ }
  const view = webViewOf(stored)
  let expandStored: string | null = null
  try { expandStored = window.localStorage.getItem(WEB_EXPAND_KEY) } catch { /* storage blocked: closest five */ }
  const expanded = expandedOf(expandStored, view)
  webViewNow = view
  // The zoom layer holds everything the screen body shows; the clip (.scroll) and the phone frame stay put.
  const layer = el('div', { class: 'rings-zoom' }, [
    // Wave 6i: the cards sit here, in the flow, above the rings (card_stack.ts); not while the dock needs the room.
    queryOpen ? null : cardStackEl,
    s.people.length === 0 ? el('p', { class: 'empty' }, [S.webEmpty]) : null,
    ...supportCards(supportIo),
    passOnNotice(),
    tagFilter ? tagFilterChip(loadColourTags().find((x) => x.id === tagFilter)?.label ?? tagFilter, () => { tagFilter = null; render() }) : null,
    view === 'network'
      ? createNetworkView({ me: s.me, people: s.people, openPerson: openCardPage, openMe: () => editNameSheet(), ui: { s: st(), tags: loadColourTags(), save } })
      : web.ringsView(s, askMarks(), undefined, { complete: expanded }),
    supportLine(supportIo),
    reachOutLegendShown(st()) && !hintHidden(HintId.ReachOut) ? el('button', { class: 'hint-i legend-i', 'data-legend-reach-out': '', 'aria-label': S.hintOpen(S.hintLabel[HintId.ReachOut]), onclick: () => openHint(HintId.ReachOut) }, ['i']) : null,
    isEphemeral() ? el('p', { class: 'warn' }, [S.storageEphemeral]) : null,
  ])
  // The Map has text boxes: no zoom layer (it would capture their pointers).
  const clip = view === 'map'
    ? el('div', { class: 'scroll' }, [createMapView({ people: s.people.filter((p) => ringShown(st(), webSlot(p))), openPerson: openCardPage, save, peopleList: (extra) => { resetPeopleList(); return peopleListBody(st, openCardPage, addPersonSheet, extra, rowEdit) } })])
    : el('div', { class: 'scroll' }, [onboardingCard(onboardHooks, render), layer])   // the card sits beside the zoom layer: scaled with the rings it left the desktop screen (wave 30 fix)
  if (view !== 'map') web.zoomOnWeb(clip, layer)
  return [
    // Wave 28: the header's controls (search, eye with its pinned views, QR, settings) are mounted by mountHeaderControls.
    header(S.webTitle),
    webViewRow(view),
    ...(ringFilterShown(view) ? [trustZonesGroup({ s: st(), onChange: () => { save(); render() } })] : []),
    ...[viewDrop(view)].filter((d): d is HTMLElement => d !== null),
    // The field panel sits beside the sidebar, below the zoomed rings layer: the zoom must not scale it.
    view === 'rings'
      ? el('div', { class: 'zones-split' }, [zoneColumn(s, expanded), el('div', { class: 'zones-main' }, [clip, ...(fiveRingsOn() ? [fieldOverviewPanel(s, { live: st, save, render })] : [])])])
      : clip,
    // Wave 39: the browser-only notice sits under the web, outside the zoomed layer (inside it the zoom scaled the line off the screen).
    ...[browserOnlyNotice()].filter((n): n is HTMLElement => n !== null),
    ...[wantsToConnectSection()].filter((d): d is HTMLElement => d !== null),   // wave 39: below the zoom clip, so it stays put and full size while the Web zooms
    queryOpen ? queryDock(s) : queryFab(),
  ]
}

/** Wave 28b (trustzones_view.ts): the one sidebar of the TrustZones view: expand all, add, tag filters. (Wave 28's zone panel, zzz strip and legend stay in trustzones_view.ts, unused here.) */
function zoneColumn(s: AppState, expanded: boolean): HTMLElement {
  const live = (): void => { save(); render() }
  const expand = iconButton(expanded ? 'collapse' : 'expand', expanded ? S.collapseAria : S.expandAria, () => toggleExpand(expanded), 'expand-btn')
  expand.setAttribute('data-expand', '')
  expand.setAttribute('aria-pressed', String(expanded))
  const add = el('button', { class: 'add-node', 'data-add-node': '', 'aria-label': S.addNodeAria, onclick: () => addPersonSheet(Ring.Acquaintance) }, ['+'])
  const pinned = headerPins(s.uiPins?.header).includes('select')
  return zoneSidebar({ s: st(), people: s.people, tags: loadColourTags(), onChange: live, expand, add, ...(pinned ? {} : { select: selectToolButton() }), hiddenCount: expanseList(st()).length, openHidden: () => web.openExpanse(), spaceOut: () => web.spaceOutWeb(), deletedCount: recentlyDeleted(s.people, Date.now()).length, openDeleted: () => web.openDeleted(), openPanel: (children) => openSheet(children) })
}

/** Wave 39: the select tool; it sits beneath Settings in the header (a pin, on by default) or, unpinned, in the Web's tool column. */
function selectToolButton(extra = 'expand-btn'): HTMLElement {
  const select = iconButton('select', S.selectToolAria, () => { web.toggleSelect(); render() }, `${extra} select-tool`)
  select.setAttribute('data-tool', 'select')
  select.setAttribute('aria-pressed', String(web.selectOn()))
  return select
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

function addPersonSheet(ring: Ring, presetHint = false): void {
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
    ...(presetHint ? [el('p', { class: 'meta', 'data-add-preset-hint': '' }, [S.addPresetHint])] : []),
    addBtn,
    el('button', { class: 'btn btn-ghost', onclick: closeSheet }, [S.addCancel]),
  ])
  setTimeout(() => name.focus(), 320)
}

/** Name labels that would sit on another's hide until hover or focus (the compact-ring pattern); measured at the settled layout. */
function hideCollidingLabels(wrap: HTMLElement): void {
  const nodes = [...wrap.querySelectorAll<HTMLElement>('.node:not(.you)')]
  nodes.forEach((n) => n.classList.remove('lbl-off'))
  const spans = nodes.map((n) => n.querySelector('span'))
  const boxes = spans.flatMap((s, i) => (s && s.offsetWidth ? [{ i, ...s.getBoundingClientRect().toJSON() }] : []))
  collidingLabels(boxes.map((x) => ({ l: x.left, t: x.top, r: x.right, b: x.bottom }))).forEach((j) => nodes[boxes[j].i].classList.add('lbl-off'))
}
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
  hideCollidingLabels(wrap)
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
  // Wave 39: in the IYG support variation the Web's primary button asks for support.
  if (profileDef(profileOf(state?.twSettings)).webPrimary === 'support' && isEnabled('support-ask')) {
    const b = el('button', { class: 'query-fab', 'aria-label': S.supportTitle, 'data-open-query': '1', 'data-support-primary': '', onclick: () => { askMode = AskMode.Support; openQuery() } })
    b.innerHTML = icon('query')
    b.append(el('span', {}, [S.supportTitle]))
    return b
  }
  const call = queryStyle() === QueryStyle.Call
  const b = el('button', {
    class: 'query-fab' + (call ? ' call' : ''), 'aria-label': call ? S.webCall : S.webQuery, 'data-open-query': '1',
    onclick: openQuery,
  })
  b.innerHTML = call ? askWebIcon(askIconVariant) : icon('query')
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
    el('button', { class: 'btn btn-ghost', 'data-item-qr': item.id, onclick: () => { closeSheet(); void qrPage((link) => ({ kind: 'item', link, shareLink: `${link.split('#')[0]}#item=${toBase64Url(item.text)}` })) } }, [S.qrItemShow]),
    ...(cal?.itemSection?.(item) ?? []),
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

/** The card's name heading; draggable onto a calendar event (drag_payload.ts). */
function personSheet(personId: string): void {
  const p = st().people.find((x) => x.id === personId)
  if (!p) return
  // Wave 27: a card already open as a page redraws in place; the sheet below is the archived overlay (restore: DEVLOG/wave27/archive/card-overlay).
  if (webPage?.kind === 'card' && webPage.id === personId) { render(); return }
  // The person's page is the Web Curator's own; this strip holds only what the Curator lacks: chat, messenger links, pass-on and ask-again (it already says connected or not).
  const cons = chatOnConsensual(p, st().preferConsensual)
  openSheet([
    cardNameHeading(p),
    pinButton(p, () => { togglePersonPin(p, Date.now()); save(); render(); personSheet(p.id) }),
    daysSection(st, p),
    undoOffered(st(), p.id, Date.now()) ? el('button', { class: 'btn btn-ghost btn-sm', 'data-release-undo-person': p.id, onclick: () => { undoRelease(st(), p.id, Date.now()); save(); render(); personSheet(p.id) } }, [S.engagementUndoRelease]) : null,
    cons ? el('a', { class: 'btn btn-electric', href: cons.link, target: '_blank', rel: 'noopener noreferrer', 'data-message-on': cons.channel }, [S.consChat]) : null,
    cons ? el('p', { class: 'meta' }, [S.consHonesty]) : null,
    cardChannelsRow(p),
    cardChatButton(p, Boolean(cons)),
    reachedOutRow(p),
    noMessengerRow(p),
    sharedReachRow(p),
    askLinksRow(p),
    passOnRowFor(p),
    askAgainRow(p),
    leanRow(p),
    eventChipsRow(p),
    knowsRow(p, activePeople(), save, () => personSheet(p.id), (id) => openWebPage({ kind: 'card', id }), personFace),
    relationsRowFor(p),
    timelineSection(p),
    theirProfileBlock(p.name, p.theirProfile, Date.now()),
    p.peerId ? sendProfileRow(p) : null,
    curator.person(p.id, closeSheet, { embedded: true }),
    el('button', { class: 'btn btn-ghost', 'data-card-qr': p.id, 'aria-label': S.qrShowAria, onclick: () => personQr(p) }, [S.qrPageTitle]),
    el('button', { class: 'btn btn-ghost card-curate-open', 'data-card-curate': p.id, onclick: () => curatePage(p) }, [S.cardCurate]),
  ])
  cardOpenFor = p.id
}

function personQr(p: Person): void {
  void qrPage((link) => ({ kind: 'person', link, name: p.name, username: p.publicUsername, introducePermission: p.introducePermission, profile: linkEntries(p)[0]?.url }))
}

/** Wave 27: the rest of the person's card under the small card, in card_sections.ts order (the old sheet's rows, no overlay). */
const invitationIo = (): InvitationIo => ({ st, save, render, openSheet, closeSheet, toast: (m) => toast(m), newId: () => randomId(8) })

const logThought = (p: Person) => (line: string): void => {
  st().log.unshift({ id: randomId(8), at: Date.now(), from: p.name, text: line, outcome: LogOutcome.Shared, peerId: p.peerId })
  save()
}

function cardMore(p: Person): Node[] {
  const cons = chatOnConsensual(p, st().preferConsensual)
  const rows: Record<string, () => (Node | null)[]> = {
    channels: () => [
      cons ? el('a', { class: 'btn btn-electric', href: cons.link, target: '_blank', rel: 'noopener noreferrer', 'data-message-on': cons.channel }, [S.consChat]) : null,
      cons ? infoNote(S.consHonesty) : null,
      cardChannelsRow(p), reachedOutRow(p), noMessengerRow(p), sharedReachRow(p),
    ],
    askLinks: () => [askLinksRow(p)],
    passOn: () => [passOnRowFor(p)],
    knows: () => [knowsRow(p, activePeople(), save, () => personSheet(p.id), (id) => openWebPage({ kind: 'card', id }), personFace), relationsRowFor(p)],
    invitations: () => [cardInvitationsRow(invitationIo(), p)],
    photos: () => {   // wave 40: the Photos module answers 'person-card' by drawing into this host; off: nothing
      if (!isEnabled('photos')) return []
      const host = el('div', { class: 'photos-host', 'data-photos-host': p.id })
      twBus.emit('person-card', { personId: p.id, host })
      return [host]
    },
    other: () => [
      undoOffered(st(), p.id, Date.now()) ? el('button', { class: 'btn btn-ghost btn-sm', 'data-release-undo-person': p.id, onclick: () => { undoRelease(st(), p.id, Date.now()); save(); render() } }, [S.engagementUndoRelease]) : null,
      keepInTouchRow({ state: st, save, redraw: render, toast: (msg, undo) => toast(msg, { onClick: undo }) }, p),
      birthdayRow({ save, redraw: render, tell: (q, text) => submitText(chatIo(), q.peerId!, text), log: logThought(p) }, p),
      thoughtRow({ save, redraw: render, tell: (q, text) => submitText(chatIo(), q.peerId!, text), log: logThought(p) }, p),
      seenLine(st(), p.id), personShareRow(p), askAgainRow(p), leanRow(p), eventChipsRow(p), theirProfileBlock(p.name, p.theirProfile, Date.now()), p.peerId ? sendProfileRow(p) : null,
    ],
    notes: () => [curator.person(p.id, closeSheet, { embedded: true }), sharedNotesSection(p, notesHooks())],
    timeline: () => [timelineSection(p)],
    curate: () => [
      el('button', { class: 'btn btn-ghost card-curate-open', 'data-card-curate': p.id, onclick: () => curatePage(p) }, [S.cardCurate]),
    ],
  }
  const connected = Boolean(p.peerId)
  const sections = cardSections({ connected, canAskLinks: askLinksRow(p) !== null, photos: isEnabled('photos') })
  return sections.flatMap((id) => rows[id]?.() ?? []).filter((n): n is Node => n !== null)
}

/** Wave 31 (shared_notes_view.ts): what the Notes section of a card needs from the app. */
function notesHooks(): Parameters<typeof sharedNotesSection>[1] {
  const s = st()
  return {
    me: { did: s.me.id, name: s.me.displayName },
    candidates: candidates({ people: activePeople(), tags: loadColourTags() }),
    connectLink: async () => { await net.start(); return net.connectLink(CONNECT_URL) },
    save,
    toast,
    relay: canRegister(SERVER_ORIGIN) && st().identity ? { on: readRelayOn, send: sendViaRelay } : undefined,
  }
}

// Wave 32 (notes_relay.ts): shared notes above ~100 items travel sealed through the backup server.
const relayDeps = (): RelayDeps => ({ origin: SERVER_ORIGIN, fetch: (input, init) => fetch(input, init), now: () => Date.now() })
/** Wave 37: the relay is on and there is one here (a dev server stands in for it, so a preview can be tried without the live host). */
const relayOn = (): boolean => readRelayOn() && (canRegister(SERVER_ORIGIN) || import.meta.env.DEV)

/** Wave 37 (co-notes-link): the guest accepted to connect with the owner of a shared note: the existing connect flow, the owner lands in my Intending ring. */
async function connectToNoteOwner(who: { did: string; id: string; name: string }): Promise<string | null> {
  try {
    await net.start()
    const peer = await net.completeConnect({ did: who.did, from: { id: who.id, displayName: who.name } }, Ring.Intending)
    const s = st()
    let person = s.people.find((p) => p.peerId === peer.id)
    if (!person) { person = { id: randomId(8), name: peer.displayName, context: '', ring: Ring.Intending, metAt: Date.now(), lines: [], peerId: peer.id }; s.people.push(person) }
    save()
    render()
    return person.id
  } catch (e) {
    console.warn('connect to the note owner', e)
    return null
  }
}

/** The relay DID this person is reached by: the paired peer's, else the one an event link told me. */
const relayDidOf = (p: Person): string | undefined => st().peers.find((x) => x.id === p.peerId)?.did ?? p.did

/** Seals `note` for each of these people and leaves it on the relay; how many it reached. */
async function sendViaRelay(note: Parameters<typeof postNote>[1], personIds: string[]): Promise<number> {
  const identity = st().identity
  if (!identity) return 0
  const me = deserializeIdentity(identity)
  const dids = st().people.filter((p) => personIds.includes(p.id)).flatMap((p) => relayDidOf(p) ?? [])
  const done = await Promise.all(dids.map((did) => postNote(relayDeps(), note, me, did)))
  return done.filter(Boolean).length
}

/** On open and on Sync now: fetch what was left for me, keep each note on the sender's card, and ask the relay to forget it. */
async function pollNotesRelay(): Promise<void> {
  void coNotes?.poll?.().then((changed) => { if (changed) render() })
  if (!state?.identity || !readRelayOn() || !canRegister(SERVER_ORIGIN)) return
  const bySender = (did: string): Person | undefined => st().people.find((p) => relayDidOf(p) === did)
  const got = await pollRelay(relayDeps(), deserializeIdentity(state.identity), (did) => bySender(did) !== undefined)
  for (const { from, note } of got) addReceivedNote(bySender(from)!, note)
  if (!got.length) return
  save()
  toast(S.noteRelayArrived(got.length))
  render()
}

/** Wave 30: the one link made for a person, kept while the card is open so the WhatsApp message can carry it. */
const personLinks = new Map<string, string>()

/** The first WhatsApp message to a person: a greeting, and the person's one link once it is made. */
const waDraft = (p: Person): string => S.personWaDraft(displayName(p.name).text, personLinks.get(p.id))

/** The connect link, the channels I ticked, and the texts of the things this person's zone may see (the same check as enforcement). */
async function buildPersonLink(p: Person): Promise<string> {
  await net.start()
  const s = st()
  const texts = seenBy(basisOf(s), p.id, new Date()).map((id) => s.inventory.find((i) => i.id === id)?.text ?? '')
  const url = personShareLink(net.connectLink(CONNECT_URL), s.myChannels, s.contactShare, texts)
  personLinks.set(p.id, url)
  // The WhatsApp buttons already drawn on this card get the message with the link in it.
  for (const a of document.querySelectorAll<HTMLAnchorElement>(`a[data-wa-person="${p.id}"]`)) a.href = waLink(a.href.split('?')[0], waDraft(p))
  return url
}

/** A zone link's URL: the connect link, the channels I ticked, and the texts of what its zones see (the same check as enforcement). */
async function buildZoneLink(l: ZoneLink): Promise<string> {
  await net.start()
  const s = st()
  const texts = zoneItems(basisOf(s), l.zones, new Date()).map((id) => s.inventory.find((i) => i.id === id)?.text ?? '')
  return zoneShareLink(net.connectLink(CONNECT_URL), s.myChannels, s.contactShare, l, texts)
}

/** Person card: "Share one link with <name>" (underlined), copy and the phone's share sheet. */
function personShareRow(p: Person): HTMLElement {
  const name = displayName(p.name).text
  const link = async (): Promise<string> => personLinks.get(p.id) ?? buildPersonLink(p)
  void link().catch(() => undefined)
  return el('div', { class: 'card-share-link', 'data-person-share': p.id }, [
    el('button', { class: 'btn btn-ghost btn-sm', 'data-person-share-copy': p.id, onclick: () => {
      void link().then(async (url) => {
        if (typeof navigator.share === 'function') await navigator.share({ text: url }).catch(() => undefined)
        else await navigator.clipboard.writeText(url).then(() => toast(S.meetCopied))
      })
    } }, [S.personShareRow(name)]),
    infoNote(S.personShareInfo),
  ])
}

/** The start screen of a link made for me: what the sender shares with me and the ways to reach them. Nothing is added until I tap. */
function personShareBox(inviter: string, share: NonNullable<typeof personShare>, zone: typeof zoneShare): HTMLElement {
  const channels = share.contact ? Object.keys(share.contact.channels).map((ch) => chName(ch as Channel)).join(', ') : ''
  return el('div', { class: 'person-share', 'data-person-share-in': '' }, [
    el('b', {}, [zone ? S.zoneShareFrom(inviter, S.shareZones[zone.zone][0]) : S.personShareFrom(inviter)]),
    share.items.length ? el('p', { class: 'meta' }, [S.personShareItems]) : null,
    share.items.length ? el('ul', {}, share.items.map((t) => el('li', {}, [t]))) : null,
    channels ? el('p', { class: 'meta' }, [S.personShareContact(channels)]) : null,
    zone ? el('p', { class: 'meta', 'data-zone-share-more': '' }, [S.zoneShareMore]) : null,
  ])
}

/** The channels this person has, each a link with its value; a value I typed is edited by tapping it (card_view.ts channelEdit). */
function cardChannelsRow(p: Person): HTMLElement | null {
  const chs = reachableChannels(p)
  if (!chs.length) return null
  return el('div', { class: 'card-channels', 'data-card-channels': p.id }, chs.map((r) => {
    const val = el('span', { class: 'card-ch-val' }, [r.value])
    if (r.source === 'own') {
      tapEdit(val, {
        text: r.value, value: r.value, aria: S.cardChEditAria(chName(r.channel)), attrs: { 'data-card-ch-edit': r.channel },
        resolve: (typed) => channelEdit(r.channel, r.value, typed),
        commit: (next) => { const c = { ...p.channels }; if (next) c[r.channel] = next; else delete c[r.channel]; p.channels = c; save(); personSheet(p.id) },
      })
    }
    return el('div', { class: 'card-ch', 'data-card-ch': r.channel }, [
      el('a', { class: 'btn btn-ghost btn-sm', href: r.channel === Channel.WhatsApp ? waLink(r.value, waDraft(p)) : r.link, target: '_blank', rel: 'noopener noreferrer', 'data-message-on': r.channel, ...(r.channel === Channel.WhatsApp ? { 'data-wa-person': p.id } : {}) }, [chName(r.channel)]),
      val,
    ])
  }))
}

/** Advanced: write to a connected person without opening the earlier conversation; the message still lands in the chat book. */
function sendUnreadBox(p: Person): HTMLElement {
  const text = el('textarea', { class: 'field', rows: '2', maxlength: String(CHAT_TEXT_MAX), placeholder: S.cardSendUnreadPh, 'aria-label': S.cardSendUnread, 'data-send-unread-text': p.id }) as HTMLTextAreaElement
  const go = el('button', { class: 'btn btn-electric btn-sm', 'data-send-unread': p.id, onclick: () => {
    const peerId = p.peerId
    if (!peerId || !text.value.trim()) return
    void submitText(chatIo(), peerId, text.value).then((ok) => { if (ok) { text.value = ''; toast(S.cardSendUnreadSent) } })
  } }, [S.cardSendUnreadGo])
  return el('details', { class: 'card-advanced', 'data-card-advanced': p.id }, [el('summary', {}, [S.cardChatAdvanced]), el('div', { class: 'card-compose' }, [el('p', { class: 'meta' }, [S.cardSendUnread]), text, go])])
}

/** The Chat button (the Chat tab's icon), only for a person connected on TrustWeb; it opens the chat page (or the pinned / last-used service). Not connected: the messenger glyphs and the way to connect (an invitation I hold, else the link panel). */
function cardChatButton(p: Person, quiet: boolean): HTMLElement {
  if (!chatShown(p)) {
    return el('div', { class: 'card-chat' }, [
      p.pendingInvite ? el('button', { class: 'btn btn-electric btn-sm', 'data-reopen-invite': p.id, onclick: () => reopenInvite(p.pendingInvite!) }, [S.cardConnect]) : null,
      connectBlock(p, displayName(p.name).text, { link: async () => { await net.start(); return net.connectLink(CONNECT_URL) }, save, toast }),
    ])
  }
  const open = (svc: ChatService): void => {
    noteUsed(st(), p.id, svc.id, Date.now()); save()
    if (svc.url) {
      if (!extOn.some((m) => m.openExternal?.(svc.url!))) {
        const app = appLinkFor(svc.url)
        if (app) openLocalFirst(app, svc.url, browserOpenEnv())
        else window.open(svc.url, '_blank', 'noopener,noreferrer')
      }
    } else chatSheet(p.id)
  }
  const b = chatRow({
    personId: p.id, services: chatServices(p), prefs: () => st().chatPrefs?.[p.id], mainClass: quiet ? 'btn-ghost' : 'btn-electric', iconHtml: icon('chat'), open,
    label: (svc) => svc.kind === 'trustweb' ? S.chatRowTrustweb : svc.channel ? chName(svc.channel) : S.chatRowLink[svc.linkKind ?? 'other'],
    pin: (id) => { toggleChatPin(st(), p.id, id); save() },
  })
  return el('div', { class: 'card-chat' }, [b, sendUnreadBox(p)])
}

/** Wave 25: Curate opens its own page (the unfold took too long to draw); the tools are the same rows. */
function curatePage(p: Person): void {
  const now = (): Person => st().people.find((x) => x.id === p.id) ?? p
  pages.open(S.cardCurateTitle(p.name), [
    cardNameHeading(p),
    el('button', { class: 'btn btn-ghost btn-sm', 'data-curate-knows': p.id, onclick: () => { history.back(); window.setTimeout(() => document.querySelector(`[data-person-knows="${p.id}"]`)?.scrollIntoView({ block: 'center' }), 50) } }, [S.cardCurateKnows]),
    solo ? null : el('button', { class: 'btn btn-ghost btn-sm', 'data-same-person': p.id, onclick: () => devices.samePersonPicker(p.id) }, [S.dvSameAs]),
    introduceRow(p),
    agreementsFor(p),
    blockRow(p),
    archiveRow(p),
    timelineImportButton((text) => importTimelineText(now(), text), toast),
    // Keep in touch and Merge with sit at the bottom of Curate (wave 28), the Curator's own pieces; the mount sizes to them, not to the page.
    Object.assign(curator.person(p.id, () => history.back(), { embedded: 'curate' }), { style: 'height:auto' }),
  ].filter((n): n is HTMLElement => n !== null), 'card-curate')
}

/** The QR page for a context (qr_modes.ts): the longer connect link is used, since a short /c/ link may drop the mode parameters on its redirect. */
async function qrPage(build: (link: string) => QrContext, plain = false): Promise<void> {
  await net.start()
  openQrPage({ open: (title, body, mark) => pages.open(title, body, mark), renderQr, profileOption: st().qrProfileOption }, build(net.connectLink(CONNECT_URL)), plain ? S.qrOnlyNote : undefined)
}

/** Curate: what others may pass on about this person when they introduce them, and the public username I know for them. */
function introduceRow(p: Person): HTMLElement {
  const sel = el('select', { 'aria-label': S.introduceLabel(p.name), 'data-introduce': p.id, onchange: (e: Event) => { p.introducePermission = parseIntroducePermission((e.target as HTMLSelectElement).value); save() } },
    INTRODUCE_PERMISSIONS.map((o) => el('option', { value: o, selected: parseIntroducePermission(p.introducePermission) === o }, [S.introduceOptions[o]])))
  const name = el('input', { class: 'field', maxlength: '30', 'aria-label': S.introduceUsernameLabel, placeholder: S.introduceUsernameLabel, value: p.publicUsername ?? '', 'data-public-username': p.id }) as HTMLInputElement
  name.addEventListener('change', () => { p.publicUsername = name.value.trim().replace(/^@/, '').toLowerCase() || undefined; save() })
  return el('div', { class: 'conn-row' }, [el('label', {}, [S.introduceLabel(p.name) + ' ', sel]), name])
}

/** The card's name; a tap swaps it for an input (Enter or blur saves, Escape cancels). person.name is the owner's own name for them. */
function cardNameHeading(p: Person): HTMLElement {
  const h = el('h2', { class: 'card-name', 'data-card-name': p.id, style: `color:${ringColor(p)}` })
  tapEdit(h, {
    text: displayName(p.name).text, value: p.name, aria: S.cardNameEditAria(p.name), attrs: { class: 'card-name-btn', 'data-card-name-edit': p.id },
    maxlength: HELLO_NAME_MAX, resolve: (typed) => renamedTo(p.name, typed),
    commit: (next) => { p.name = next; save(); render(); personSheet(p.id) },
  })
  dragPerson(h, p) // calendar module: the heading is a drag source (drop a person onto an event)
  return h
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

/** Archive (the default) or Delete: since wave 36b Delete is the 30-day reversible one (deleted_people.ts), no question, the toast carries Undo. The old "Delete for good?" strings (personDeleteAsk/Yes/No) stay in strings.ts, unused (DEVLOG/wave36b/archive/notices-2). */
function archiveRow(p: Person): HTMLElement {
  return el('div', { class: 'archive-row' }, [
    el('button', { class: 'btn btn-ghost', 'data-archive-person': p.id, onclick: () => { closeSheet(); void web.hideOnRings(p).then(archivedNotice) } }, [S.personArchive]),
    el('button', { class: 'btn btn-ghost btn-sm quiet', 'data-delete-person': p.id, onclick: () => deletePerson(p.id) }, [S.personDelete]),
  ])
}

/** Wave 36: people deleted more than 30 days ago go for good (deleted_people.ts); the Recently deleted list was their only way back. */
function purgeDeleted(): void {
  if (!state) return
  const due = new Set(purgeDue(state, Date.now()))
  if (!due.size) return
  state.people = state.people.filter((x) => !due.has(x.id))
  save()
}

/** Person page and Desk delete: the 30-day tombstone and the same Undo toast as the dustbin (web_view removeNow). */
function deletePerson(personId: string): void {
  const p = st().people.find((x) => x.id === personId)
  closeSheet()
  if (p) web.deleteReversibly([p])
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
    const saver = createAutosaver({ commit: (text) => { if (setGeneralNote(p, text)) { save(); thoughtOf(p) } } })
    area.addEventListener('input', () => saver.input(area.value))
    area.addEventListener('blur', () => saver.flush())
    const saveBtn = el('button', { class: 'btn btn-electric btn-sm', 'data-lean-note-save': '', onclick: () => { saver.flush(); toast(S.noteSaved) } }, [S.noteSave])
    return el('div', { class: 'lean-note' }, [el('label', { class: 'meta' }, [S.noteLabel]), area, saveBtn])
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
function timelineSection(p: Person, full = false): HTMLElement {
  // The record may have been replaced since the card opened: write into the person as the record holds it now.
  const now = (): Person => st().people.find((x) => x.id === p.id) ?? p
  return createTimelineSection({
    entries: () => mergedTimeline(st(), now()),
    add: (entries) => { const n = addEntries(now(), entries); if (n) save(); return n },
    importText: (text) => importTimelineText(now(), text),
    setMet: (at) => { setMetAt(now(), at); save() },
  }, toast, true, full ? undefined : () => pages.open(S.tlTitle, [timelineSection(p, true)], 'card-timeline'))
}

/** Reads a timeline file into the person; returns the message to show. */
function importTimelineText(p: Person, text: string): string {
  const r = parseTimelineImport(text)
  if (r.unreadable) return S.tlImportBad
  const n = addEntries(p, r.entries)
  if (n) save()
  return S.tlImported(n, r.skipped, r.entries.length - n)
}

/** A connected person who has shared no messenger link (and none was typed): say so plainly; it fills in if their link arrives. */
function noMessengerRow(p: Person): HTMLElement | null {
  if (!p.peerId || primaryReachable(p)) return null
  return noMessengerBlock(p, p.name, { link: async () => '', save, toast }, () => personSheet(p.id))
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
  offline: S.chatOffline, placeholder: S.chatPlaceholder, send: S.chatSend, longHint: S.chatLongHint, sendAgain: S.chatSendAgain, pending: S.chatPending,
  sent: S.chatSent, charsLeft: S.chatCharsLeft, you: S.chatYou,
  re: S.chatRe, replyingTo: S.chatReplyingTo, replyingToDrop: S.chatReplyingToDrop,
  notDelivered: S.chatNotDelivered, sendVia: (k) => S.chatSendVia(S.chLabel[k === 'signal' ? Channel.Signal : Channel.WhatsApp]),
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
  const deps: ProfileViewDeps = {
    profile: mine, inventory: () => st().inventory, now: Date.now,
    commit: () => { save(); redraw() },
    addNorm: (norm, text) => withProfile((p) => addNorm(p, norm, text, Date.now())),
    removeNorm: (i) => withProfile((p) => removeNorm(p, i)),
    setOne: (key, text) => withProfile((p) => setOne(p, key, text, Date.now())),
    // E3: one scope per section, edited on a page of its own (like the Share page); Done saves, redraws the sheet and goes back.
    setScope: (section, scope) => withProfile((p) => setScope(p, section, scope)),
    openScopeEditor: (section) => pages.open(S.scopeTitle(S.profSection[section]), scopePageNodes(deps, section, () => history.back()), 'profile-scope'),
    basis: () => basisOf(st()),
    myName: () => st().me.displayName,
    picture: {
      face: () => pictured(avatar(st().me.displayName, st().me.id), ownPictureUrl),
      url: () => ownPictureUrl,
      has: () => Boolean(mine().pictureId),
      choose: (file) => { void setOwnPicture(file).then(redraw, () => toast(S.agrSendFailed)) },
      remove: () => { void removeOwnPicture().then(redraw) },
    },
    openInventory: () => { closeSheet(); go(Screen.Inventory) },
    city: { get: () => st().city ?? '', set: (v) => { const c = v.trim(); if (c) st().city = c; else delete st().city } },
  }
  return profileSheetNodes(deps)
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
    shareExpiryLine(),
  ])
}

/** Wave 24b: the grey reminder wherever something is shared with a person (nothing when expiry is off). */
function shareExpiryLine(): HTMLElement | null {
  const text = S.shareExpiryHint(engagementDays(st()))
  return text ? el('p', { class: 'meta', 'data-share-expiry': '1' }, [text]) : null
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
  // E3: the sections this person may see, by the same check as the profile's "as seen by" preview (their zone, tags and events).
  const basis = basisOf(st())
  const text = person ? buildProfileText(APP_URL, st().profile, person, pic, basis) : null
  if (!text) { toast(buildProfileText(APP_URL, st().profile, undefined, pic) ? S.profNothingFor(peer.displayName) : S.profEmpty); return }
  net.sendText(peer, text, Date.now(), undefined, profileFor(st().profile, person!, pic, basis)?.picture).then(() => toast(S.profSent(peer.displayName))).catch(() => toast(S.agrSendFailed))
}

/**
 * Wave 20 (Jakob 2026-10-23, supersedes the 2026-10-15 tap-only rule for the zone slice): sends the slice of `zone` once when a connection
 * lands (`public`: only the sections set to Public) and again when the person is placed on a closer ring (changeRing, the add sheets).
 * Never when switched off in Settings, never to demo phones, never on moving outward. Silent: no toast on this side.
 */
async function autoShareProfile(peer: Peer, zone: Zone | null, person?: Person): Promise<void> {
  const s = st()
  const rank = zone && !s.profileAutoOff && !noSendTo(peer) ? autoSendRank(s.autoSentRank?.[peer.id], zone) : null
  if (rank === null || !zone) return
  const pic = await sharePicture()
  // E3: a known person is checked with the basis (their tags and events count); a fresh connection gets the zone's slice only.
  const basis = person ? basisOf(s) : undefined
  const slice = person ? profileFor(s.profile, person, pic, basis) : sliceFor(s.profile, zone, pic)
  const text = slice ? (person ? buildProfileText(APP_URL, s.profile, person, pic, basis) : buildProfileText(APP_URL, s.profile, zone, pic)) : null
  if (!text) return
  await net.sendText(peer, text, Date.now(), undefined, slice!.picture).then(() => { s.autoSentRank = { ...s.autoSentRank, [peer.id]: rank }; save() }, () => undefined)
}

const autoShareToPerson = (p: Person): void => { const peer = st().peers.find((x) => x.id === p.peerId); if (peer) void autoShareProfile(peer, zoneOf(p), p) }

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
    ...chatIo(), doc: document, person: { name: p.name, peerId: p.peerId, reach: primaryReachable(p), theirChannels: p.theirChannels }, S: chatStrings(),
    copy: (text) => copyLink(text, S.chatCopied), open: (url) => { window.open(url, '_blank', 'noopener,noreferrer') },
    isOnline: () => relayStatus === 'connected', context: open.re ?? null, scrollTo: open.scrollTo, onDraft: () => thoughtOf(p),
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
  channels = shownChannels(s.showMessengerLinks, channels)
  for (const ch of channels) settings = withTick(settings, ch, true)
  const built = buildContactPayload(APP_URL, Object.fromEntries(channels.map((ch) => [ch, s.myChannels?.[ch]])), settings)
  if (built) net.sendText(peer, contactText(APP_URL, built.payload)).catch(() => { /* the person asks again */ })
}

/** Wave 9: a paired person asks for my links. Ticked ones go at once, saved-unticked ones are asked one by one, the rest is silence. */
function onContactRequest(peer: Peer, text: string): void {
  const s = st()
  const asked = parseRequestText(APP_URL, text)
  const wanted = asked && shownChannels(s.showMessengerLinks, asked)
  const person = s.people.find((p) => p.peerId === peer.id)
  if (!wanted?.length || !person || noSendTo(peer)) return
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
  return peer ? el('div', {}, [el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-send-profile': p.id, onclick: () => sendProfileTo(peer) }, [S.profSendTo(p.name)]), shareExpiryLine()]) : null
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
  const who = personOf(s.people, peer.id)
  if (who) touchFromSync(s, { personId: who.id, at: r.message.sentAt }, now)
  save()
  if (isBlocked(personOf(s.people, peer.id))) return
  if (openChat?.peerId === peer.id) { openChat.refresh(); return }
  // Wave 24: the first chat notification a device shows carries "Turn these off" (notify_first.ts); a card in the Web stack is no notification.
  const inCard = screen === Screen.Web && !queryOpen && !sheet.classList.contains('on')
  const offer = wantsKind(s, 'chat') && (document.hidden || !inCard) && firstChatNotice(window.localStorage)
  notify('chat', S.chatNotifBody(peer.displayName), offer)
  newMessageNotice(peer, r.message.key, offer)
}

/**
 * Wave 6i: "New message from <name>", tappable, with an underlined "open" on its right. On the Web screen it is a card in the stack
 * above the rings (it stays until read); anywhere else (or under an open sheet or dock) a notice of its own for a few seconds. Both open
 * the chat at that message.
 */
function newMessageNotice(peer: Peer, key: string, offerOff = false): void {
  const person = personOf(st().people, peer.id)
  const sheetOpen = sheet.classList.contains('on')
  drawCardStack()
  if (screen === Screen.Web && !queryOpen && !sheetOpen) return
  const title = S.chatNewToast(person?.name ?? peer.displayName)
  // Review 6i (card_stack.ts msgNoticePlace): never over a control: not over the consent prompt, at the top over an open sheet.
  const place = msgNoticePlace(overlay.classList.contains('on'), sheetOpen)
  if (place === NoticePlace.None) { toast(title); return }
  showMsgNotice(title, person ? () => chatSheet(person.id, { scrollTo: key }) : null, place, offerOff)
}

function showMsgNotice(title: string, open: (() => void) | null, place: NoticePlace, offerOff = false): void {
  const openIt = (): void => { hideMsgNotice(); open?.() }
  msgNoticeEl.replaceChildren(
    el('span', { class: 'msg-notice-text' }, [title]),
    ...(open ? [el('button', { class: 'stack-open', type: 'button', 'data-card-open': 'message', 'aria-label': S.cardOpenAria(title), onclick: openIt }, [S.cardOpen])] : []),
    ...(offerOff ? [el('button', { class: 'stack-open', type: 'button', 'data-chat-notif-off': '', onclick: turnChatNotificationsOff }, [S.chatNotifOff])] : []),
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
  // Wave 27: a forget request is honoured from anyone, a blocked person too (it only removes what they shared); its ack still never goes to them.
  if (kind !== TextKind.Chat && kind !== TextKind.Forget && isBlocked(personOf(st().people, peer.id))) return
  switch (kind) {
    case TextKind.Share: onSharedText(peer, text); return
    case TextKind.Contact: onContactText(peer, text); return
    case TextKind.ContactRequest: onContactRequest(peer, text); return
    case TextKind.Keep: onKeepText(peer, text); return
    case TextKind.Hello: onHelloText(peer, text); return
    case TextKind.Profile: onProfileText(peer, text, pic); return
    case TextKind.Agreement: onAgreementText(peer, text); return
    case TextKind.Forget: onForgetText(peer, text); return
    case TextKind.Support: onSupportText(peer, text); return
    case TextKind.Chat: onChatText(peer, text, ts, re); return
    case TextKind.Ignore: return
  }
}

/** Wave 32 (support_ask.ts): an ask for support from a connected person (a calm card on Web), or their "I'm here" to mine. */
function onSupportText(peer: Peer, text: string): void {
  const s = st()
  const ask = parseSupportText(APP_URL, text)
  const person = personOf(s.people, peer.id)
  if (ask) {
    if (!person || ask.until <= Date.now()) return
    s.supportIn = addSupportIn(s.supportIn, { ...ask, peerId: peer.id }, Date.now())
    save()
    toast(S.supportGotOne(person.name))
    if (screen === Screen.Web) render()
    return
  }
  const id = parseHereText(APP_URL, text)
  if (id && recordHere(s.supportAsks ?? [], id, peer.id, Date.now())) { save(); if (screen === Screen.Web) render() }
}

/** Wave 27 (forget.ts): the sender owns what it shared here, so its forget request is accepted as is, then acknowledged. */
function onForgetText(peer: Peer, text: string): void {
  const m = parseForgetText(APP_URL, text)
  if (!m) return
  if (m.op === 'forget-ack') {
    if (noteForgetAck(st(), peer.id, Date.now())) { save(); sovereign.refresh() }
    return
  }
  const n = applyForget(st(), peer.id)
  save()
  render()
  toast(S.sov.forgotBy(personOf(st().people, peer.id)?.name ?? peer.displayName, n))
  net.sendText(peer, forgetText(APP_URL, { op: 'forget-ack', ts: m.ts })).catch(() => { /* they ask again */ })
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
    infoNote(S.askAgainHint),
  ])
}

// ---------------------------------------------------------------------------
// record: the raised middle tab. Solo by default, laid out like Tana mobile's
// voice memo: circle and clock, an "About" row where Tana shows Destination,
// then discard / pause / send. Top right: Meeting.
// ---------------------------------------------------------------------------

/** Drives the record pulse (circle + tab) from the live microphone level until the take ends; the CSS reads --lvl. */
function startLevelMeter(): void {
  if (levelFrame) return
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const tick = (): void => {
    if (!recorder.live) { levelFrame = 0; return }
    const spread = reduced ? PULSE_IDLE_PX : pulseSpreadPx(recorder.level())
    for (const n of document.querySelectorAll<HTMLElement>('.rec-circle.live, .tab-record.live')) n.style.setProperty('--pulse-px', `${spread.toFixed(1)}px`)
    levelFrame = requestAnimationFrame(tick)
  }
  levelFrame = requestAnimationFrame(tick)
}

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
  recStartState = 'idle'
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
  recStartState = recStartNext(recStartState, 'stopped')
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
  recStartState = recStartNext(recStartState, 'tap')
  recNotice = ''
  render()
  try {
    await recorder.start(onTake)
  } catch (err) {
    recStartState = recStartNext(recStartState, 'rejected')
    recNotice = recStartFailure(err)
    render()
    return false
  }
  recStartState = recStartNext(recStartState, 'granted')
  startTicker()
  startLevelMeter()
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
    if (!v) { none(); return }
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
  isPhone: () => currentLayout() === 'mobile',
  codeDeps: () => (connectEligible() && canRegister(SERVER_ORIGIN)
    ? { origin: SERVER_ORIGIN, fetch: (input, init) => fetch(input, init), now: () => Date.now(), state: st, save }
    : null),
  connectLink: async () => { await net.start(); return net.connectLink(CONNECT_URL) },
  editLink: () => openLinkChange(linkHooks),
  afterSyncNow: () => void pollNotesRelay(),
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
  setRing: (id, ring) => placePerson(id, ring, false),
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
  softDeletePerson: (person) => {
    if (!state) return
    if (!state.people.some((x) => x.id === person.id)) state.people.push(person)
    web.deleteReversibly([state.people.find((x) => x.id === person.id)!])
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
  // A12: the person page of the Curator shows the Connect panel and the messenger links of the phone card.
  connectLink: async () => { await net.start(); return net.connectLink(CONNECT_URL) },
  setLinks: (id, links) => {
    const p = state?.people.find((x) => x.id === id)
    if (!p) return
    if (links) p.links = links; else delete p.links
    save()
  },
  showRings: () => { closeSheet(); if (screen !== Screen.Web) go(Screen.Web) },
  // The class stays through a close: the Desk is still mounted and does not announce itself again on the next open (the CSS needs .on and data-kind=curator).
  viewChanged: (view) => { curatorFace = view; applyDeskWide() },
  // The Desk's Web page: the same rings as the Web screen, from the same record (so the shared geometry singletons hold the same values).
  renderRings: (o) => web.ringsView(shown(st(), curatorHiddenIds()), askMarks(), o),
  // Wave 19: the Desk's profile button (top right) replaces the sheet's "× Home" on a wide tab.
  renderProfile: profileEditor,
  myPicture: () => ownPictureUrl,
  closeDesk: closeSheet,
  showPhoneVersion,
})
const web = createWebView({
  st, save, render, toast, showNotice, hideNotice, curator, openWebPage, toggleCardExpanded, editNameSheet, addPersonSheet, openHint, hintHidden, touchUi,
  curatorPerson, mergeSheet: solo ? null : (a, b) => devices.mergeSheet(a, b), mergeNow: solo ? null : (k, d) => devices.mergeNow(k, d), dummyChip, avatar, pictured, ownPictureUrl: () => ownPictureUrl, demoPhone, changeRing, ripple, tagFilter: () => tagFilter, currentLayout, openSheet, closeSheet, solo, removePerson: deletePerson,
})
const eventsBy = (): EventBy | undefined => (st().me.displayName ? { name: st().me.displayName, ...(st().identity?.did ? { did: st().identity?.did } : {}) } : undefined)
const undoNotice = (title: string, onUndo: () => void): void =>
  showNotice(title, '', [el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-event': '', onclick: () => { hideNotice(); onUndo() } }, [S.eventsUndo])], 30000)
const eventsView = createEventsView({
  state: st, save, header, leave: () => go(Screen.Web), redraw: render, curatorPerson, avatar,
  undoNotice,
  newId: () => randomId(8), copyLink, joinLink, origin: linkOrigin(location.origin),
  by: eventsBy,
  showQr: (ev) => eventQr(ev),
  extra: (ev) => [cal, coNotes].flatMap((m) => m?.eventSection?.(ev) ?? []),
  openInvitation: (i) => invitationSheet(invitationIo(), i),
})
const extHooks: ExtHooks = {
  state: st, save, redraw: render, header, leave: () => go(Screen.Web), newId: () => randomId(8), boot: { hash: bootHash, search: bootSearch },
  openEvent: (id) => { eventsView.open(id); if (screen === Screen.Events) render(); else go(Screen.Events) },
  addEvent: (fromIso) => eventsView.openForm(fromIso),
  showList: () => eventsView.showList(),
  avatar,
  undo: undoNotice,
  notify: notifyKind,
  atEventChanged: () => { if (!draftInProgress()) draft.eventId = eventForDraft(st()) },
  openItem: (id) => { closeSheet(); itemSheet(id) },
  openCalendar: () => { closeSheet(); go(Screen.Events) },
  eventLink: (ev) => encodeEventLink(ev, linkOrigin(location.origin), 'peer', revealedBy(eventsBy(), ev)),
  sheet: openSheet, closeSheet, toast: (msg) => toast(msg), origin: linkOrigin(location.origin),
  me: () => ({ name: st().me.displayName, ...(st().identity?.did ? { did: st().identity?.did } : {}) }),
  sendInvite: async (personId, text) => {
    const peerId = st().people.find((p) => p.id === personId)?.peerId
    const ok = peerId ? await submitText(chatIo(), peerId, text) : false
    toast(ok ? S.cal.inviteSent : S.chatOffline)
    return ok
  },
  page: (title, body, mark) => pages.open(title, body, mark),
  backupNow: () => backup.backUpNow(),
  openPerson: openCardPage,
  didOf: (id) => { const p = st().people.find((x) => x.id === id); return p ? relayDidOf(p) : undefined },
  relay: () => (state?.identity && relayOn() ? { deps: relayDeps(), identity: deserializeIdentity(state.identity) } : null),
  relayDeps: () => (relayOn() ? relayDeps() : null),
  connectTo: connectToNoteOwner,
  joinEventLink: (link) => { const ev = decodeEventLink(link.slice(Math.max(0, link.indexOf('#')))); if (!ev) return null; const id = joinEvent(st(), ev, Date.now()); save(); return id },
  openChat: (personId) => chatSheet(personId),
  guestChanged: (show) => { renderTabs(); if (!show) go(Screen.Web); else if (st().coGuest?.eventId) openEvents(st().coGuest?.eventId); else go(Screen.Chat) },
}
// Wave 39: the module registry reads its switches from the record (loaded above); the legacy modules are read once, a switch needs one reload.
// Wave 39 community-mighty: one bus for every module; a module asks the app to save, or to open a person's or an event's card.
const twBus = createBus()
twBus.on('save', () => save())
twBus.on('open-person', (id) => { if (typeof id === 'string') openCardPage(id) })
twBus.on('open-event', (id) => { if (typeof id === 'string') extHooks.openEvent(id) })
twBus.on('import-contacts', (d) => { const x = d as { contacts: ImportedContact[]; name: string }; offerContacts({ state: st, save, toast: (msg) => toast(msg), changed: render, pages }, x.contacts, x.name) })
// wave 40 photo-rails: what a module may ask of the app (a notice, a page with Back, Back)
twBus.on('toast', (msg) => { if (typeof msg === 'string') toast(msg) })
twBus.on('open-page', (d) => { const p = d as { title: string; body: Node[]; mark: string }; pages.open(p.title, p.body, p.mark) })
twBus.on('back', () => history.back())
function twCtx(): TwCtx {
  return { store: st, strings: S, bus: twBus, navigate: (id) => { if (Object.values(Screen).includes(id as Screen)) go(id as Screen) }, profile: () => profileOf(state?.twSettings), actions: appActions, where: whereNow }
}
bindTw({
  settings: () => state?.twSettings,
  save: (t) => { st().twSettings = t; save() },
  ctx: twCtx,
})

// Wave 40 ai-edit-chat: every step the person can tap, as undoable commands (actions.ts, app_actions.ts). The bar, Variations, Extensions,
// Theme and the Curate page run through them; the assistant proposes the same commands, so whatever a hand can do, it can do too.
const appActions = createActions()
const BAR_PLACES: Partial<Record<AppPlace, BarId>> = { web: 'web', chat: 'chat', people: 'people', resources: 'inventory', events: 'events', feed: 'feed' }
let placeNow: AppPlace | null = null
function openAppPlace(place: AppPlace, personId?: string): void {
  placeNow = place
  const bar = BAR_PLACES[place]
  if (bar) { closeSheet(); barOpen(bar); return }
  switch (place) {
    case 'notes': closeSheet(); go(Screen.Notes); break
    // A page (Curate, a card) lies above the sheets: it closes first, so Settings shows.
    case 'settings': closeSheet(); settingsSheet(); break
    case 'variations': case 'extensions': case 'theme': case 'your-ai': closeSheet(); openSettingsAt(PLACE_TARGET[place]); break
    case 'import': openServicesImport(importHooks()); break
    case 'curate': curateImportPage(importHooks()); break
    case 'person': if (personId) openCardPage(personId); break
  }
}
/** "Bring me there": the place the assistant opened pulses for a moment (styles.css .tw-pulse). */
function pulse(selector: string): void {
  const t = document.querySelector<HTMLElement>(selector)
  if (!t) return
  t.scrollIntoView({ block: 'center', behavior: 'smooth' })
  t.classList.remove('tw-pulse')
  void t.offsetWidth
  t.classList.add('tw-pulse')
  window.setTimeout(() => t.classList.remove('tw-pulse'), 2600)
}
function whereNow(): string {
  if (sheet.classList.contains('on')) return `${sheet.dataset.kind ?? 'a sheet'} (sheet)`
  const page = [...phone.querySelectorAll<HTMLElement>('[data-page]')].pop()?.dataset.page
  return page ? `${page} (page over ${screen})` : screen
}
/** Wave 40: a bottom-bar tap on a place goes through "open" (the assistant sees it among the recent steps). */
function tapBar(id: BarId): void {
  const place = (Object.keys(BAR_PLACES) as AppPlace[]).find((p) => BAR_PLACES[p] === id)
  if (place) appActions.do('open', { place }); else barOpen(id)
}
let variationTokens: string[] = []
let lookBeforeVariation: Look | null = null
/** A variation made by the assistant: its look and its design-token overlay (inline on <html>); leaving it takes both off again. */
function applyVariation(): void {
  const cur = state?.twSettings?.custom?.find((c) => c.id === profileOf(state?.twSettings))
  for (const k of variationTokens) document.documentElement.style.removeProperty(k)
  variationTokens = Object.keys(cur?.tokens ?? {})
  for (const [k, v] of Object.entries(cur?.tokens ?? {})) document.documentElement.style.setProperty(k, v)
  if (cur?.look) { lookBeforeVariation ??= readLook(localStorage); applyLook(cur.look, document.documentElement, localStorage) }
  else if (lookBeforeVariation !== null) { applyLook(lookBeforeVariation, document.documentElement, localStorage); lookBeforeVariation = null }
}
const settingsShown = (): boolean => sheet.classList.contains('on') && sheet.dataset.kind === 'settings'
defineAppActions(appActions, {
  state: st, save, changed: render,
  open: openAppPlace,
  place: () => placeNow,
  tap: (selector) => {
    const t = document.querySelector<HTMLElement>(selector)
    if (!t) return null
    t.click()
    return (t.textContent ?? '').trim().slice(0, 60)
  },
  tags: loadColourTags, saveTags: saveColourTags,
  tagOf: (x) => ensureTags({ state: st }, [x]),
  look: () => readLook(localStorage),
  setLook: (l) => { applyLook(l, document.documentElement, localStorage); if (settingsShown()) settingsSheet() },
  profile: () => profileOf(state?.twSettings),
  setProfile: chooseProfile,
  modules: () => listModules().map((m) => m.id),
  defaults: () => Object.fromEntries(listModules().map((m) => [m.id, m.enabledByDefault])),
  isEnabled,
  setExtension: (id, on) => { void twRegistry.setEnabled(id, on).then(twChanged) },
  setting: (k) => (k === 'system-tags' ? showSystemTags() : k === 'chats-hidden' ? Boolean(st().chatsHidden) : readTheme(localStorage) === 'dark'),
  setSetting: (k, on) => {
    if (k === 'system-tags') setShowSystemTags(on)
    else if (k === 'chats-hidden') { st().chatsHidden = on; if (on) st().chatsHiddenAt = Date.now(); else delete st().chatsHiddenAt; save() }
    else applyTheme(on ? 'dark' : 'light', document.documentElement, localStorage)
    render(); if (settingsShown()) settingsSheet()
  },
  saveTw: (tw) => { st().twSettings = tw; save(); void twRegistry.sync().then(twChanged) },
  newId: () => randomId(8),
  now: () => Date.now(),
})
appActions.onRun((a, by) => {
  if (by === 'assistant' && a.type === 'open') window.setTimeout(() => pulse(PLACE_TARGET[(a.args as { place: AppPlace }).place]), 120)
})
const extOn = EXT_MODULES.filter((m) => isEnabled(m.id))
const cal = extOn.find((m) => m.id === 'calendar')?.screen(extHooks)
const coNotes = extOn.find((m) => m.id === 'co-notes')?.screen(extHooks)
/** Wave 27: the messengers extension modules add to the Chat screen's Extend. */
const messengers = extOn.flatMap((m) => (m.messenger ? [m.messenger(extHooks)] : []))

const feed = createFeedView({
  state: st, save, openSheet, closeSheet, toast, images, avatar, dummyChip, personSheet: openCardPage, itemSheet,
  openShare: (id) => { const r = st().received?.find((x) => x.id === id); const l = r ? parseShareText(APP_URL, r.link) : null; if (r && l) void openShare(l, r) },
  openMeeting: (id) => { const m = pastMeetings(st()).find((x) => x.id === id); if (m) pastMeetingSheet(m) },
  redrawFeed: () => { if (screen === Screen.Feed) render() },
  tabsChanged: () => { renderTabs(); if (screen === Screen.Feed && !feedOn(st())) screen = Screen.Web; render() },
  settings: settingsSheet,
  openSharePage: (itemId) => pages.open(S.sharePageTitle, [sharePageBody({ state: st, save, toast, page: (title, body, mark) => pages.open(title, body, mark), close: () => history.back() }, itemId)], 'share-page'),
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
const pastMeetingsLink = (solo = false): HTMLElement => past.link(solo)
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

function maybeOpenPendingBook(): void {
  if (!pendingBook || !state) return
  const hash = pendingBook
  pendingBook = ''
  cal?.openLink?.(hash)
}

/** A pasted event link (the whole URL or just its fragment): opens the join sheet. */
function joinLink(text: string): boolean {
  const hash = text.slice(Math.max(0, text.indexOf('#')))
  const intro = decodeIntroLink(hash)
  if (intro) { pendingIntro = intro; maybeOpenPendingIntro(); return true }
  const ev = decodeEventLink(hash)
  if (!ev) return false
  pendingEvent = ev
  maybeOpenPendingEvent()
  return true
}

/** Wave 33: "Introduce" hands the person a message for the target (the asker's connect link inside when the link carried one) and opens their chat when the target is in the web. */
function introduceHandoff(l: IntroLink): void {
  copyLink(introDraft(l), S.introDraftCopied)
  const target = st().people.find((p) => p.name.trim().toLowerCase() === l.target.toLowerCase())
  if (target) chatSheet(target.id)
}

/** An intro link opened: the "Intro request" card, whatever this web holds. */
function maybeOpenPendingIntro(): void {
  if (!pendingIntro || !state) return
  const l = pendingIntro
  pendingIntro = null
  openSheet([introCard(l, { introduce: () => { closeSheet(); introduceHandoff(l) }, notNow: closeSheet, decline: closeSheet })])
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
        // Wave 39 review: a profile or the Extensions list may have switched the Events module off; "turn on" turns that on too (kept per profile).
        onclick: () => { setFeature(st(), 'events', true); save(); void (isEnabled('events') ? Promise.resolve() : twRegistry.setEnabled('events', true)).then(() => { renderTabs(); render(); pendingEvent = ev; maybeOpenPendingEvent() }) },
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
  // The organizer's logo, if the server has one: filled in later, the sheet never waits for it (the title stays the link's own name).
  const logoSlot = ev.srv ? el('div', { 'data-org-logo': '' }) : null
  if (logoSlot && ev.srv) {
    void loadPublic(ev.srv).then((pub) => {
      if (!pub?.logo || !logoSlot.isConnected) return
      logoSlot.replaceChildren(el('img', { src: pub.logo, alt: pub.name, style: 'max-height:64px;max-width:100%;object-fit:contain;display:block;margin:0 auto 8px' }))
    })
  }
  openSheet([
    logoSlot,
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
  Object.assign(draft, resolveAbout(draft.name, draft.plain))
  serverAfterTake()
  void makeNotes()
}

/** The "For the people at <event> ×" chip of a draft started at an event (calendar module); one tap drops the tag. */
const recEventChip = (): HTMLElement | null =>
  (draft.eventId ? cal?.recordChip?.(draft.eventId, () => { delete draft.eventId; render() }) : null) ?? null

function screenRecord(): Node[] {
  const live = recorder.live
  const paused = recorder.paused
  // Icon only, in the slot ⋮ has on Web, so the QR keeps its exact place (owner 2026-10-06: muscle memory).
  const meeting = withHint(iconButton('meet', S.recMeeting, () => { if (!live) { draft.mode = RecordMode.Meeting; recNotice = ''; go(Screen.Meeting) } else toast(S.recSwitchWhileLive) }, 'meet-btn'), HintId.Meeting)
  const has = takes.length > 0
  const asking = recStartState === 'requesting'
  const circle = el('button', {
    class: 'rec-circle' + (live && !paused ? ' live' : '') + (paused ? ' paused' : '') + (asking ? ' requesting' : ''),
    'aria-label': live ? (paused ? S.recResume : S.recPause) : S.recStart,
    // Pressed state at once (pointerdown), before the microphone prompt answers.
    onpointerdown: (e: Event) => (e.currentTarget as HTMLElement).classList.add('pressed'),
    onclick: () => { if (live) togglePause(); else if (!asking) void startSolo() },
  })
  circle.innerHTML = icon(live && !paused ? 'pause' : 'mic')
  const status = asking ? S.recAsking : live ? (paused ? S.recPausedHint : S.recLive) : has ? S.recDone(clock(totalMs()), takes.length) : S.recIdle
  if (pastSearchOpen) return [header(S.recTitle, { right: pastSearchButton(), after: meeting, pill: false }), pastSearchView()]
  return [
    header(S.recTitle, { right: pastSearchButton(), after: meeting, pill: false }),
    el('div', { class: 'scroll pad memo' }, [
      recEventChip(),
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
      pastMeetingsLink(true),
    ]),
    el('div', { class: 'memo-controls' }, [
      // The circle above records, pauses and resumes (owner 2026-10-06: no separate play button).
      roundButton('x', S.recDiscard, discardDraft, { disabled: !live && !has && !draft.name.trim() && !draft.generalNotes.trim() && !draft.plain, data: 'data-record-discard' }),
      roundButton('save', S.recSave, () => void sendSolo(), { disabled: !live && !has && !draft.extraLines.length && !draft.generalNotes.trim(), data: 'data-record-send' }),
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
      recEventChip(),
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
  Object.assign(draft, resolveAbout(draft.name, draft.plain))
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

/** The "Short link" line of Meet (short_alias.ts): the alias is made once per identity, kept in the record, and told to the host (once per visit) with the connect code's secret. */
function ownAliasLine(): HTMLElement {
  const line = createAliasLine(copyLink)
  const did = st().identity?.did
  if (!did || !connectEligible()) return line.el
  const made = ensureOwnAlias(st().aliases ?? {}, did, Date.now())
  if (made.created) { st().aliases = made.aliases; save() }
  const show = (): void => line.set(aliasUrl(new URL(SERVER_ORIGIN).host, made.token), !!st().aliases?.[made.token]?.registeredAt)
  show()
  const record = readConnectRecord(st().connectCode)
  const entry = st().aliases?.[made.token]
  if (record && entry && !aliasAsked.has(made.token)) {
    aliasAsked.add(made.token)
    void registerAlias({ origin: SERVER_ORIGIN, fetch: (input, init) => fetch(input, init), now: () => Date.now() }, record, made.token, entry).then((ok) => {
      if (!ok) { aliasAsked.delete(made.token); return }
      entry.registeredAt = Date.now()
      save()
      show()
    })
  }
  return line.el
}
/** Tokens already told to the host this visit. */
const aliasAsked = new Set<string>()

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
    const viaShown = via && messengerLinksShown(st()) ? via : null
    publicVia.hidden = !viaShown
    publicVia.textContent = viaShown ? S.publicLinkOffers(reachOutLink(), S.chLabel[viaShown]) : ''
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
    askMore: async (reason, wanted) => {
      const record = readConnectRecord(st().connectCode)
      return record ? sendCapRequest({ origin: SERVER_ORIGIN, fetch: (input, init) => fetch(input, init), now: () => Date.now() }, record, reason, wanted) : 'failed'
    },
    toast: toastShow,
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
    ownAliasLine(),
    advanced.el,
    el('h4', { class: 'eyebrow' }, [S.meetWaysTitle]),
    el('p', { class: 'meta', 'data-ways': 'now' }, [S.meetWaysNow]),
    el('p', { class: 'meta', 'data-ways': 'soon' }, [S.meetWaysSoon]),
    el('p', { class: 'meta', 'data-ways': 'later' }, [S.meetWaysLater]),
    // Where the browser can write a tag (Chrome on Android), the link can go onto one; phone to phone stays "later".
    nfc,
    nfc ? nfcStatus : null,
    seeInActionFoot(),
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
      recEventChip(),
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
      ...(draft.eventId ? { eventId: draft.eventId } : {}),
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
      ...(draft.eventId ? { eventId: draft.eventId } : {}),
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
    ...ownEmailLines(s.me.primaryEmail),
    // Tapped in the Web view: a line, then the section for the web itself.
    ...(fromWeb ? [
      el('hr', { class: 'sheet-line' }),
      el('h4', { class: 'eyebrow' }, [S.myWebTitle]),
      el('button', { class: 'btn btn-ghost', 'data-space-out': 'all', onclick: () => { closeSheet(); web.spaceOutWeb() } }, [S.ringsSpaceAll]),
    ] : []),
  ])
  name.focus()
  name.select()
}

/** Wave 33: the own card shows the primary email (local only) with a compose link and the sender hint. */
function ownEmailLines(e: PrimaryEmail | undefined): Node[] {
  if (!e) return []
  return [el('p', { class: 'meta own-email', 'data-own-email': '1' }, [
    `${e.address} · `, el('a', { href: composeHref(e), target: '_blank', rel: 'noopener noreferrer', 'data-own-email-compose': '1' }, [S.primaryEmailOpenIn(providerLabel(e.provider))]),
    el('br'), senderHint(e),
  ])]
}

/** Wave 33: Settings > You > Primary email address: provider list (owner order) + address. */
function editEmailSheet(): void {
  const s = st()
  const cur = s.me.primaryEmail
  let provider = cur?.provider ?? PROVIDERS[0].id
  let picked = Boolean(cur)
  const address = el('input', { class: 'field', type: 'email', autocomplete: 'email', 'aria-label': S.setPrimaryEmailAddress, value: cur?.address ?? '', 'data-email-address': '1' })
  const list = el('div', { class: 'radios' }, [])
  const draw = (): void => {
    list.replaceChildren(...PROVIDERS.map((p) => el('button', {
      class: 'radio' + (p.id === provider ? ' on' : ''), 'aria-pressed': String(p.id === provider), 'data-email-provider': p.id,
      onclick: () => { provider = p.id; picked = true; draw() },
    }, [el('b', {}, [p.label])])))
  }
  draw()
  // Typing an address nobody picked a provider for guesses it from the domain.
  address.addEventListener('input', () => { if (!picked) { provider = guessProvider(address.value); draw() } })
  const saveEmail = (): void => {
    const a = validateEmail(address.value)
    if (!a) { toast(S.setPrimaryEmailBad); address.focus(); return }
    s.me.primaryEmail = { provider, address: a }
    save(); closeSheet(); settingsSheet(); toast(S.setPrimaryEmailSaved)
  }
  address.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') saveEmail() })
  openSheet([
    el('h3', {}, [S.setPrimaryEmail]),
    list, address,
    el('p', { class: 'meta' }, [S.setPrimaryEmailHint]),
    el('p', { class: 'meta' }, [S.setPrimaryEmailSenderNote]),
    el('button', { class: 'btn btn-electric', 'data-email-save': '1', onclick: saveEmail }, [S.setPrimaryEmailSave]),
    ...(cur ? [el('button', { class: 'btn btn-ghost', 'data-email-clear': '1', onclick: () => { delete s.me.primaryEmail; save(); closeSheet(); settingsSheet(); toast(S.setPrimaryEmailCleared) } }, [S.setPrimaryEmailClear])] : []),
  ])
  address.focus()
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

const linkHooks = {
  names: () => namesSync().names(),
  claim: (name: string) => namesSync().claim(name, false),
  openSheet, closeSheet, toast, settings: () => settingsSheet(),
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
function settingsSection(key: string, title: string | (Node | string)[], children: (Node | null)[], first = false): Node | null {
  if (!children.some(Boolean)) return null
  const attrs: Record<string, string> = { 'data-settings-section': key, class: 'settings-adv' }
  if (key === 'advanced') attrs['data-settings-advanced'] = '1'
  const d = el('details', attrs, [el('summary', { class: 'adv-toggle' }, Array.isArray(title) ? title : [title]), ...children]) as HTMLDetailsElement
  const k = `trustweb.ui.settings.${key}`
  try { const v = localStorage.getItem(k); d.open = v === null ? first : v === '1' } catch { d.open = first }
  d.addEventListener('toggle', () => { try { localStorage.setItem(k, d.open ? '1' : '0') } catch { /* ignore */ } })
  return d
}

/** Wave 39: a profile or module switch changed: the bottom row, the screen and Settings follow; modules read once at load ask for one reload. */
function twChanged(): void {
  document.body.dataset.twProfile = profileOf(state?.twSettings)
  applyVariation()
  const s = st()
  if ((screen === Screen.Inventory && !featureOn(s, 'inventory')) || (screen === Screen.Events && !featureOn(s, 'events')) || (screen === Screen.Feed && !feedOn(s))) screen = Screen.Web
  if (screen === Screen.Ext && !twRegistry.views().some((v) => v.id === extViewId)) screen = Screen.Web
  renderTabs(); render(); settingsSheet()
  if (twRegistry.needsReload().length) toast(S.ext.reload)
}

function chooseProfile(id: ProfileId): void {
  void twRegistry.setProfile(id).then(() => {
    const preset = profileDef(id, st().twSettings).barPreset
    if (preset) { st().uiBar = applyProfile(st().uiBar, preset); save() }
    twChanged()
  })
}

/** Wave 39: Settings > Variations (above General): Dex (moved here from the view row) and the profiles; the current one is marked. */
function variationRows(s: AppState): Node[] {
  const cur = profileOf(s.twSettings)
  return [
    el('p', { class: 'meta' }, [S.var.hint]),
    el('button', { class: 'radio variation', 'data-variation': 'dex', onclick: () => showDesktopVersion(UiView.Dex) }, [el('b', {}, [S.var.dex]), el('small', {}, [S.var.dexHint])]),
    el('p', { class: 'meta view-dex-info', 'data-dex-info': '' }, [el('a', { href: DEX_URL, target: '_blank', rel: 'noopener' }, [S.views.dexInfo])]),
    ...TW_PROFILES.map((p) => el('button', {
      class: 'radio variation' + (p.id === cur ? ' on' : ''), role: 'radio', 'aria-checked': String(p.id === cur), 'data-variation': p.id, onclick: () => appActions.do('set-profile', { profile: p.id }),
    }, [el('b', {}, [(p.id === cur ? '✓ ' : '') + S.var.names[p.id]]), el('small', {}, [S.var.hints[p.id] + (p.id === cur ? ` · ${S.var.current}` : '')])])),
    // Wave 40 ai-edit-chat: variations made by talking to the assistant.
    ...(s.twSettings?.custom ?? []).map((c) => el('button', {
      class: 'radio variation' + (c.id === cur ? ' on' : ''), role: 'radio', 'aria-checked': String(c.id === cur), 'data-variation': c.id, onclick: () => appActions.do('set-profile', { profile: c.id }),
    }, [el('b', {}, [(c.id === cur ? '✓ ' : '') + c.name, ' ', alphaSub()]), el('small', {}, [S.var.names[c.base] + (c.id === cur ? ` · ${S.var.current}` : '')])])),
  ]
}

/** Wave 39: Settings > General > Extensions: one switch per module with its one line; heavy ones say they load only when on. */
function extensionRows(): Node[] {
  return [
    el('p', { class: 'meta' }, [S.ext.hint]),
    ...twRegistry.listModules().map((m) => {
      const on = isEnabled(m.id)
      return el('button', {
        class: 'radio' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-pressed': String(on), 'data-ext-module': m.id,
        onclick: () => appActions.do('set-extension', { module: m.id, on: !on }),
      }, [el('b', {}, [m.title]), el('small', {}, [[m.description, m.heavy ? S.ext.heavy : ''].filter(Boolean).join(' · ')])])
    }),
    ...twRegistry.settingsSections().flatMap((sec) => [el('h4', { class: 'eyebrow' }, [sec.title]), ...sec.rows()]),
    ...(coNotes?.settingsRows?.() ?? []),
  ]
}

/** Group ids that stay open across the redraws a toggle causes; reset to the lead group whenever Settings opens afresh. */
const settingsOpen = new Set<string>()
/** Wave 37: what the Settings search field holds; kept over the redraws a toggle causes. */
let settingsQuery = ''

/** Wave 27: the groups in `order`; the first opens, the rest are folded. An empty group is not drawn. */
function settingsGroups(groups: Record<SettingsSection, (Node | null)[]>, order: SettingsSection[]): (Node | null)[] {
  if (!(sheet.classList.contains('on') && sheet.dataset.kind === 'settings')) { settingsOpen.clear(); settingsOpen.add(order[0]) }
  return order.map((id) => {
    if (!groups[id].some(Boolean)) return null
    const d = el('details', { class: 'settings-group', 'data-settings-group': id }, [
      el('summary', { class: 'settings-group-title' }, [S.setGroup[id]]),
      ...groups[id],
    ]) as HTMLDetailsElement
    d.open = settingsOpen.has(id)
    d.addEventListener('toggle', () => { if (d.open) settingsOpen.add(id); else settingsOpen.delete(id) })
    return d
  })
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

/** Dev only (Settings > Advanced): "Edits kept: N (since <date>)", filled once the dev server answers. */
function editStreamLine(): HTMLElement {
  const p = el('p', { class: 'meta', 'data-edit-stream-count': '' }, [S.editsKept(0, null)])
  void fetchEditStream().then((i) => { if (i) p.textContent = S.editsKept(i.count, i.since ? new Date(i.since).toLocaleDateString('sv') : null) })
  return p
}

/** Settings > Bottom row: one button into the ⋮ sheet, where the row is arranged (wave 31; the old per-slot pickers are archived in DEVLOG/wave31/archive/bottom-bar). */
function tabRowSettings(): (Node | null)[] {
  return [el('button', { class: 'btn btn-ghost', 'data-settings-bar': '', onclick: barSheet }, [S.barOpenSettings])]
}

function settingsSheet(): void {
  const s = st()
  if (sheet.dataset.kind !== 'settings') settingsQuery = ''
  // What the Swiss server has switched on drives the wording; asked once, the sheet redraws with the answer.
  if (swiss.enabled() && swiss.status() === undefined) void swiss.probe().then(() => { if (sheet.dataset.kind === 'settings') settingsSheet() })
  const demoSettingsShown = !solo && (Boolean(s.demo) || !runsAsInstalledApp())
  const groups: Record<SettingsSection, (Node | null)[]> = {
    web: [
    settingsSection('web', S.setSecWeb, [
      el('button', { class: 'btn btn-ghost', 'data-settings-curate': '', onclick: curatorSheet }, [S.searchCurate]),
      archivedPeopleView(s.people, () => { save(); render(); settingsSheet() }),
      importEntry(),
      tagManagerView({ tags: loadColourTags, saveTags: (t) => saveColourTags([...t]), people: () => st().people, toast: (m) => toast(m) }),
      // Wave 39: folded until asked for (settings redraws keep it closed; a tick does not redraw the sheet).
      el('details', { class: 'settings-adv', 'data-pin-views': '' }, [
        el('summary', { class: 'adv-toggle' }, [S.viewPinsTitle]),
        el('p', { class: 'meta' }, [S.viewPinsHint]),
        ...viewMenuEntries({ current: 'rings', hasMap: HAS_MAP_VIEW, pins: s.uiPins?.views }).filter((i) => i.view !== 'map').map((i) => el('label', { class: 'radio', 'data-pin-view': i.view }, [
          el('input', { type: 'checkbox', ...(i.pinned ? { checked: '' } : {}), onchange: () => { s.uiPins = { ...s.uiPins, views: togglePin(s.uiPins?.views, i.view) }; save(); render() } }),
          el('b', {}, [S.viewNames[i.view]]),
        ])),
      ]),
    ]),
    settingsSection('skins', S.setSkins, [
      el('div', { 'data-settings-skins': '' }, [
        el('p', { class: 'meta' }, [S.setSkinsHint]),
        ...skinsFor('network').map((k) => el('button', {
          class: 'radio' + (skinOf(s).id === k.id ? ' on' : ''), role: 'radio', 'aria-checked': String(skinOf(s).id === k.id), 'data-skin': k.id,
          onclick: () => { chooseSkin(s, k.id); save(); render(); settingsSheet() },
        }, [el('b', {}, [k.name]), el('small', {}, [k.description])])),
        el('p', { class: 'meta skins-store', 'data-skins-store': '', 'aria-disabled': 'true', title: S.setSkinsStoreHint }, [S.setSkinsStore, el('small', {}, [S.setSkinsStoreHint])]),
      ]),
    ], true),
    settingsSection('sharing', S.setSecSharing, [...sharingSettings(s, save, settingsSheet), ...zoneLinksSettings(s, save, settingsSheet, { build: buildZoneLink, toast: (m) => toast(m) })]),
    settingsSection('advanced-web', S.setAdvanced, [
    // Wave 28: the Map is an Advanced setting that can be pinned next to the eye.
    HAS_MAP_VIEW ? el('label', { class: 'radio', 'data-pin-view': 'map' }, [
      el('input', { type: 'checkbox', ...(s.uiPins?.views.includes('map') ? { checked: '' } : {}), onchange: () => { s.uiPins = { ...s.uiPins, views: togglePin(s.uiPins?.views, 'map') }; save(); render() } }),
      el('b', {}, [S.mapPinTitle]), el('small', {}, [S.mapPinHint]),
    ]) : null,
    el('h4', { class: 'eyebrow' }, [S.setQuery]),
    ...[QueryStyle.Call, QueryStyle.Search].map((q) => el('button', {
      class: 'radio' + (queryStyle() === q ? ' on' : ''),
      onclick: () => { s.queryStyle = q; save(); render(); settingsSheet() },
    }, [el('b', {}, [S.setQueryLabel[q]]), el('small', {}, [S.setQueryHint[q]])])),
    el('div', { class: 'radio', 'data-theme-setting': '' }, [
      el('b', {}, [S.themeLabel]),
      ...([['system', S.themeSystem], ['light', S.themeLight], ['dark', S.themeDark]] as const).map(([v, label]) => el('button', {
        class: 'btn btn-ghost btn-sm' + (readTheme(localStorage) === v ? ' on' : ''), 'aria-pressed': String(readTheme(localStorage) === v), 'data-theme-choice': v,
        onclick: () => { applyTheme(v as Theme, document.documentElement, localStorage); settingsSheet() },
      }, [label])),
    ]),
    el('button', {
      class: 'radio' + (s.showRingNames ? ' on' : ''),
      'aria-pressed': String(s.showRingNames === true),
      onclick: () => { s.showRingNames = !s.showRingNames; save(); render(); settingsSheet() },
    }, [el('b', {}, [S.setRingNames]), el('small', {}, [S.setRingNamesHint])]),
    el('label', { class: 'radio', 'data-membrane-limit': '1' }, [
      el('b', {}, [S.setMembraneLimit]),
      el('input', {
        class: 'field', type: 'number', min: '1', max: String(LIMIT_MAX), value: String(limitOf(s)), 'aria-label': S.setMembraneLimit,
        // Only a change from the default of 5 is stored; empty or junk leaves it as it was.
        onchange: (e: Event) => {
          const n = parseLimit((e.target as HTMLInputElement).value)
          if (n !== null) { if (n === 5) delete s.membraneLimit; else s.membraneLimit = n; save(); render() }
          settingsSheet()
        },
      }),
      el('small', {}, [S.setMembraneLimitHint(limitOf(s))]),
    ]),
    // Wave 27: how pinned people are ordered; the default (by pin time) is not stored.
    el('div', { class: 'radio', 'data-pinned-order': '' }, [
      el('b', {}, [S.setPinnedOrder]),
      ...(['pinned', 'contact'] as const).map((m) => el('button', {
        class: 'btn btn-ghost btn-sm' + (pinnedModeOf(s) === m ? ' on' : ''), 'aria-pressed': String(pinnedModeOf(s) === m), 'data-pinned-mode': m,
        onclick: () => { if (m === 'pinned') delete s.pinnedOrder; else s.pinnedOrder = m; save(); render(); settingsSheet() },
      }, [S.setPinnedOrderChoice[m]])),
      el('small', {}, [S.setPinnedOrderHint]),
    ]),
    // Wave 25: off unless switched on; the days field shows only while on. Only the days are stored (absent = off).
    el('button', {
      class: 'radio' + (engagementDays(s) ? ' on' : ''), 'aria-pressed': String(engagementDays(s) > 0), 'data-engagement-switch': '1',
      onclick: () => { if (engagementDays(s)) delete s.engagementDays; else s.engagementDays = ENGAGEMENT_DEFAULT_DAYS; save(); settingsSheet() },
    }, [el('b', {}, [S.setEngagement]), el('small', {}, [S.setEngagementHint(engagementDays(s))])]),
    engagementDays(s) ? el('label', { class: 'radio', 'data-engagement-days': '1' }, [
      el('b', {}, [S.setEngagementDays]),
      el('input', {
        class: 'field', type: 'number', min: '1', max: '365', value: String(engagementDays(s)), 'aria-label': S.setEngagementDays,
        // Empty or junk leaves it as it was; 0 switches it off.
        onchange: (e: Event) => {
          const d = parseDays((e.target as HTMLInputElement).value)
          if (d !== null) { if (d === 0) delete s.engagementDays; else s.engagementDays = d; save() }
          settingsSheet()
        },
      }),
    ]) : null,
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
    ]),
    ],
    chat: [
    // Wave 28b: Do Not Disturb lives here, not in the header (it can still be pinned there from Advanced).
    el('button', {
      class: 'radio' + (s.chatsHidden ? ' on' : ''), 'aria-pressed': String(Boolean(s.chatsHidden)), 'data-settings-dnd': '',
      onclick: () => { s.chatsHidden = !s.chatsHidden; save(); render(); settingsSheet() },
    }, [el('b', {}, [S.chatDnd]), el('small', {}, [S.setChatDndHint])]),
    settingsSection('reach', S.reachOutsTitle, solo || s.testOf ? [] : [
      el('button', {
        class: 'radio' + (messengerLinksShown(s) ? ' on' : ''), 'aria-pressed': String(messengerLinksShown(s)), 'data-signal-visible': '1',
        onclick: () => { toggleMessengerLinks(s); save(); settingsSheet() },
      }, [el('b', {}, [S.setMessengerLinks]), el('small', {}, [S.setMessengerLinksHint])]),
      el('button', {
        class: 'radio' + (s.reachOutsPaused ? ' on' : ''), 'aria-pressed': String(Boolean(s.reachOutsPaused)), 'data-reach-outs-pause': '1',
        onclick: () => { if (s.reachOutsPaused) delete s.reachOutsPaused; else s.reachOutsPaused = true; save(); settingsSheet() },
      }, [el('b', {}, [S.reachOutsPause])]),
      el('p', { class: 'meta', 'data-reach-outs-held': '' }, [S.reachOutsHeldCount(s.reachOutHeld ?? 0)]),
      s.reachOutHeld ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { delete s.reachOutHeld; save(); settingsSheet() } }, [S.reachOutsReset]) : null,
      el('p', { class: 'meta' }, [S.reachOutsSettingsHint(reachOutLink())]),
    ]),
    ],
    record: [
    settingsSection('advanced-record', S.setAdvanced, [
    ...recordingSettings(s),
    ...hosting.settingsGroup(),
    ]),
    ],
    events: [
      featureSwitch(s, 'events', S.setFeatEvents, S.setFeatEventsHint),
    ],
    inventory: [
      featureSwitch(s, 'inventory', S.setFeatInventory, S.setFeatInventoryHint),
    settingsSection('sources', S.setSources, sourcesGroup(s)),
    ...(solo ? [] : [importEntry()]),
    settingsSection('advanced-inventory', S.setAdvanced, [
    el('button', {
      class: 'radio' + (asksMatchNotes(s) ? ' on' : ''), 'aria-pressed': String(asksMatchNotes(s)), 'data-notes-match': '1',
      // Stored only when it differs from the default of this account type (notes_source.ts), so a change of default never flips a choice.
      onclick: () => { const next = !asksMatchNotes(s); if (next === notesMatchDefault(s)) delete s.asksMatchNotes; else s.asksMatchNotes = next; save(); settingsSheet() },
    }, [el('b', {}, [S.setNotesMatch]), el('small', {}, [S.setNotesMatchHint])]),
    ]),
    ],
    general: [
    settingsSection('you', S.setSecYou, [
      el('button', { class: 'conn-row name-row', 'aria-label': S.meNameAria(s.me.displayName), onclick: () => editNameSheet() }, [
        el('b', {}, [S.setYourName]), el('span', {}, [s.me.displayName]), el('em', {}, [S.setYourNameEdit]),
      ]),
      el('button', { class: 'conn-row', 'data-primary-email': '1', onclick: () => editEmailSheet() }, [
        el('b', {}, [S.setPrimaryEmail]), el('span', {}, [s.me.primaryEmail ? `${providerLabel(s.me.primaryEmail.provider)} · ${s.me.primaryEmail.address}` : S.setPrimaryEmailNotSet]), el('em', {}, [S.setYourNameEdit]),
      ]),
      linkButton(namesSync().names().name, () => openLinkChange(linkHooks)),
      connectionRow(),
      buildContactBox({}).el,
      el('button', {
        class: 'radio' + (s.profileAutoOff ? '' : ' on'), 'aria-pressed': String(!s.profileAutoOff), 'data-profile-auto': '1',
        // Only "off" is stored: absent means on.
        onclick: () => { if (s.profileAutoOff) delete s.profileAutoOff; else s.profileAutoOff = true; save(); settingsSheet() },
      }, [el('b', {}, [S.profAutoShare]), el('small', {}, [S.profAutoShareHint])]),
      el('button', { class: 'conn-row', 'data-settings-sovereign': '', onclick: () => sovereign.open() }, [el('b', {}, [S.sov.entry]), el('em', {}, [S.sov.entryHint])]),
      exportEntry({ state: st, toast: (msg) => toast(msg), pages }),
    ], true),
    settingsSection('notifications', S.setSecNotify, [notificationsCard(s)]),
    settingsSection('devices', S.setSecDevices, devicesSectionChildren<Node>({
      eligible: connectEligible(), devices: () => devices.settingsGroup(), backupCard: () => (backup.available() === false ? null : backup.card(true)),
    })),
    settingsSection('features', S.setSecFeatures, isEnabled('feed') ? feed.settingsGroup() : []),
    settingsSection('extensions', alphaHeading(S.ext.title), extensionRows()),
    settingsSection('advanced', S.setAdvanced, [
    // Wave 40: flags for parts that are not ready yet.
    el('h4', { class: 'eyebrow' }, [S.flagsTitle]),
    el('p', { class: 'meta' }, [S.flagsHint]),
    el('label', { class: 'radio', 'data-flag-toggle': 'googleConnect' }, [
      el('input', { type: 'checkbox', ...(googleFlagSet(localStorage) ? { checked: '' } : {}), onchange: (e: Event) => { setGoogleConnect(localStorage, (e.target as HTMLInputElement).checked); settingsSheet() } }),
      el('b', {}, [S.flagGoogleConnect]), el('small', {}, [S.flagGoogleConnectHint]),
    ]),
    // Wave 28: what sits beneath Settings in the top bar (Do Not Disturb by default), and the person QR's profile option.
    el('h4', { class: 'eyebrow' }, [S.headerPinsTitle]),
    ...HEADER_PINS.map((id) => el('label', { class: 'radio', 'data-header-pin-toggle': id }, [
      el('input', { type: 'checkbox', ...(headerPins(s.uiPins?.header).includes(id) ? { checked: '' } : {}), onchange: () => { s.uiPins = { views: s.uiPins?.views ?? [], header: togglePinned(s.uiPins?.header, id) }; save(); render() } }),
      el('b', {}, [S.headerPinNames[id]]), el('small', {}, [S.headerPinHint[id]]),
    ])),
    el('label', { class: 'radio', 'data-qr-profile-option': '' }, [
      el('input', { type: 'checkbox', ...(s.qrProfileOption ? { checked: '' } : {}), onchange: () => { s.qrProfileOption = !s.qrProfileOption; save() } }),
      el('b', {}, [S.qrProfileSetting]), el('small', {}, [S.qrProfileSettingHint]),
    ]),
    ...(isEnabled('photos') ? [faceMatchRow(s, save, settingsSheet)] : []),   // wave 40: opt-in, off unless switched on
    ...aiSettings({ state: st, save, toast, openSheet, backToSettings: () => { sheet.dataset.kind = 'settings'; settingsSheet() } }),
    ...agentSettings({ state: st, save }),
    ...askWebSettings({ state: st, save }),
    ...(liveDevActive() ? [el('p', { class: 'meta', 'data-dev-record-live': '' }, [liveSyncedAt(persona) ? S.devRecordSynced(liveSyncedAt(persona)!.toTimeString().slice(0, 5)) : S.devRecordNotYet])] : []),
    ...(liveDevActive() ? [editStreamLine()] : []),
    el('h4', { class: 'eyebrow' }, [S.setTabRow]),
    ...tabRowSettings(),
    el('p', { class: 'meta' }, [S.setTabsHint]),
    ...(solo ? [] : [
      el('h4', { class: 'eyebrow' }, [S.views.layout]),
      ...(['trustweb', 'mobile'] as const).map((l) => el('button', {
        class: 'radio' + (currentLayout() === l ? ' on' : ''), 'aria-pressed': String(currentLayout() === l), 'data-layout': l,
        onclick: () => { setLayout(l); settingsSheet() },
      }, [el('b', {}, [l === 'trustweb' ? S.views.trustweb : S.views.mobile])])),
      el('p', { class: 'meta' }, [S.views.layoutHint]),
    ]),
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
    ...(ownDataBrought() && !solo && !isDemoPersona(persona) && window.top === window ? [
      el('h4', { class: 'eyebrow' }, [S.advancedHelpers]),
      ...(runsAsInstalledApp() ? [] : [el('a', { class: 'btn btn-ghost', 'data-add-device': '', href: APP_URL + 'demo/' }, [S.addDeviceShort])]),
      el('button', { class: 'btn btn-ghost', 'data-see-action': '', onclick: () => { closeSheet(); openWalkthrough() } }, [S.seeInAction]),
    ] : []),
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
    readersBlock({ state: st, save, redraw: settingsSheet, openSheet: (c) => openSheet(c), toast }),
    el('button', {
      class: 'radio' + (birthdayRemindersOn(s) ? ' on' : ''), 'aria-pressed': String(birthdayRemindersOn(s)), 'data-birthday-reminders': '1',
      onclick: () => { s.birthdayReminders = !birthdayRemindersOn(s); save(); settingsSheet() },
    }, [el('b', {}, [S.birthdayRemindersLabel]), el('small', {}, [S.birthdayRemindersHint])]),
    el('div', { 'data-blocked-list': '1' }, [
      el('b', {}, [S.blockedTitle]),
      ...(s.people.some(isBlocked)
        ? s.people.filter(isBlocked).map((b) => el('div', { class: 'conn-row' }, [el('span', {}, [b.name]), blockRow(b)]))
        : [el('p', { class: 'meta' }, [S.blockedNone])]),
    ]),
    el('button', {
      class: 'radio' + (noticesOff(s) ? ' on' : ''), 'aria-pressed': String(noticesOff(s)), 'data-notices-off': '1',
      onclick: () => { setNoticesOff(s, !noticesOff(s)); save(); settingsSheet() },
    }, [el('b', {}, [S.setNoNotices]), el('small', {}, [S.setNoNoticesHint])]),
    ...HINTS.map((id) => el('button', {
      class: 'radio' + (hintHidden(id) ? '' : ' on'),
      'aria-pressed': String(!hintHidden(id)),
      onclick: () => { setHintHidden(id, !hintHidden(id)); render(); settingsSheet() },
    }, [el('b', {}, [S.setHintsOne(S.hintLabel[id])]), el('small', {}, [S.hintText[id]])])),
    ]),
    el('h4', { class: 'eyebrow' }, [S.setTutorial]),
    el('button', {
      class: 'btn btn-ghost', 'data-hints-reset': '', disabled: !(s.hiddenHints?.length),
      onclick: () => { delete s.hiddenHints; save(); render(); settingsSheet() },
    }, [S.setHintsAll]),
    el('p', { class: 'meta' }, [S.setHintsAllHint]),
    installable && !installedHere() ? el('button', { class: 'btn btn-ghost', 'data-open-install': '1', onclick: openInstallSheet }, [S.setInstall]) : null,
    ...apkUpdatesRow(s),
    ...aboutGroup(),
    updateRow(),
    // safetyLink(SafetyPlace.Settings, () => openSheet(safetySheetNodes({ place: SafetyPlace.Settings, back: { label: S.safeBackSettings, go: settingsSheet } }))),
    solo ? null : el('button', {
      class: 'btn btn-ghost',
      onclick: () => {
        if (!confirm(S.resetConfirm)) return
        dropRecording()
        void Promise.all([audioStore.clear(), images.clear(), clearPhotosDb(st().me.id)]).finally(() => { clearState(persona, storeCtx); location.reload() })
      },
    }, [S.resetPhone]),
    ],
  }
  openSheet([
    el('h3', {}, [S.setTitle]),
    el('input', {
      class: 'field', type: 'search', 'data-settings-search': '', placeholder: S.setSearchPh, 'aria-label': S.setSearchAria, autocomplete: 'off', value: settingsQuery,
      oninput: (e) => { settingsQuery = (e.target as HTMLInputElement).value; filterSettings(sheet, settingsQuery) },
    }),
    viewRow(),
    themeRow(),
    apkSettingsRow(apkHintEnv()) ? el('div', { class: 'inst-apk', 'data-apk-settings-hint': '' }, [el('b', {}, [S.apkSettingsTitle]), apkPart(S.apkSettingsShown)]) : null,
    s.testOf ? el('p', { class: 'meta' }, [s.testOf.own ? S.setDemoOfOwn(s.me.displayName) : guestKept(s.testOf) ? S.setDemoKeptOf(s.testOf.name) : S.setDemoOf(s.testOf.name)]) : null,
    s.testOf && demoOfLine(s) ? el('p', { class: 'meta' }, [demoOfLine(s)]) : null,
    keepAskRow(s),
    s.testOf && !s.testOf.handedOverAt ? el('button', { class: 'btn btn-ghost', onclick: handoverSheet }, [S.handTitle]) : null,
    el('div', { 'data-settings-group': 'variations' }, [settingsSection('variations', alphaHeading(S.var.title), variationRows(s), true)]),
    ...settingsGroups({ ...groups, ...(isEnabled('events') ? {} : { events: [] }), ...(isEnabled('resources') ? {} : { inventory: [] }) }, settingsOrder(sectionOfScreen(screen), resolveBar(s.uiBar, barFlags()).ids)),
  ])
  sheet.dataset.kind = 'settings'
  if (settingsQuery) filterSettings(sheet, settingsQuery)
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
// app updates (app_update.ts): /release.json against this build's id
// ---------------------------------------------------------------------------

const updates = createUpdateCheck({
  running: typeof __TW_RELEASE__ === 'string' ? __TW_RELEASE__ : 'dev',
  now: () => Date.now(),
  fetchLatest: async () => {
    const r = await fetch('/release.json', { cache: 'no-store' })
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  },
  // A newer build: reload once per release (at once, unless a recording runs); then the banner is the fallback.
  onNewer: (info) => { if (recorder.live || !shouldReloadOnce(info.release, sessionStorage)) updateBanner.hidden = false; else void reloadNow() },
})
const reloadNow = (): Promise<void> => reloadFresh({ caches: 'caches' in window ? window.caches : undefined, reload: () => location.reload() })
void updates.auto()
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void updates.auto() })

/** Settings: the build's version and date. No update button: the app updates itself on load (reload once on a new release). */
function updateRow(): HTMLElement {
  const builtAt = typeof __TW_BUILT_AT__ === 'string' && __TW_BUILT_AT__ ? new Date(__TW_BUILT_AT__).toLocaleString() : ''
  return el('div', { 'data-update-row': '1' }, [builtAt ? el('p', { class: 'meta' }, [S.updBuilt(builtAt)]) : null])
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
autoBackup = backup

/** Resources zoomed in: one flat outliner over every item, with a search field and a sort; the calendar's rows follow (cal8). */
function outlinerItems(s: AppState): Node[] {
  const rows = el('div', { class: 'zoom-rows-host' })
  const draw = (): void => rows.replaceChildren(resourceList('mine', itemRows(s.inventory, resQuery, resSort).map((i) => ({
    id: i.id, title: i.text, at: i.createdAt, onOpen: () => itemSheet(i.id),
    chips: [S.audienceLabel[i.audience], i.included ? null : S.zoomOff, i.tagAudience?.length ? S.zoomTags(i.tagAudience.length) : null],
  })), Date.now()))
  const input = el('input', { class: 'field', type: 'search', placeholder: S.zoomSearchPh, 'aria-label': S.zoomSearchPh, value: resQuery, oninput: (e: Event) => { resQuery = (e.target as HTMLInputElement).value; draw() } })
  const sort = el('button', { class: 'btn btn-ghost btn-sm', 'data-zoom-sort': '', onclick: () => { resSort = resSort === 'new' ? 'az' : 'new'; sort.textContent = resSort === 'new' ? S.zoomSortNew : S.zoomSortAz; draw() } }, [resSort === 'new' ? S.zoomSortNew : S.zoomSortAz])
  draw()
  return [el('div', { class: 'add-row' }, [input, sort]), rows]
}

function screenInventory(): Node[] {
  const s = st()
  if (invMatches) {
    return [
      header(S.matches.title),
      el('div', { class: 'scroll pad', 'data-matches': '' }, matchesView(s, { status: matchStatus, nameOf: (id) => { const p = s.people.find((x) => x.id === id); return p ? displayName(p.name).text : null }, openPerson: openCardPage, newId: () => randomId(8), save, render })),
    ]
  }
  const input = el('input', { class: 'field', placeholder: S.invAddPh, maxlength: '160', 'aria-label': S.invAddPh })
  const add = (): void => {
    const v = input.value.trim()
    if (!v) { input.focus(); return }
    s.inventory.unshift({ id: randomId(8), text: v, audience: Audience.FriendsOfFriends, included: true, createdAt: Date.now(), source: typedSource() })
    save()
    render()
  }
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') add() })
  // Wave 28: Settings now comes from mountHeaderControls; the small (i) that explains the cascade (Jakob 2026-10-07) sits beside the title.
  const info = cascadeInfoButton(() => openSheet(cascadeInfoContent()))
  const find = invSearchOpen
    ? el('input', { class: 'field', type: 'search', placeholder: S.invSearchPh, 'aria-label': S.invSearchPh, 'data-inv-search': '', value: invQuery, oninput: (e: Event) => { invQuery = (e.target as HTMLInputElement).value; render() } })
    : null
  if (find) setTimeout(() => { find.focus(); find.setSelectionRange(invQuery.length, invQuery.length) }, 0)
  const byQuery = invQuery.trim() ? s.inventory.filter((i) => i.text.toLowerCase().includes(invQuery.trim().toLowerCase())) : s.inventory
  const shown = invOnly ? byQuery.filter((i) => invOnly!.ids.has(i.id)) : byQuery
  const onlyChip = invOnly ? tagFilterChip(invOnly.label, () => { invOnly = null; render() }) : null
  const requests = el('button', { class: 'query-fab call requests-fab', 'aria-label': S.reqAria, onclick: requestsSheet }, [
    el('span', { class: 'fab-two' }, [el('span', {}, [S.reqTop]), el('span', {}, [S.reqBottom])]),
  ])
  // Querying is one tap from Inventory too (wave 2, P9): bottom right as on Web and Chat (wave 27); "Review requests" sits bottom left.
  const call = el('button', { class: 'query-fab call inv-call-fab', 'aria-label': S.webCall, 'data-open-query': 'inventory', onclick: openQuery })
  call.innerHTML = askWebIcon(askIconVariant)
  call.append(el('span', { class: 'fab-two' }, [el('span', {}, [S.webCallTop]), el('span', {}, [S.webCallBottom])]))
  const zin = zoom.inventory
  const list = el('div', { class: 'scroll pad', 'data-zoom-level': zin ? 'in' : 'out' }, zin ? [...outlinerItems(s), ...(cal?.resourcesSection?.() ?? [])] : [
      s.testOf ? foundView(s) : null,
      el('p', { class: 'hint' }, [S.invLead]),
      find,
      onlyChip,
      el('div', { class: 'add-row' }, [input, el('button', { class: 'btn btn-electric btn-sm', onclick: add }, [S.invAdd])]),
      s.inventory.length === 0 ? el('p', { class: 'empty' }, [S.invEmpty]) : null,
      // Jakob's sketch (10-07, #21/#22): the X top right of the item, the on/off switch below it on the right;
      // under the text first who can ask, then how far it may travel.
      ...shown.map((item) => el('div', { class: 'inv' + (item.included ? '' : ' off') }, [
        el('div', { class: 'inv-main' }, [
          el('button', { class: 'inv-text', 'data-item': item.id, onclick: () => itemSheet(item.id) }, [
            item.text, isDemoItem(s, item.id) ? dummyChip() : null,
            recentChip(item.createdAt, Date.now()),
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
      ...invitationsSection(invitationIo()),
      ...(cal?.resourcesSection?.() ?? []),
      backup.card(),
    ])
  // A calendar event dragged here (mouse/trackpad; phones keep the pickers) becomes an item tagged with it.
  acceptEvent(list, (ref) => {
    const item = eventDropItem(s, ref, randomId(8), Date.now())
    if (!item) { toast(S.cal.dropUnknown); return }
    s.inventory.unshift(item)
    save()
    render()
    undoNotice(S.cal.dropAdded(item.text), () => { s.inventory = s.inventory.filter((x) => x !== item); save(); render() })
  })
  return [
    header(S.invTitle, { glyph: el('span', { class: 'hdr-pair' }, [zoomGlyph('inventory'), info]) }),
    list,
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

const suggestions = (s: AppState): string[] => [
  'Does anyone have loudspeakers I could borrow?',
  'Who is hiring?',
  spareRoomExample(s.city),
]

let countdownTimer: ReturnType<typeof setInterval> | undefined

/** Seconds until the answers of an ask with this reach are due (one window per step, hops.ts). */
function secondsLeft(startedAt: number, reach: number = HOPS_DEFAULT): number {
  return Math.max(0, Math.ceil((startedAt + askWaitMs(reach, net.answerWindowMs) - Date.now()) / 1000))
}

const ASK_HOW_KEY = 'tw.askHowOpen'
/** "How asking works": the long explanation, folded by default; the state is remembered on this phone. */
function askHow(): HTMLElement {
  let open = false
  try { open = window.localStorage.getItem(ASK_HOW_KEY) === '1' } catch { /* closed */ }
  const d = el('details', { class: 'ask-how', 'data-ask-how': '1' }, [
    el('summary', {}, [S.askHow]),
    el('p', { class: 'hint' }, [S.queryLead]),
    el('p', { class: 'hint', 'data-query-sees': '1' }, [S.querySees]),
  ]) as HTMLDetailsElement
  d.open = open
  d.addEventListener('toggle', () => { try { window.localStorage.setItem(ASK_HOW_KEY, d.open ? '1' : '0') } catch { /* not remembered */ } })
  return d
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
  if (!text.trim()) { toast(S.queryNeedText); return }
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
  // Drafting only through the person's own endpoint (Settings > Advanced > Your AI); any error falls back to the plain reading.
  const ai = st().advanced?.ai
  const read = await draftOrPlain(text, now, (t) => askEndpoint(ai!, t, undefined, undefined, ownChannels(st())), configured(ai))
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
  box.setAttribute('data-ask-input', '1')
  const webHere = askWebPanel({ state: st, save }, queryText)
  box.addEventListener('input', () => { queryText = box.value; webHere.update(queryText) })
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
  const reach = reachChooser(askReachOf(s), askDirectOnly(s) || busy, (r) => {
    if (r === HOPS_DEFAULT) delete s.askReach; else s.askReach = r
    save(); render()
  })
  const modeChips = el('div', { class: 'chips', 'data-ask-modes': '' }, ASK_MODES.filter((m) => m !== AskMode.Support || isEnabled('support-ask')).map((m) => el('button', {
    class: 'chip' + (nextAskMode(askMode) === m ? ' on' : ''), type: 'button', 'data-ask-mode': m, 'aria-pressed': String(nextAskMode(askMode) === m),
    onclick: () => { askMode = m; render() },
  }, [{ [AskMode.Support]: S.askModeSupport, [AskMode.Hints]: S.askModeHints, [AskMode.Intros]: S.askModeIntros }[m]])))
  const dock = el('section', { class: 'query-dock', 'aria-label': S.queryTitle }, [
    el('div', { class: 'dock-head' }, [
      el('h3', {}, [S.queryTitle]),
      el('button', { class: 'x', 'aria-label': S.queryClose, onclick: () => { queryOpen = false; askMode = AskMode.Hints; render() } }, ['×']),
    ]),
    el('div', { class: 'dock-body' }, [
      run ? null : modeChips,
      run ? null : askHow(),
      !run && togetherPending ? el('p', { class: 'hint', 'data-together-check': '1' }, [S.queryTogetherCheck]) : null,
      !run && askDirectOnly(s) ? el('p', { class: 'hint', 'data-direct-note': '1' }, [S.queryDirectOnly]) : null,
      // Wave 6: how far the ask travels, remembered on this phone; "Ask only my direct contacts" (Settings > Advanced) holds it at 1.
      reach,
      s.peers.length === 0 ? el('p', { class: 'warn' }, [S.queryNoPeers]) : null,
      demoEnded ? el('p', { class: 'warn' }, [S.demoEndedLine]) : demoWaiting && s.testOf ? el('p', { class: 'warn' }, [S.demoWaitingAsk(s.testOf.name)]) : null,
      box,
      run ? null : webHere.el,
      run ? null : el('div', { class: 'chips', 'data-together-place': '1' }, [
        togetherPlace
          ? el('button', { class: 'chip', 'data-together-place-chosen': '1', title: S.togetherPickClear, onclick: () => { togetherPlace = null; render() } }, [S.togetherPicked(togetherPlace.label || S.togetherHere) + ' ×'])
          : el('button', { class: 'chip', 'data-together-pick': '1', title: S.togetherPickHint, onclick: () => { void pickTogetherPlace() } }, ['📍 ' + S.togetherPick]),
      ]),
      run ? null : el('div', { class: 'chips' }, [
        el('span', { class: 'chips-lbl' }, [S.queryTry]),
        ...suggestions(s).map((q) => el('button', { class: 'chip', onclick: () => { queryText = q; render() } }, [q])),
      ]),
      el('button', {
        class: 'btn btn-electric wide', disabled: busy || s.peers.length === 0 || demoWaiting || demoEnded,
        onclick: () => { void sendFromDock(queryText) },
      }, [S.querySend]),
      inFlight,
      // With the Feed off (the default since wave 2) this is where earlier answers stay readable (review-wave2).
      !run && (s.found?.length ?? 0) > 0 ? el('div', { 'data-earlier-answers': '1' }, [foundView(s, S.queryAnswers)]) : null,
    ]),
  ])
  // Ask for support swaps the question box for the support form; the chips stay on top.
  if (!run && nextAskMode(askMode) === AskMode.Support) {
    dock.querySelector('.dock-body')?.replaceChildren(modeChips, supportForm(supportIo, () => { askMode = AskMode.Hints; queryOpen = false }))
  }
  if (!run && nextAskMode(askMode) === AskMode.Intros) {
    dock.querySelector('.dock-body')?.replaceChildren(modeChips, introForm({
      st, reach, steps: () => askReachOf(st()),
      ask: (peerId, target) => net.askIntro(peerId, target),
      onResult: (target, r) => recordFound(introAskText(target), [r]),
      link: async (target, why) => encodeIntroLink(linkOrigin(location.origin), { by: st().me.displayName, target, ...(why.trim() ? { why: why.trim() } : {}), connect: await (async () => { await net.start(); return net.connectLink(CONNECT_URL) })() }),
      copy: (text) => copyLink(text, S.meetCopied),
    }))
  }
  return dock
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
      a.intro && decided === null
        ? introCard({ by: a.fromName, target: a.intro }, {
            introduce: () => { decide(true); showNextAsk(); introduceHandoff({ by: a.fromName, target: a.intro! }) },
            notNow: showNextAsk,
            decline: () => decide(false),
          })
        : decided === null
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
  if (document.visibilityState === 'hidden') { hiddenSince = Date.now(); backup.hidden(); if (nativeApp) net.pause(); return }
  const slept = hiddenSince > 0 && Date.now() - hiddenSince > WAKE_FRESH_MS
  hiddenSince = 0
  if (!state || state.testOf?.handedOverAt) return
  // Review 6h: back in front after a long time away is an open too (an installed app on a phone is rarely started afresh).
  checkEngagement()
  if (slept && appOpened()) showAskCards()
  net.activate(slept || nativeApp)
})
window.addEventListener('focus', () => { if (state && !state.testOf?.handedOverAt) net.activate(false) })
// Wave 6h (wake_watch.ts): a laptop that slept with this tab behind another window, a network that came back, a page restored from the
// back-forward cache: the socket may be dead without knowing it. A fresh one, without taking the drain from a tab in front.
const refreshDrain = (): void => { if (state && !state.testOf?.handedOverAt) net.refresh() }
watchWake(refreshDrain, { now: () => Date.now(), every: (fn, ms) => setInterval(fn, ms), stop: (h) => clearInterval(h as ReturnType<typeof setInterval>) })
window.addEventListener('online', refreshDrain)
window.addEventListener('online', () => backup.backOnline())
window.addEventListener('pagehide', () => backup.hidden())
window.addEventListener('pageshow', (e) => { if (e.persisted) refreshDrain() })
// Wave 6f: another tab (or the installed app) of this profile saved the record, e.g. a new connection it received while it held the
// drain: this tab takes it over instead of keeping an older copy and writing that back over it on its next save (tab_sync.ts).
window.addEventListener('storage', (e) => {
  if (e.storageArea !== localStorage || e.key !== storageKey(persona, storeCtx)) return
  onStoredChange(e.newValue === null ? null : parseRecord(e.newValue), e.newValue === null)
})
document.addEventListener('focusout', () => { if (redrawWaiting) setTimeout(redrawAfterAdoption, 0) })

document.body.dataset.twProfile = profileOf(state?.twSettings)
applyVariation()
applyImageMode()
void twRegistry.start().then(renderTabs) // wave 39: a heavy module's view joins the row once it has loaded
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
  maybeOpenPendingIntro()
  maybeOpenPendingBook()
  // Wave 6f/6h: the cards about asks (late answers, nothing matched, asked while away); asks kept while closed arrive with the drain.
  setTimeout(showAskCards, 1500)
  // The server only learns of this phone when its code is first shown (Meet); a phone that has one keeps it current.
  if (state.connectCode) void ensureConnectCode()
  offerApkHint(offerDemoContent)
  offerNotifications()
  cal?.start?.()
  coNotes?.start?.()
  checkEngagement()
  setInterval(checkEngagement, 15 * 60_000)
  purgeDeleted()
  setInterval(purgeDeleted, 24 * 3600_000)
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
