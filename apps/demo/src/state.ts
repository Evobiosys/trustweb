/**
 * Device state. Lives in IndexedDB, never leaves the device.
 */

import type { AskCooldownRecord, ChatThread, Identity, InventoryItem, Profile, QueryLogEntry } from './types'
import { kvGet, kvSet, kvClear } from './db'
import { randomId } from './crypto'
import type { SerializedIdentityV1 } from './did'
import { ASK_COOLDOWN_MS, askIdentityKey, cooldownKey, decideAsk, type CooldownDecision, type CooldownPolicy } from './cooldown'

export interface Peer {
  id: string
  displayName: string
  /** Our nonce and theirs, in the fixed order that derives the shared key. */
  nonceSelf: string
  noncePeer: string
  connectedAt: number
  blocked: boolean
  /**
   * The peer's did:peer:2 (did.ts), relay mode only. Present ONLY after a
   * real connect ceremony carried it (see wire.ts's ConnectEnvelope.did and
   * main.ts's scanConnectCode) -- a SEEDED pairing never has one, because
   * the seed is a fixed nonce pair chosen before either device existed,
   * while a did:peer:2 is minted fresh, at random, per device, per boot.
   * There is no value that could be pre-seeded here without lying about a
   * ceremony that did not happen. relay.ts's `send()` needs this to address
   * the peer; its absence is the precondition that routes the relay-mode UI
   * to the QR pairing screen instead of attempting a network send -- see
   * main.ts's `relayReady()`.
   */
  did?: string
  /**
   * True while this pairing came from the demo seed rather than from a QR
   * ceremony two people actually performed.
   *
   * The seeded pairing stays (a camera that misbehaves must not cost us the
   * part of the demo that matters), but the UI must never render it as
   * "Verbunden mit Marlene". Claiming a connection that did not happen is the
   * one thing that would make everything else we say about this app suspect.
   * Cleared the moment a real ceremony completes.
   */
  seeded?: boolean
  /**
   * How main.ts's `pairKey()` must derive the shared key for this peer.
   * Absent (or `'nonce'`) means the ORIGINAL two-scan derivation:
   * `derivePairKey(nonceSelf, noncePeer)` (crypto.ts) -- safe there because
   * both nonces are exchanged by two cameras in the same room, never over a
   * network. `'ecdh'` means this peer was paired through the one-scan
   * connect-link ceremony (connect_link.ts): `nonceSelf`/`noncePeer` are
   * unused placeholders for that peer (there is no second scan to carry a
   * nonce back), and the real key comes from X25519 ECDH between `did` and
   * this device's own identity (crypto.ts's `deriveEcdhPairKey`,
   * did.ts's `ecdhSharedSecret`) -- see connect_link.ts's module header for
   * why that substitution is required, not optional, once one nonce has to
   * cross the relay.
   */
  pairing?: 'nonce' | 'ecdh'
  /**
   * Mute this asker (cooldown.ts, 2026-09-06). Distinct from `blocked`
   * above: `blocked` is this project's pre-existing, broader "I do not want
   * this contact reaching me at all" switch; `muted` is the narrower,
   * repeat-asking-specific one this feature adds -- "their asks stay
   * silent and log-only," a smaller, more easily reversible step than
   * blocking outright, offered specifically from the cooldown settings
   * (screens/profile.ts) so muting someone for nagging never requires the
   * heavier, pre-existing block action. Both fold into the SAME
   * indistinguishable-"nothing" wire outcome as everything else in
   * gate.ts's `decide()`; only the local Protokoll (LocalOutcome) tells
   * them apart. Absent reads as `false` -- see `isMuted()` below.
   */
  muted?: boolean
  /**
   * Relay-target posture (relay_posture.ts, 2026-09-06): "do not relay for
   * this person." Per-peer override of the global `DeviceState.actAsRelay`
   * default -- see relay_posture.ts's module doc for what "relay" means
   * here (carrying a THIRD party's sealed traffic, not the demo-21
   * second-hop question-forward). Absent reads as `false` (this contact is
   * covered by whatever the global posture says) -- see relay_posture.ts's
   * `mayRelayFor()`.
   */
  doNotRelayFor?: boolean
}

/**
 * Demo 21 (secondHop scenario) only: A's own, private "I know X has this"
 * note -- `packages/agent-daemon`'s `provenance.kind === 'second_brain'`
 * shape (D13/D15/D16), re-enacting the exact story `verification/alpha-run.txt`
 * leg (g) already ran live (a ladder). Lives only on the ONE device that was
 * seeded as the first hop (main.ts's `completeConnectLinkIfPending` branch
 * that checks `pendingConnectLink.from.id === 'jakob'`) -- never on Jakob's
 * own device, never on a second-hop guest's, and never editable in-app (see
 * docs/query-traversal.md section 1c's own caveat: no in-app composer exists
 * for this anywhere in the project yet; this is a fixed demo seed, the same
 * honest limitation the daemon's live-run leg (g) already had).
 */
export interface SecondBrainNote {
  id: string
  text: string
  createdAt: string
  /** Peer.id of the person this note is ABOUT (Jakob, always 'jakob' in this
   *  scenario -- see main.ts's seedJakob()). Relaying requires a LIVE trust
   *  edge to this id (D16): `state.peers` must hold a reachable peer for it,
   *  checked at relay time, never assumed from the note's mere existence. */
  ownerPeerId: string
  ownerDisplayName: string
}

/**
 * The three onboarding postures (DEVLOG/handover-three-modes.md). Chosen once
 * on THIS device, at onboarding, on every device including a guest arriving
 * by connect link -- never inherited from whoever invited you (that would be
 * exactly the coercion the feature exists to prevent). Changeable afterwards
 * from "Mein Profil". A mode is a STARTING POSTURE, not a lock: every
 * individual switch it sets (see applyModePosture below) stays individually
 * settable afterwards, same as any other field in this file.
 *
 * `'sicher'`: the most protective. No free-text asks, in either direction --
 * this device cannot compose one (main.ts's screenAsk) and will not resolve
 * one addressed to it (main.ts's resolveIncomingTemplate), so nobody using
 * this device is ever shown a stranger's own words to react to. Nothing this
 * device holds is exposed until it is switched on deliberately -- see
 * seedPersona/seedJakob/seedSecondHopRoot's seed-time use of this posture.
 * Never offers to relay a second hop (main.ts's runSecondHopRelayCeremony)
 * -- see that function's own eligibleNotes gate.
 *
 * `'standard'`: the default (I9 -- a person who taps straight through gets
 * this). Reproduces exactly what this app already shipped before this
 * feature existed: free-text asks allowed, the fast/honest-about-reach
 * default for a direct answer (D28), relaying stays non-revealing (D30),
 * a second hop is possible.
 *
 * `'pro'`: everything available, including whatever is fastest and most
 * revealing -- the owner's own words: "i know what i am doing and will
 * nuance what i share and talk." Not a locked-down safety rail; a person who
 * has picked this is trusted to manage their own exposure.
 */
export type Mode = 'sicher' | 'standard' | 'pro'

/** Absent reads as `'standard'` -- the same "absent means the safe default"
 *  convention `secondHopUniformModeDirect`/`secondHopRevealRelay` already
 *  use below, and for the same reason: a state saved before this field
 *  existed (a rehearsal phone on an earlier build of this branch, exactly
 *  the case `withDefaults`'s own migration comment already worries about)
 *  must not silently become some OTHER posture just because the field is
 *  missing. `withDefaults` does not need to backfill it. */
export function deviceMode(s: DeviceState): Mode {
  return s.mode ?? 'standard'
}

/**
 * The bundle a mode sets for the two independent per-role timing switches
 * (DECISIONS.md D28/D30 -- see DeviceState.secondHopUniformModeDirect and
 * .secondHopRevealRelay's own doc comments for what each one governs).
 * `'standard'` reproduces D28/D30's own shipped defaults exactly (both
 * false). `'sicher'` pushes the direct switch to uniform too, so a Sicher
 * device's own directly-answered "nothing" (including a free-text ask this
 * device just refused to resolve, see resolveIncomingTemplate) takes the
 * same fixed ~30s every relay-class ending already takes -- the refusal
 * cannot be read off the clock. `'pro'` opts the relay switch into
 * revealing, on top of the direct switch's already-fast default: the
 * fastest, most revealing combination this app can produce.
 */
export function modeSwitchDefaults(mode: Mode): {
  secondHopUniformModeDirect: boolean
  secondHopRevealRelay: boolean
} {
  switch (mode) {
    case 'sicher': return { secondHopUniformModeDirect: true, secondHopRevealRelay: false }
    case 'pro': return { secondHopUniformModeDirect: false, secondHopRevealRelay: true }
    case 'standard':
    default: return { secondHopUniformModeDirect: false, secondHopRevealRelay: false }
  }
}

/**
 * The ONE place a mode gets applied. Called only from an EXPLICIT choice --
 * picking a mode during onboarding (main.ts's seedPersona/seedGeoGuest/
 * seedSecondHopGuest/seedJakob/seedSecondHopRoot, all of which receive the
 * chosen mode as a parameter rather than reading a default) or changing it
 * later from "Mein Profil" (screens/profile.ts) -- and NEVER from
 * `deviceMode()`/`withDefaults`/`loadState()`. That asymmetry matters: a
 * rehearsal phone that has individually hand-tuned
 * secondHopUniformModeDirect/secondHopRevealRelay must not have them
 * silently reset just because `s.mode` happens to be absent and
 * `deviceMode()` reads it as `'standard'` on every load. A mode is a
 * starting posture applied ONCE per explicit choice, not a rule re-enforced
 * on every boot.
 */
export function applyModePosture(s: DeviceState, mode: Mode): void {
  s.mode = mode
  const d = modeSwitchDefaults(mode)
  s.secondHopUniformModeDirect = d.secondHopUniformModeDirect
  s.secondHopRevealRelay = d.secondHopRevealRelay
}

export interface DeviceState {
  me: Identity
  threads: ChatThread[]
  peers: Peer[]
  profile: Profile
  inventory: InventoryItem[]
  /**
   * I6 Auditability: every query this device has RECEIVED, local-only, never
   * transmitted. See types.ts's QueryLogEntry for the full privacy reasoning
   * (why this cannot become a side channel) and appendQueryLog() below for
   * how an entry gets added. Absent in every state saved before this field
   * existed -- withDefaults backfills it, same as `inventory`/`profile`.
   */
  queryLog: QueryLogEntry[]
  /**
   * This device's did:peer:2 identity (did.ts), relay mode only. Minted
   * lazily on first need (relay_identity.ts's `ensureRelayIdentity`), not on
   * every `seedPersona()` call, so a qr-mode build never touches did.ts at
   * all. Absent in every state saved before this field existed and in any
   * qr-mode session -- `withDefaults` does not need to backfill it, callers
   * mint on demand.
   */
  relayIdentity?: SerializedIdentityV1
  /**
   * See SecondBrainNote's own doc comment. Absent on every device except
   * demo 21's own first hop -- `withDefaults` does not need to backfill it,
   * same reasoning as `relayIdentity` above. An ARRAY, not a single note
   * (this field used to be `secondBrainNote?: SecondBrainNote`, singular):
   * A can privately know more than one separate thing about Jakob (the
   * ladder, and separately that his flat is sometimes free -- see
   * data/second_hop.ts's own doc comment on why these are two notes, not
   * one fused sentence). `runSecondHopRelayCeremony` matches a query
   * against ALL of them at once (via secondBrainThread(), one synthetic
   * ChatThread per note, fed into matchTemplate() together, exactly like
   * threadsInScope() already does for several real chats at once) and
   * relays through whichever note actually scored the hit.
   */
  secondBrainNotes?: SecondBrainNote[]
  /**
   * Demo 21 (secondHop scenario) only, DECISIONS.md D28/D30: TWO
   * INDEPENDENT switches, held by two different roles this device can
   * play, each read fresh from `state` by `main.ts`'s createRelayDispatch
   * at the moment a query is actually received -- never transmitted, never
   * known to anyone but this device.
   *
   * `secondHopUniformModeDirect` governs endings where THIS device is the
   * one actually answering -- a real match against its own stuff, or a
   * genuine immediate "nothing" (no note ever came into play at all).
   * Absent/false is the DEFAULT and means FAST: an answer goes out the
   * moment it is decided, and the asker can roughly infer how far the
   * question travelled from how long it took -- the owner's own explicit
   * departure from this project's usual I9 posture (D28), because a demo
   * people will actually sit through was worth more here than the
   * conservative default. `true` opts back into the original uniform
   * behaviour.
   *
   * `secondHopRevealRelay` governs a DIFFERENT ending: THIS device holding
   * an eligible second-brain note and having to decide what to do about it
   * -- decline, or forward and wait for Jakob. Absent/false is the DEFAULT
   * and means UNIFORM/NON-REVEALING (the ordinary I9 posture, NOT
   * overridden here) -- D30's own reasoning: the person relaying never
   * asked to be involved in this exchange at all, unlike the person
   * actually answering, who at least gets asked "do you want to share
   * this." `true` is HER OWN opt-in to let a relay-carrying answer move as
   * fast as it can, same as a direct one.
   *
   * See D30 for the honestly-stated residual: because these two switches
   * default to OPPOSITE postures (direct fast, relay slow), a relay-
   * eligible ending is, BY DEFAULT, still observably slower than a direct
   * or no-note one -- the relay switch's own default protects the FINER
   * signal (how long the round trip actually took, whether Jakob answered
   * quickly or Jakob declined) but cannot, by construction, fully hide the
   * COARSER one (that SOME note was engaged at all) while the direct
   * default stays fast. Not fixed silently; said here and in D30.
   *
   * `withDefaults` does not need to backfill either: absent reads as
   * `false` for both, which is already each field's own correct default.
   */
  secondHopUniformModeDirect?: boolean
  secondHopRevealRelay?: boolean
  /**
   * The onboarding posture (see the `Mode` type and `deviceMode()` above).
   * Absent reads as `'standard'` -- `withDefaults` does not need to backfill
   * it, same reasoning as `secondHopUniformModeDirect`/`secondHopRevealRelay`
   * above: a state saved before this field existed already IS what
   * `'standard'` describes (free text allowed, fast/honest default, second
   * hop possible), so treating its absence as `'standard'` is not a
   * guess, it is simply naming what that state already does.
   */
  mode?: Mode
  /**
   * Repeat-ask cooldown (cooldown.ts, 2026-09-06). This device's OWN
   * enforcement records, keyed by `cooldownKey(askerId, templateOrText)` --
   * see cooldown.ts's module doc for why this is the receiving device's
   * state and the asker cannot touch it. Absent reads as `{}` -- `withDefaults`
   * backfills it, same as `queryLog`.
   */
  askCooldowns?: Record<string, AskCooldownRecord>
  /**
   * "Keep default cooldown" / "no cooldown" (cooldown.ts). Absent reads as
   * `'default'` (I9) -- see cooldown.ts's `CooldownPolicy`. `withDefaults`
   * does not need to backfill it: absence already correctly means the
   * protective default.
   */
  cooldownPolicy?: CooldownPolicy
  /**
   * Best-effort, UI-ONLY copy of the escalation half of `askCooldowns`, kept
   * on the ASKING device purely so main.ts's screenAsk can grey out its own
   * "this is very important" checkbox once it believes it has already spent
   * it for a given (peer, template-or-query-text) -- keyed the same way,
   * with the PEER's id standing in for "asker" from this device's own point
   * of view. NEVER authoritative: the receiving device enforces the real
   * single-use rule from its OWN `askCooldowns`, independent of anything
   * here (cooldown.ts's module doc, "the sender cannot bypass by editing
   * its own state" -- this field is exactly the state a sender COULD edit,
   * which is why nothing on the receiving side ever reads it). Absent reads
   * as `{}`, same as `askCooldowns`.
   */
  escalationHints?: Record<string, AskCooldownRecord>
  /**
   * "Act as relay for others" (relay_posture.ts, 2026-09-06). Absent reads
   * as `RELAY_POSTURE_DEFAULT_ON` (true) -- see relay_posture.ts's own
   * module doc for why the default is ON and what "relay" scopes to here.
   */
  actAsRelay?: boolean
}

/** Exported so test/state_defaults.test.ts can write a legacy-shaped record
 * to the same slot loadState() reads from, without hardcoding the string
 * twice and silently drifting if this ever changes. */
export const KEY = 'device'

function emptyProfile(displayName: string): Profile {
  return { displayName, bio: '', neighbourhood: '', languages: [] }
}

/**
 * The two demo personas.
 *
 * Deliberately mundane: a neighbourhood group and someone looking for a flat.
 * There is no subculture framing here and there must not be -- the audience is
 * two people in Vienna who want to know whether this is safe to use.
 */
export const PERSONAS: {
  id: string
  displayName: string
  role: 'holder' | 'seeker'
  blurb: { de: string; en: string }
  profile: Profile
  /**
   * Starting entries for "Was ich habe". Nora gets none: she is the seeker,
   * not the holder, and an empty list is itself the honest demo state for
   * her, not a gap to fill.
   */
  inventorySeed: Omit<InventoryItem, 'id' | 'createdAt'>[]
}[] = [
  {
    id: 'marlene0',
    displayName: 'Marlene',
    role: 'holder',
    blurb: {
      de: 'Ist in einer Grätzl-Gruppe im 16. Bezirk. Hat den Chatverlauf auf dem Handy.',
      en: 'Is in a neighbourhood group in the 16th district. Has the chat history on her phone.',
    },
    profile: {
      displayName: 'Marlene',
      bio: 'Wohnt seit über zehn Jahren im Grätzl, kennt viele in der Nachbarschaft und hilft gern aus.',
      neighbourhood: 'Ottakring, 16. Bezirk',
      languages: ['Deutsch', 'Englisch'],
    },
    inventorySeed: [
      // Phrased to fire the T1 pre-listing template's 'wohnung frei'
      // matchTerm (see data/templates.ts) so the demo-critical beat --
      // type a line, then find that line -- works without adding a
      // template. See test/inventory_match.test.ts.
      {
        text: 'Ich wohn im Erdgeschoß direkt neben der Hausverwaltung und krieg oft als Erste mit, wenn im Haus eine Wohnung frei wird.',
        included: true,
      },
      { text: 'Hab eine Bohrmaschine daheim, kannst sie dir jederzeit ausborgen.', included: true },
      { text: 'Hab ein Lastenrad, praktisch fürs Möbeltransportieren, frag einfach kurz.', included: true },
    ],
  },
  {
    id: 'nora0000',
    displayName: 'Nora',
    role: 'seeker',
    blurb: {
      de: 'Sucht eine Wohnung. Kennt Marlene, aber nicht ihre Gruppen.',
      en: 'Is looking for a flat. Knows Marlene, but not her groups.',
    },
    profile: {
      displayName: 'Nora',
      bio: 'Ist neu in Wien und sucht eine leistbare Wohnung.',
      neighbourhood: 'Wohnt vorübergehend bei einer Freundin in Meidling',
      languages: ['Deutsch', 'Englisch'],
    },
    inventorySeed: [],
  },
]

let cached: DeviceState | null = null

/**
 * Fill in fields a state saved by an earlier build of the demo won't have.
 * `inventory`/`profile` did not exist before this change, so a state loaded
 * from IndexedDB (or the in-memory fallback, see db.ts) can legally be
 * missing them; every reader in this module and in main.ts assumes they are
 * present, so this is the one place that guarantee gets made, rather than
 * every call site defending itself with `s.inventory ?? []`.
 *
 * `secondBrainNotes` migration (advisor-flagged, this branch's own history):
 * this field used to be `secondBrainNote` (singular, one object, not an
 * array) before the D26/scenario-A change gave A a second note. A device
 * that ran an EARLIER BUILD OF THIS SAME BRANCH -- not a hypothetical, this
 * is exactly the kind of state a phone used for a rehearsal run would carry
 * into the actual show -- has `secondBrainNote` on disk and no
 * `secondBrainNotes` at all. Without this branch, `s.secondBrainNotes?.length`
 * reads falsy, `isLeafAsker` (main.ts) silently flips true, and the whole
 * relay path goes dead with no error anywhere on screen. The legacy shape is
 * read via a narrow, locally-scoped cast (never exported, never given a
 * shared type) precisely because it must not exist anywhere else in the
 * codebase -- this is the one place that is allowed to know the old name.
 */
function withDefaults(s: DeviceState): DeviceState {
  const legacy = s as DeviceState & { secondBrainNote?: SecondBrainNote }
  return {
    ...s,
    inventory: s.inventory ?? [],
    profile: s.profile ?? emptyProfile(s.me.displayName),
    queryLog: s.queryLog ?? [],
    secondBrainNotes: s.secondBrainNotes ?? (legacy.secondBrainNote ? [legacy.secondBrainNote] : s.secondBrainNotes),
    askCooldowns: s.askCooldowns ?? {},
    escalationHints: s.escalationHints ?? {},
  }
}

export async function loadState(): Promise<DeviceState | null> {
  if (cached) return cached
  const s = await kvGet<DeviceState>(KEY)
  cached = s ? withDefaults(s) : null
  return cached
}

export async function saveState(s: DeviceState): Promise<void> {
  cached = s
  await kvSet(KEY, s)
}

export async function resetAll(): Promise<void> {
  cached = null
  await kvClear()
  // Also drop the offline cache and the worker, so "Demo zurücksetzen" really
  // does return the device to a first-visit state rather than to a cached one.
  try {
    if ('caches' in globalThis) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
    const regs = await navigator.serviceWorker?.getRegistrations?.()
    if (regs) await Promise.all(regs.map((r) => r.unregister()))
  } catch { /* nothing here may block a reset */ }
}

/**
 * A fixed, non-translated label. Treated the same way as an imported chat's
 * title ('Klaus', 'Otta Grätzl & Alltag'): a name-like tag on the synthetic
 * thread, not UI chrome, so it stays out of i18n.ts and does not change with
 * the language toggle -- exactly like every other ChatThread.title.
 */
const INVENTORY_THREAD_TITLE = 'Eigene Notizen'

/**
 * Represent "Was ich habe" as matcher input: one synthetic single-message
 * ChatThread per entry, so match/lexical.ts needs no second scoring path for
 * inventory content. From the matcher's point of view an entry is
 * indistinguishable from a message she sent in a one-message thread with
 * herself -- same normalize/stem/compound pipeline, same exclude-term veto,
 * same author-counted anonymity floor (an entry always contributes exactly
 * the one author who wrote it, same as if she had posted it in a group chat
 * herself). `included` on the synthetic thread mirrors the entry's own
 * switch; matchTemplate's own `thread.included !== true` guard (see
 * match/lexical.ts) is what actually keeps an excluded entry unmatchable,
 * this function does not pre-filter, on purpose -- see threadsInScope below.
 */
function inventoryThreads(s: DeviceState): ChatThread[] {
  return s.inventory.map((item) => ({
    id: `inv:${item.id}`,
    title: INVENTORY_THREAD_TITLE,
    kind: 'direct',
    participants: [s.me.displayName],
    messages: [{ ts: item.createdAt, author: s.me.displayName, text: item.text, system: false }],
    source: 'self',
    included: item.included,
  }))
}

/**
 * Everything currently eligible to be matched against an incoming question:
 * imported chat threads AND "Was ich habe" entries, both filtered to
 * `included`. This is the ONLY function main.ts's consent ceremony calls
 * before matchTemplate -- widening it here, instead of adding a second
 * argument or a second call, is what keeps inventory entries on the exact
 * same scoring path as chat messages (see inventoryThreads' doc comment).
 * Filtering here is belt-and-suspenders on top of matchTemplate's own
 * `included` guard, matching the existing double-filter for chat threads.
 */
export function threadsInScope(s: DeviceState): ChatThread[] {
  return [...s.threads, ...inventoryThreads(s)].filter((t) => t.included)
}

export function findPeer(s: DeviceState, id: string): Peer | undefined {
  return s.peers.find((p) => p.id === id)
}

/**
 * Look a peer up by their relay did:peer:2 (Peer.did). Truthy-guarded on
 * purpose: a SEEDED pairing has no `did` at all (Peer.did's own doc comment
 * -- there is no ceremony a seed could have minted one from), so `p.did ===
 * fromDid` alone would match a seeded peer against an `undefined`/empty
 * `fromDid` (`undefined === undefined` is `true`). That match would hand a
 * caller the seeded peer's fixed DEMO_NONCE-derived key for traffic that
 * named no real sender at all -- main.ts's registerRelaySink() is the one
 * caller this protects; a bare `.find((p) => p.did === fromDid)` there was
 * the bug this function exists to close.
 */
export function findPeerByDid(s: DeviceState, did: string | undefined | null): Peer | undefined {
  if (!did) return undefined
  return s.peers.find((p) => p.did === did)
}

/**
 * Upsert a peer, keeping the earliest connectedAt so the trust history stays
 * honest.
 *
 * One exception: replacing a SEEDED pairing. Its `connectedAt` is the moment
 * the app was opened, not a moment two people met, so carrying it forward
 * would backdate a real connection to a fictional one. A real ceremony
 * overwriting a seeded peer therefore keeps its own timestamp -- the earliest
 * *genuine* connection is still the one that survives.
 */
export function upsertPeer(s: DeviceState, p: Peer): void {
  const i = s.peers.findIndex((x) => x.id === p.id)
  if (i >= 0) {
    const prior = s.peers[i]
    s.peers[i] = { ...p, connectedAt: prior.seeded ? p.connectedAt : prior.connectedAt }
  } else {
    s.peers.push(p)
  }
}

/**
 * Append a new "Was ich habe" entry. Defaults to included: she typed this in
 * on purpose, just now -- see InventoryItem.included's doc comment in
 * types.ts for why that default is the opposite of a 1-on-1 chat's.
 */
export function addInventoryItem(s: DeviceState, text: string): InventoryItem {
  const item: InventoryItem = {
    id: randomId(8),
    text,
    createdAt: new Date().toISOString(),
    included: true,
  }
  s.inventory.push(item)
  return item
}

/**
 * Reassigns `s.inventory` rather than mutating it in place (unlike
 * `upsertPeer`/`addInventoryItem` above). Safe because every reader goes
 * through `s` itself and `saveState(s)` persists the whole object -- but
 * worth flagging as the one exception to this module's usual mutate-in-place
 * style, in case a future caller ever holds a separate reference to the
 * array.
 */
export function removeInventoryItem(s: DeviceState, id: string): void {
  s.inventory = s.inventory.filter((i) => i.id !== id)
}

/** A long-running demo device must not grow this without bound. Oldest
 *  entries drop first -- see appendQueryLog(). */
const QUERY_LOG_MAX = 200

/**
 * I6 Auditability: record that this device was asked something, and what it
 * did about it. See types.ts's QueryLogEntry doc comment for the full
 * privacy reasoning -- in short, this can never become a side channel
 * because it only ever names THIS device's own asker and THIS device's own
 * decision, never anything about any other device.
 *
 * Callers: main.ts's emitAnswer() (every answered query, both the ambient
 * silent path and the manual/QR path) appends AFTER the answer envelope has
 * already been sent -- deliberately, so that however long this call takes
 * can never shift when the wire message goes out. See emitAnswer's doc
 * comment.
 */
export function appendQueryLog(s: DeviceState, entry: Omit<QueryLogEntry, 'id'>): QueryLogEntry {
  const full: QueryLogEntry = { id: randomId(8), ...entry }
  s.queryLog.push(full)
  if (s.queryLog.length > QUERY_LOG_MAX) s.queryLog.splice(0, s.queryLog.length - QUERY_LOG_MAX)
  return full
}

// ---------------------------------------------------------------------------
// Repeat-ask cooldown (cooldown.ts) -- RECEIVING-device enforcement
// ---------------------------------------------------------------------------

/** Absent reads as `false`. See Peer.muted's own doc comment. */
export function isMuted(peer: Pick<Peer, 'muted'> | null | undefined): boolean {
  return peer?.muted ?? false
}

export interface AskEvaluation {
  outcome: 'muted' | 'cooldown' | 'ok'
  escalationGranted: boolean
}

/**
 * Memoised by `qid`, NOT persisted (in-memory only, cleared on reload -- a
 * fresh session re-derives everything it needs from `s.askCooldowns`, which
 * IS persisted). Exists because a single incoming query is evaluated from
 * more than one call site over its lifetime: `handleAmbientQuery` decides
 * whether to surface it at all, and -- for the ambient-surfaced case --
 * `runConsentCeremony` runs again once a human actually looks
 * (`screenAnswer`'s `pendingIncomingQuery`/`pendingGeoQueries` drain).
 * Without this cache, the SAME ask would be evaluated twice: a cooldown
 * window would shift twice, and, worse, a single-use escalation would be
 * spent twice for what is, on the wire, one ask. Capped the same way
 * `queryLog` is (`QUERY_LOG_MAX`), for the same reason: a long-running demo
 * device must not grow this without bound.
 */
const askEvaluationCache = new Map<string, AskEvaluation>()
const ASK_EVALUATION_CACHE_MAX = 200

/**
 * The one call every main.ts entry point for an incoming query makes before
 * running any match/consent logic: `handleAmbientQuery` (the ambient path)
 * and `runConsentCeremony` (both the ambient-surfaced ceremony AND the
 * manual QR-scan path, `scanQuery`) all call this with the query's own
 * `qid`, exactly once in effect (see `askEvaluationCache` above for how a
 * SECOND call for the same `qid` is made safe rather than double-counted).
 * Mutates `s.askCooldowns` in place (same style as
 * `appendQueryLog`/`upsertPeer` above) ONLY when the ask is allowed through
 * -- a dropped ask leaves the stored window untouched, per cooldown.ts's
 * `decideAsk` doc comment.
 *
 * Muting is checked here, ahead of cooldown, and short-circuits it entirely
 * (a muted asker's window is never opened or extended by an ask that was
 * always going to be silenced regardless of timing) -- muting is this
 * device's own standing decision about the PERSON, cooldown is about the
 * ASK, and the person-level decision takes priority.
 */
export function evaluateIncomingAsk(
  s: DeviceState,
  qid: string,
  askerId: string,
  templateOrText: string,
  escalationRequested: boolean,
  now: number = Date.now(),
): AskEvaluation {
  const cached = askEvaluationCache.get(qid)
  if (cached) return cached

  const result: AskEvaluation = ((): AskEvaluation => {
    if (s.peers.find((p) => p.id === askerId)?.muted) {
      return { outcome: 'muted', escalationGranted: false }
    }
    const key = cooldownKey(askerId, templateOrText)
    const decision: CooldownDecision = decideAsk({
      record: s.askCooldowns?.[key],
      now,
      cooldownMs: ASK_COOLDOWN_MS,
      policy: s.cooldownPolicy ?? 'default',
      escalationRequested,
    })
    if (decision.nextRecord) {
      s.askCooldowns = s.askCooldowns ?? {}
      s.askCooldowns[key] = decision.nextRecord
    }
    return decision.allow
      ? { outcome: 'ok', escalationGranted: decision.escalationConsumed }
      : { outcome: 'cooldown', escalationGranted: false }
  })()

  askEvaluationCache.set(qid, result)
  if (askEvaluationCache.size > ASK_EVALUATION_CACHE_MAX) {
    const oldest = askEvaluationCache.keys().next().value
    if (oldest !== undefined) askEvaluationCache.delete(oldest)
  }
  return result
}

/** Test-only: clears the qid memoisation above. Production `randomId(12)`
 *  qids do not collide across real asks, so no production code path ever
 *  needs this -- it exists purely so test/state_ask_cooldown.test.ts's
 *  cases can reuse short, readable literal qids ('qid-1', 'qid-2', ...)
 *  without one test's cached decision leaking into the next. */
export function __resetAskEvaluationCacheForTests(): void {
  askEvaluationCache.clear()
}

/**
 * ASKING-device UI hint only -- see DeviceState.escalationHints' own doc
 * comment on why this can never be authoritative. `peerId` here is the
 * device being asked (from the asker's own point of view), standing in for
 * `askIdentityKey`'s usual "asker" role in `evaluateIncomingAsk` above.
 */
export function escalationHintAvailable(s: DeviceState, peerId: string, templateOrText: string, now: number = Date.now()): boolean {
  const key = cooldownKey(peerId, templateOrText)
  const record = s.escalationHints?.[key]
  if (!record) return true
  if (now - record.windowStartAt >= ASK_COOLDOWN_MS) return true
  return !record.escalationUsedInWindow
}

/** Record, locally and optimistically, that this device just sent an
 *  escalated ask to `peerId` for `templateOrText` -- see
 *  `escalationHintAvailable` above. */
export function recordEscalationHintSent(s: DeviceState, peerId: string, templateOrText: string, now: number = Date.now()): void {
  const key = cooldownKey(peerId, templateOrText)
  const existing = s.escalationHints?.[key]
  const withinWindow = existing !== undefined && now - existing.windowStartAt < ASK_COOLDOWN_MS
  s.escalationHints = s.escalationHints ?? {}
  s.escalationHints[key] = withinWindow
    ? { windowStartAt: existing.windowStartAt, escalationUsedInWindow: true }
    : { windowStartAt: now, escalationUsedInWindow: true }
}

/** Re-exported so main.ts does not need a second import line for a single
 *  function used alongside the ones above. */
export { askIdentityKey }
