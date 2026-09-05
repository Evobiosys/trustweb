/**
 * demo 21 (secondHop scenario, DEVLOG/handover-demo21-two-hop.md): the
 * three-device, live-relay end-to-end test the handover asks for --
 * "the exact way test/e2e/call_into_the_web.mjs proves the one-hop case:
 * compare actual wire bytes, not just screen text."
 *
 * Runs the ACTUAL modules main.ts's relay ceremony calls -- gate.ts
 * (decide/maskAnswerPlaintext/truncateSharedJson/sealAnswerEnvelope),
 * match/lexical.ts, data/free_text_query.ts, state.ts -- directly in Node
 * against the LIVE relay at questhub.eco, same style as
 * call_into_the_web.mjs. The ceremony ORCHESTRATION (main.ts's
 * runSecondHopRelayCeremony/forwardToOwner/sendSecondHopFinalAnswer) is not
 * importable here (main.ts is DOM-bound), so this script reproduces its
 * exact sequence of calls into the real modules -- the same relationship
 * call_into_the_web.mjs already has to handleAmbientQuery's own logic.
 *
 * Cast, re-enacting verification/alpha-run.txt leg (g) (Bob asks -> Alice
 * relays her note about Carol's ladder -> two-hop consent -> Bob connected
 * to Carol) one layer up, in apps/demo's own browser-facing protocol:
 *   Jakob -- the laptop. Has a real inventory entry: a 3m ladder.
 *   A     -- paired to Jakob. Has NOTHING of her own, but a private
 *            second-brain note: "Jakob has a ladder."
 *   B     -- paired to A only. Has never met Jakob, does not know he exists
 *            except through this note firing.
 *
 * Legs:
 *   (1) SUCCESS: B asks about a ladder -> A has no direct match -> A's note
 *       matches -> A forwards to Jakob (relayed: true) -> Jakob matches his
 *       own inventory and consents, naming himself -> A relays the named
 *       answer back to B.
 *   (2) A DECLINES TO RELAY: same question, A's note matches, A chooses not
 *       to forward. No wire traffic to Jakob at all for this leg.
 *   (3) JAKOB DECLINES: A forwards, Jakob's own device has the ladder but
 *       he taps "no".
 *   (4) JAKOB HAS NOTHING: A forwards a DIFFERENT question Jakob's own
 *       inventory does not match.
 *   (5) DEPTH CAP: B's query already carries `relayed: true` (simulating an
 *       attempt to pre-relay). A's note would otherwise match, but the I8
 *       guard (`!q.relayed`) must fold this into an ordinary no-match with
 *       NO wire traffic to Jakob at all.
 *   (6) GENUINE NO MATCH: an unrelated question, no note, no relay
 *       eligible, ordinary "nothing".
 *   (7) SAME QID, TWICE: (2) and (3) re-run against one pinned qid, both
 *       over the live relay, to pin the STRICT ciphertext-byte-identity
 *       claim against real network bytes (legs 2-6 each use their own
 *       fresh qid, which is realistic but means AES-GCM's
 *       deterministic-IV-from-qid scheme makes their raw ciphertext differ
 *       even though the plaintext underneath is identical -- see THE PROOF
 *       below for why that is not a gap).
 *   (8) TIMING WIRING (the fixed-at-receipt dispatch pattern): legs 1-7
 *       above prove CONTENT byte-identity but never exercised the deadline
 *       itself -- an earlier version of main.ts's ceremony called
 *       `settleAt(receivedAt, RELAY_DEADLINE_MS)` from INSIDE each ending,
 *       AFTER a human had already decided; `settleAt` resolves immediately
 *       once its target instant has already passed (gate.ts's own doc
 *       comment says so), so any ending reached after a human took longer
 *       than the window fired EARLY, at whatever moment the human acted --
 *       turning B's own received-at timestamp into a hop-count oracle. The
 *       fix (main.ts's `createRelayDispatch`) arms ONE timer at RECEIPT,
 *       before any human interaction, and a `resolve()` call only ever
 *       updates what will be sent when that timer fires -- a resolve that
 *       arrives after the timer already fired is simply too late. This leg
 *       reproduces that exact pattern (with a short LOCAL deadline, not the
 *       real 30s constant -- already pinned separately by
 *       test/second_hop_timing.test.ts's fake-timer test -- to keep this
 *       live run fast) against the real relay, twice: once with an
 *       immediate resolve (must still wait for the deadline, not fire
 *       early) and once with a resolve deliberately delayed PAST the
 *       deadline (must already have sent "nothing" by then, with the late
 *       resolve producing no second message).
 *
 * THE PROOF: legs (2)-(6) must all decrypt, under the real live A<->B pair
 * key, to the IDENTICAL all-zero plaintext, despite five structurally
 * different causes -- one of them (leg 3/4) involving a real second device
 * a full network round trip away, on a device B has never heard of. Leg (7)
 * additionally proves the stricter, wire-level claim (byte-identical
 * ciphertext, not just identical plaintext) against two of those causes at
 * a single fixed qid, over the live relay both times -- the same claim
 * test/second_hop_gate.test.ts proves as a pure function, now proven
 * end to end. Leg (1) must differ from all of them and must carry Jakob's
 * true name, verbatim, to B.
 *
 * Run with tsx:
 *
 *   cd apps/demo && npx tsx test/e2e/second_hop.mjs
 */
import { createIdentity } from '../../src/did.ts'
import { createRelayChannel } from '../../src/relay.ts'
import { derivePairKey, fromB64u, open } from '../../src/crypto.ts'
import { decide, interpret, maskAnswerPlaintext, sealAnswerEnvelope, truncateSharedJson } from '../../src/gate.ts'
import { answerKeyFor, sealRelayAnswer } from '../../src/answer_key.ts'
import { addInventoryItem, threadsInScope } from '../../src/state.ts'
import { freeTextTemplate } from '../../src/data/free_text_query.ts'
import { matchTemplate } from '../../src/match/lexical.ts'
// Scenario A (the flat) -- reused directly from demo 20's own modules, not
// copied, same instruction the production code follows (main.ts's
// templatesForScenario). matchAccommodation() ignores VITE_WOT_ADDRESS
// entirely at the type/logic level tested here; ADDRESS itself resolves to
// geologengasse.ts's own placeholder string whenever this test is run
// without VITE_WOT_ADDRESS set, exactly like an address-free production
// build -- see this file's own leg 9 assertions for what that implies.
import {
  ACCOMMODATION_TEMPLATE, ACCOMMODATION_TEMPLATE_ID, accommodationAbstractText, matchAccommodation,
} from '../../src/match/accommodation.ts'
import { ADDRESS } from '../../src/data/geologengasse.ts'

const RELAY_ORIGIN = process.env.RELAY_ORIGIN || 'https://questhub.eco'
const DELIVERY_TIMEOUT_MS = 15_000
const NO_DELIVERY_TIMEOUT_MS = 3_000 // for legs that must NOT deliver anything (depth cap, declined-to-relay)

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else {
    failures++
    console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`)
  }
}

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = () => {
      if (predicate()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error(`waitFor: timed out after ${timeoutMs}ms`))
      setTimeout(poll, 25)
    }
    poll()
  })
}

/** Never resolves true within `timeoutMs` -- used to prove the ABSENCE of a
 *  wire event (the depth cap and the decline-to-relay legs must never even
 *  reach Jakob's channel). Returns whether the predicate went true within
 *  the window (should be false for these legs). */
async function staysFalse(predicate, timeoutMs) {
  try {
    await waitFor(predicate, timeoutMs)
    return true // predicate went true -- the thing we wanted absent, happened
  } catch {
    return false // timed out without the predicate ever firing -- correct
  }
}

function makeDevice(id, displayName) {
  return {
    me: { id, displayName },
    threads: [],
    peers: [],
    profile: { displayName, bio: '', neighbourhood: '', languages: [] },
    inventory: [],
    queryLog: [],
  }
}

/** state.ts's secondBrainThread(), reproduced exactly (not importable --
 *  main.ts-local). See main.ts's own copy for the doc comment. */
function secondBrainThread(meDisplayName, note) {
  return {
    id: `sb:${note.id}`,
    title: 'Eigene Notizen (über andere)',
    kind: 'direct',
    participants: [meDisplayName],
    messages: [{ ts: note.createdAt, author: meDisplayName, text: note.text, system: false }],
    source: 'self',
    included: true,
  }
}

const JAKOB_LADDER_INVENTORY_TEXT = 'Hab eine 3-Meter-Leiter im Keller, kannst sie dir gern ausborgen.'
const A_NOTE_ABOUT_JAKOB_TEXT = 'Der Jakob hat eine Leiter, hab ich mal bei ihm gesehen.'
// Scenario A's own note -- see data/second_hop.ts's own copy and doc comment.
const A_NOTE_ABOUT_JAKOB_FLAT_TEXT =
  'Wenn der Jakob verreist, ist bei ihm ab und zu die Wohnung frei, falls jemand kurz übernachten will.'

async function main() {
  const t0 = Date.now()
  console.log(`second_hop: targeting ${RELAY_ORIGIN}`)

  const jakobId = createIdentity(`${RELAY_ORIGIN}/pending-relay-did-jakob-2hop`)
  const aId = createIdentity(`${RELAY_ORIGIN}/pending-relay-did-a-2hop`)
  const bId = createIdentity(`${RELAY_ORIGIN}/pending-relay-did-b-2hop`)

  const jakobChannel = createRelayChannel({ relayOrigin: RELAY_ORIGIN })
  const aChannel = createRelayChannel({ relayOrigin: RELAY_ORIGIN })
  const bChannel = createRelayChannel({ relayOrigin: RELAY_ORIGIN })

  const statusLog = []
  jakobChannel.onStatus((s) => statusLog.push(`jakob:${s}`))
  aChannel.onStatus((s) => statusLog.push(`a:${s}`))
  bChannel.onStatus((s) => statusLog.push(`b:${s}`))
  await Promise.all([jakobChannel.connect(jakobId), aChannel.connect(aId), bChannel.connect(bId)])
  ok(
    'all three drains authenticated (Jakob, A, B -- B never directly connects to Jakob at the transport layer either)',
    statusLog.includes('jakob:connected') && statusLog.includes('a:connected') && statusLog.includes('b:connected'),
  )

  const keyAJ = await derivePairKey('a-j-nonce-2hop', 'j-a-nonce-2hop') // A <-> Jakob
  const keyAB = await derivePairKey('a-b-nonce-2hop', 'b-a-nonce-2hop') // A <-> B
  // B has NO key at all to Jakob's DID -- structurally cannot decrypt
  // anything addressed to/from him even if it crossed her drain, which it
  // never does (the relay routes by DID, and B's channel is never told
  // Jakob's).

  const jakobState = makeDevice('jakob', 'Jakob')
  addInventoryItem(jakobState, JAKOB_LADDER_INVENTORY_TEXT)

  const aState = makeDevice('a0000000', 'A')
  aState.peers.push({ id: 'jakob', displayName: 'Jakob', did: jakobId.did, nonceSelf: '', noncePeer: '', connectedAt: t0, blocked: false })
  // TWO notes -- scenario B (the ladder) and scenario A (the flat) -- see
  // main.ts's seedSecondHopGuest and state.ts's own doc comment on why this
  // is an array, not a single note.
  aState.secondBrainNotes = [
    {
      id: 'note1', text: A_NOTE_ABOUT_JAKOB_TEXT, createdAt: new Date().toISOString(),
      ownerPeerId: 'jakob', ownerDisplayName: 'Jakob',
    },
    {
      id: 'note2', text: A_NOTE_ABOUT_JAKOB_FLAT_TEXT, createdAt: new Date().toISOString(),
      ownerPeerId: 'jakob', ownerDisplayName: 'Jakob',
    },
  ]

  const bIdentity = { id: 'b0000000', displayName: 'B' }

  // ---- Wire capture -------------------------------------------------------
  const jakobQueries = []
  jakobChannel.onEnvelope(keyAJ, (envelope) => { if (envelope.t === 'query') jakobQueries.push(envelope) })
  const bAnswers = []
  bChannel.onEnvelope(keyAB, (envelope) => { if (envelope.t === 'answer') bAnswers.push(envelope) })
  // A's channel receives from BOTH Jakob (keyAJ) and B (keyAB) -- a single
  // fixed key only ever covers one peer (relay.ts's onEnvelope doc comment),
  // so this needs the SAME PairKeyResolver shape main.ts's
  // registerRelaySink() and call_into_the_web.mjs's Nora channel both use.
  const jakobAnswers = []
  const aQueries = []
  const aKeyByDid = new Map([[jakobId.did, keyAJ], [bId.did, keyAB]])
  aChannel.onEnvelope(
    (fromDid) => aKeyByDid.get(fromDid) ?? null,
    (envelope, fromDid) => {
      if (envelope.t === 'answer' && fromDid === jakobId.did) jakobAnswers.push(envelope)
      if (envelope.t === 'query' && fromDid === bId.did) aQueries.push(envelope)
    },
  )

  const nothingBodies = {}

  /**
   * A's own relay-ceremony logic, reproduced call-for-call against main.ts's
   * runSecondHopRelayCeremony/forwardToOwner/sendSecondHopFinalAnswer:
   * direct match (always empty here) -> note-match (D16 guard: !q.relayed,
   * live owner peer) -> if eligible AND `wantsToRelay`, forward and wait;
   * else fall straight to "nothing". Always ends by sealing through the
   * SAME gate.ts primitives main.ts uses and sending to B.
   */
  async function aHandlesQuery(q, { wantsToRelay = true, jakobConsents = true } = {}) {
    // Confirm actual delivery over the live relay before A "acts" on it --
    // same discipline call_into_the_web.mjs uses (waitFor, never assume
    // send() implies arrival) -- and use the RECEIVED copy, not the locally
    // held object, so this leg genuinely exercises the wire, not a local
    // simulation of it.
    await waitFor(() => aQueries.some((e) => e.qid === q.qid), DELIVERY_TIMEOUT_MS)
    const received = aQueries.find((e) => e.qid === q.qid)

    // Resolve the incoming template exactly like main.ts's
    // resolveIncomingTemplate: free text -> freeTextTemplate(); a fixed
    // template id -> the matching QueryTemplate (only ACCOMMODATION_TEMPLATE
    // is exercised by this script's own legs).
    const tpl = received.freeText
      ? freeTextTemplate(received.freeText)
      : received.templateId === ACCOMMODATION_TEMPLATE_ID ? ACCOMMODATION_TEMPLATE : freeTextTemplate('')
    const directMatch = matchTemplate(tpl, threadsInScope(aState))
    if (directMatch.aboveThreshold) throw new Error('unexpected direct match on A -- test fixture bug')

    // Search ALL of A's eligible notes together, exactly like main.ts's
    // runSecondHopRelayCeremony now does (state.ts's secondBrainNotes is an
    // array) -- one matchTemplate() call across every note's own synthetic
    // thread, the winning hit's threadId says which note (and therefore
    // which owner) actually scored.
    const eligibleNotes = (!received.relayed ? aState.secondBrainNotes ?? [] : [])
      .map((note) => ({ note, ownerPeer: aState.peers.find((p) => p.id === note.ownerPeerId && p.did && p.id !== received.from.id) }))
      .filter((x) => Boolean(x.ownerPeer))
    const noteMatch = eligibleNotes.length
      ? matchTemplate(tpl, eligibleNotes.map((x) => secondBrainThread(aState.me.displayName, x.note)))
      : { hits: [], distinctAuthors: 0, aboveThreshold: false }
    const winner = noteMatch.aboveThreshold
      ? eligibleNotes.find((x) => `sb:${x.note.id}` === noteMatch.hits[0]?.threadId)
      : undefined

    let payload = null
    if (winner && wantsToRelay) {
      const { note, ownerPeer } = winner
      const downstreamQid = `qid-2hop-downstream-${Math.random().toString(36).slice(2, 10)}`
      const forwardQ = {
        v: 1, t: 'query', from: aState.me, templateId: received.templateId, templateVersion: received.templateVersion,
        qid: downstreamQid, issuedAt: Date.now(), relayed: true, ...(received.freeText ? { freeText: received.freeText } : {}),
      }
      const jakobAnswersBefore = jakobAnswers.length
      await aChannel.send(ownerPeer.did, forwardQ, keyAJ)
      await waitFor(() => jakobQueries.some((e) => e.qid === downstreamQid), DELIVERY_TIMEOUT_MS)
      const jakobReceived = jakobQueries.find((e) => e.qid === downstreamQid)

      // ---- Jakob's own device: ordinary consent ceremony, unmodified ----
      // isAddressBearingTemplate's own check, reproduced: the accommodation
      // template routes to matchAccommodation() (a pure function of
      // ADDRESS/FREE_FROM/FREE_TO, needs no seeding), every other template
      // goes through the ordinary lexical matcher against his real
      // inventory -- exactly main.ts's runConsentCeremony branch.
      const jTpl = jakobReceived.freeText
        ? freeTextTemplate(jakobReceived.freeText)
        : jakobReceived.templateId === ACCOMMODATION_TEMPLATE_ID ? ACCOMMODATION_TEMPLATE : freeTextTemplate('')
      const jMatch = jTpl.id === ACCOMMODATION_TEMPLATE_ID
        ? matchAccommodation()
        : matchTemplate(jTpl, threadsInScope(jakobState))
      const { envelope: jEnv } = await decide({
        query: jakobReceived, template: jTpl, match: jMatch, consent: jakobConsents, blocked: false,
        key: keyAJ, identity: jakobState.me,
      })
      await jakobChannel.send(aId.did, jEnv, keyAJ)
      await waitFor(() => jakobAnswers.length > jakobAnswersBefore, DELIVERY_TIMEOUT_MS)
      const jDecoded = await interpret(jEnv, keyAJ)

      if (jDecoded.outcome === 'shared') {
        // DECISIONS.md D27: anonymous by default. The WIRE payload's `from`
        // is always '' -- never Jakob's real name, matching main.ts's
        // forwardToOwner/resolvePayload split exactly. `localFrom` mirrors
        // what A's own LOCAL record would show (I6/D24) -- not asserted on
        // here (this script does not simulate A's UI state), kept only so
        // this reproduction stays visibly parallel to production's split.
        const localFrom = jDecoded.shared.from || note.ownerDisplayName
        void localFrom
        // DECISIONS.md D29: a second-hop answer must never carry a real
        // street address -- stripped HERE, before sealing, matching
        // main.ts's forwardToOwner exactly (same `q.templateId` check, same
        // accommodationAbstractText() replacement).
        const addressBearingRelay = received.templateId === ACCOMMODATION_TEMPLATE_ID
        payload = {
          from: '',
          templateId: received.templateId,
          items: addressBearingRelay
            ? jDecoded.shared.items.map((it) => ({ ...it, text: accommodationAbstractText() }))
            : jDecoded.shared.items,
        }
      }
    }

    const jsonBytes = truncateSharedJson(payload ?? { from: '', templateId: q.templateId, items: [] })
    const plaintext = maskAnswerPlaintext(Boolean(payload), jsonBytes)
    const finalEnvelope = await sealAnswerEnvelope(q.qid, plaintext, keyAB)
    await aChannel.send(bId.did, finalEnvelope, keyAB)
    return finalEnvelope
  }

  // ===== Leg 1: SUCCESS =====================================================
  const q1 = {
    v: 1, t: 'query', from: bIdentity, freeText: 'Hat wer eine Leiter, die ich mir ausborgen könnte?',
    templateId: freeTextTemplate('x').id, templateVersion: 1,
    qid: `qid-2hop-leg1-${Math.random().toString(36).slice(2, 10)}`, issuedAt: Date.now(),
  }
  await bChannel.send(aId.did, q1, keyAB)
  const env1 = await aHandlesQuery(q1)
  await waitFor(() => bAnswers.some((e) => e.qid === q1.qid), DELIVERY_TIMEOUT_MS)
  const decoded1 = await interpret(env1, keyAB)
  ok('leg 1 (success): B\'s decoded outcome is "shared"', decoded1.outcome === 'shared')
  // CORRECTED (DECISIONS.md D27, supersedes this app's own former D23):
  // the second-hop answer is ANONYMOUS by default -- B never learns that
  // Jakob, specifically, answered, only that someone A trusts did.
  ok('leg 1: the answer is ANONYMOUS -- B never learns who actually answered', decoded1.shared?.from === '')
  ok('leg 1: the ladder text reached B unchanged', decoded1.shared?.items?.[0]?.text === JAKOB_LADDER_INVENTORY_TEXT)
  // Structural, not a runtime check: bChannel.onEnvelope above is registered
  // ONLY with keyAB -- Jakob's key/DID is never given to B's channel at all,
  // so there is no transport-level path for B to ever address or decrypt
  // anything to/from Jakob directly, regardless of what A does.

  // ===== Leg 2: A DECLINES TO RELAY =========================================
  const q2 = { ...q1, qid: `qid-2hop-leg2-${Math.random().toString(36).slice(2, 10)}` }
  const jakobQueriesBeforeLeg2 = jakobQueries.length
  await bChannel.send(aId.did, q2, keyAB)
  const env2 = await aHandlesQuery(q2, { wantsToRelay: false })
  const leg2Delivered = await staysFalse(() => jakobQueries.length > jakobQueriesBeforeLeg2, NO_DELIVERY_TIMEOUT_MS)
  ok('leg 2 (A declines to relay): NOTHING was ever sent to Jakob\'s channel', !leg2Delivered)
  nothingBodies.leg2_a_declines = env2.body

  // ===== Leg 3: JAKOB DECLINES ==============================================
  const q3 = { ...q1, qid: `qid-2hop-leg3-${Math.random().toString(36).slice(2, 10)}` }
  await bChannel.send(aId.did, q3, keyAB)
  const env3 = await aHandlesQuery(q3, { jakobConsents: false })
  nothingBodies.leg3_jakob_declines = env3.body

  // ===== Leg 4: JAKOB HAS NOTHING ===========================================
  // A's note still matches (it is about the ladder, always), so the forward
  // still reaches Jakob -- but HIS OWN inventory is emptied for this one
  // leg, so his own decide() genuinely returns 'no-match', not 'declined'.
  // Same question text as leg 1, different qid.
  const q4 = { ...q1, qid: `qid-2hop-leg4-${Math.random().toString(36).slice(2, 10)}` }
  await bChannel.send(aId.did, q4, keyAB)
  const savedInventory = jakobState.inventory
  jakobState.inventory = []
  const env4 = await aHandlesQuery(q4)
  jakobState.inventory = savedInventory // restore for legs 5/6
  nothingBodies.leg4_jakob_no_match = env4.body

  // ===== Leg 5: DEPTH CAP (query already relayed) ===========================
  const q5 = { ...q1, qid: `qid-2hop-leg5-${Math.random().toString(36).slice(2, 10)}`, relayed: true }
  const jakobQueriesBeforeLeg5 = jakobQueries.length
  await bChannel.send(aId.did, q5, keyAB)
  const env5 = await aHandlesQuery(q5)
  const leg5Delivered = await staysFalse(() => jakobQueries.length > jakobQueriesBeforeLeg5, NO_DELIVERY_TIMEOUT_MS)
  ok('leg 5 (I8 depth cap, relayed: true incoming): NOTHING was ever sent to Jakob\'s channel', !leg5Delivered)
  nothingBodies.leg5_depth_cap = env5.body

  // ===== Leg 6: GENUINE NO MATCH =============================================
  const q6 = {
    v: 1, t: 'query', from: bIdentity, freeText: 'Kennt jemand einen guten Zahnarzt?',
    templateId: freeTextTemplate('x').id, templateVersion: 1,
    qid: `qid-2hop-leg6-${Math.random().toString(36).slice(2, 10)}`, issuedAt: Date.now(),
  }
  await bChannel.send(aId.did, q6, keyAB)
  const env6 = await aHandlesQuery(q6)
  nothingBodies.leg6_genuine_no_match = env6.body

  // ===== Leg 7: SAME QID, two different nothing-causes, both over the live
  // relay. This leg IS the C-02/F-01 reproduction: it answers ONE qid twice
  // under ONE A<->B pair key, over the real relay -- exactly the sequence a
  // redelivered (un-acked) wire produces in production, since nothing
  // dedupes qid on the answering side.
  //
  // UPDATED 2026-09-05: it used to assert the two ciphertexts were
  // BYTE-IDENTICAL, which was true only because the AES-GCM IV was
  // SHA-256(qid) while the key is a function of the pair alone -- i.e. the
  // assertion was pinning a nonce-reuse bug in place. Had these two answers
  // differed in content (a note added between deliveries, a human tapping
  // yes the second time), the shared nonce would have leaked the shared
  // payload outright: "nothing" is an all-zero plaintext, so
  // C_nothing XOR C_shared = P_shared exactly. The IV is random per seal
  // now, so the claim this leg proves is inverted: the NONCES must DIFFER,
  // while the wire shape and the decrypted plaintext stay identical (the
  // latter is checked with every other nothing-cause at the bottom of this
  // file, since both bodies are added to `nothingBodies`).
  // =========================================================================
  const SHARED_QID = `qid-2hop-leg7-shared-${Math.random().toString(36).slice(2, 10)}`
  const q7a = { ...q1, qid: SHARED_QID } // A declines to relay
  await bChannel.send(aId.did, q7a, keyAB)
  const env7a = await aHandlesQuery(q7a, { wantsToRelay: false })
  const q7b = { ...q1, qid: SHARED_QID } // Jakob declines
  await bChannel.send(aId.did, q7b, keyAB)
  const env7b = await aHandlesQuery(q7b, { jakobConsents: false })
  const iv7a = fromB64u(env7a.body).slice(0, 12)
  const iv7b = fromB64u(env7b.body).slice(0, 12)
  ok('leg 7 (same qid, live relay both ways): the two answers do NOT share an AES-GCM nonce [C-02]',
    !Buffer.from(iv7a).equals(Buffer.from(iv7b)),
    `${Buffer.from(iv7a).toString('hex')} vs ${Buffer.from(iv7b).toString('hex')}`)
  ok('leg 7 (same qid, live relay both ways): "A declines" and "Jakob declines" are identical in wire shape',
    env7a.body.length === env7b.body.length, `${env7a.body.length} vs ${env7b.body.length}`)
  nothingBodies.leg7a_a_declines_shared_qid = env7a.body
  nothingBodies.leg7b_jakob_declines_shared_qid = env7b.body

  // ===== Leg 8: TIMING WIRING (fixed-at-receipt dispatch, real relay) ======
  // Reproduces main.ts's createRelayDispatch pattern directly, BOTH modes
  // (DECISIONS.md D28): a timer is armed HERE, at receipt, BEFORE any
  // "human" decision -- it is the ONLY thing that ever sends in uniform
  // mode, and the backstop in fast mode. A short local deadline (not the
  // real 30s constant) keeps this live leg fast.
  const TEST_DEADLINE_MS = 2000
  function createTestDispatch(qid, receivedAt, fastMode) {
    let dispatched = false
    let sentAt = null
    let resolved = null
    let resolveFireExternal
    const firePromise = new Promise((resolveFire) => { resolveFireExternal = resolveFire })
    const fire = async () => {
      if (dispatched) return
      dispatched = true
      const payload = resolved
      const jsonBytes = truncateSharedJson(payload ?? { from: '', templateId: 'x', items: [] })
      const plaintext = maskAnswerPlaintext(Boolean(payload), jsonBytes)
      const envelope = await sealAnswerEnvelope(qid, plaintext, keyAB)
      sentAt = Date.now()
      await aChannel.send(bId.did, envelope, keyAB)
      resolveFireExternal()
    }
    setTimeout(() => { void fire() }, Math.max(0, receivedAt + TEST_DEADLINE_MS - Date.now()))
    return {
      resolve(payload) {
        if (dispatched) return
        resolved = payload
        if (fastMode) void fire()
      },
      firePromise,
      get dispatchedAt() { return sentAt },
    }
  }

  // 8a: UNIFORM mode, fast resolve -- must still wait for the deadline, not
  // fire early (the opt-in mode's whole point).
  const q8a = { ...q1, qid: `qid-2hop-leg8a-${Math.random().toString(36).slice(2, 10)}` }
  const receivedAt8a = Date.now()
  const dispatch8a = createTestDispatch(q8a.qid, receivedAt8a, false)
  dispatch8a.resolve({ from: 'Jakob', templateId: 'x', items: [{ text: 'sofort', when: 'jetzt', context: 'test' }] })
  await dispatch8a.firePromise
  const elapsed8a = dispatch8a.dispatchedAt - receivedAt8a
  ok('leg 8a (uniform mode, fast resolve): send happened at-or-after the fixed deadline, not immediately',
    elapsed8a >= TEST_DEADLINE_MS - 50, `elapsed=${elapsed8a}ms, deadline=${TEST_DEADLINE_MS}ms`)
  await waitFor(() => bAnswers.some((e) => e.qid === q8a.qid), DELIVERY_TIMEOUT_MS)
  const decoded8a = await interpret(bAnswers.find((e) => e.qid === q8a.qid), keyAB)
  ok('leg 8a: content resolved before the deadline DOES reach B', decoded8a.outcome === 'shared')

  // 8b: UNIFORM mode, SLOW resolve -- deliberately arrives AFTER the
  // deadline already fired. The dispatch must already have sent "nothing";
  // the late resolve() call must be a documented no-op, never a second
  // message.
  const q8b = { ...q1, qid: `qid-2hop-leg8b-${Math.random().toString(36).slice(2, 10)}` }
  const receivedAt8b = Date.now()
  const dispatch8b = createTestDispatch(q8b.qid, receivedAt8b, false)
  await new Promise((r) => setTimeout(r, TEST_DEADLINE_MS + 200)) // wait past the window, then poll for fire()
  // completing (its own async seal+network-send work runs after the deadline
  // instant itself, so poll rather than assume it finished within +200ms).
  await waitFor(() => dispatch8b.dispatchedAt !== null, DELIVERY_TIMEOUT_MS)
  const dispatchedBeforeLateResolve = dispatch8b.dispatchedAt
  ok('leg 8b: the shared timer already fired BEFORE the slow decision arrived', dispatchedBeforeLateResolve !== null)
  dispatch8b.resolve({ from: 'Jakob', templateId: 'x', items: [{ text: 'zu spät', when: 'jetzt', context: 'test' }] })
  await dispatch8b.firePromise
  await waitFor(() => bAnswers.some((e) => e.qid === q8b.qid), DELIVERY_TIMEOUT_MS)
  const b8bAnswers = bAnswers.filter((e) => e.qid === q8b.qid)
  ok('leg 8b: exactly ONE envelope reached B for this qid -- no second message from the late resolve',
    b8bAnswers.length === 1, `count=${b8bAnswers.length}`)
  const decoded8b = await interpret(b8bAnswers[0], keyAB)
  ok('leg 8b: B\'s outcome is "nothing" -- the late "yes" never overrides what the deadline already sent',
    decoded8b.outcome === 'nothing')
  ok('leg 8b: sent at-or-just-after the fixed deadline, not when the late resolve ran',
    dispatchedBeforeLateResolve - receivedAt8b < TEST_DEADLINE_MS + 800,
    `sent at t+${dispatchedBeforeLateResolve - receivedAt8b}ms`)
  nothingBodies.leg8b_late_resolve_is_noop = b8bAnswers[0].body

  // 8c: FAST mode (the DEFAULT, DECISIONS.md D28) -- resolve() must send
  // IMMEDIATELY, not wait for the deadline at all. This is the leg that
  // would catch a regression back to the old unconditional-uniform
  // behaviour becoming the silent default again.
  const q8c = { ...q1, qid: `qid-2hop-leg8c-${Math.random().toString(36).slice(2, 10)}` }
  const receivedAt8c = Date.now()
  const dispatch8c = createTestDispatch(q8c.qid, receivedAt8c, true)
  dispatch8c.resolve({ from: 'Jakob', templateId: 'x', items: [{ text: 'schnell', when: 'jetzt', context: 'test' }] })
  await dispatch8c.firePromise
  const elapsed8c = dispatch8c.dispatchedAt - receivedAt8c
  ok('leg 8c (fast mode, the default): send happened WELL BEFORE the fixed deadline, not at it',
    elapsed8c < TEST_DEADLINE_MS - 200, `elapsed=${elapsed8c}ms, deadline=${TEST_DEADLINE_MS}ms`)
  await waitFor(() => bAnswers.some((e) => e.qid === q8c.qid), DELIVERY_TIMEOUT_MS)
  const decoded8c = await interpret(bAnswers.find((e) => e.qid === q8c.qid), keyAB)
  ok('leg 8c: content resolved fast DOES reach B, quickly', decoded8c.outcome === 'shared')

  // 8d: FAST mode, nothing ever resolves -- the armed timer is still the
  // backstop (a dead note, an unresolvable template): B still gets exactly
  // one "nothing" answer, at the deadline, never left hanging forever.
  const q8d = { ...q1, qid: `qid-2hop-leg8d-${Math.random().toString(36).slice(2, 10)}` }
  const receivedAt8d = Date.now()
  const dispatch8d = createTestDispatch(q8d.qid, receivedAt8d, true)
  await dispatch8d.firePromise
  const elapsed8d = dispatch8d.dispatchedAt - receivedAt8d
  ok('leg 8d (fast mode, nothing ever resolved): the armed timer still fires, at the deadline',
    elapsed8d >= TEST_DEADLINE_MS - 50, `elapsed=${elapsed8d}ms`)
  await waitFor(() => bAnswers.some((e) => e.qid === q8d.qid), DELIVERY_TIMEOUT_MS)
  const decoded8d = await interpret(bAnswers.find((e) => e.qid === q8d.qid), keyAB)
  ok('leg 8d: outcome is "nothing"', decoded8d.outcome === 'nothing')

  // ===== Leg 9: SCENARIO A -- the flat, via two hops =========================
  // The owner's own "one iphone scans from the laptop, johannes is in my
  // net, a second phone connects to johannes and can reach the flat" --
  // reusing demo 20's own accommodation template/matcher directly (not
  // copied). B asks the FIXED template (not free text, unlike scenario B's
  // ladder) -> A has no direct match -> A's FLAT note (note2, NOT the
  // ladder note) scores against ACCOMMODATION_TEMPLATE's own matchTerms and
  // wins the two-notes-at-once matchTemplate() call -> A forwards ->
  // Jakob's device routes to matchAccommodation() (not the ordinary lexical
  // matcher, since isAddressBearingTemplate(tpl) is true) -> the
  // address-bearing item flows back to B, anonymous (D27) exactly like
  // scenario B's ladder leg -- the anonymous default applies identically
  // regardless of what is actually being shared.
  const q9 = {
    v: 1, t: 'query', from: bIdentity, templateId: ACCOMMODATION_TEMPLATE_ID, templateVersion: 1,
    qid: `qid-2hop-leg9-${Math.random().toString(36).slice(2, 10)}`, issuedAt: Date.now(),
  }
  await bChannel.send(aId.did, q9, keyAB)
  const env9 = await aHandlesQuery(q9)
  await waitFor(() => bAnswers.some((e) => e.qid === q9.qid), DELIVERY_TIMEOUT_MS)
  const decoded9 = await interpret(env9, keyAB)
  ok('leg 9 (scenario A, the flat): B\'s decoded outcome is "shared"', decoded9.outcome === 'shared')
  ok('leg 9: the FLAT note won the two-notes-at-once match, not the ladder note (item text is the accommodation hit, not the ladder text)',
    decoded9.shared?.items?.[0]?.text !== JAKOB_LADDER_INVENTORY_TEXT)
  ok('leg 9: still ANONYMOUS -- B never learns who actually answered, same default as scenario B',
    decoded9.shared?.from === '')
  // DECISIONS.md D29 (owner correction): a second-hop answer must NEVER
  // carry the real street address -- a PAYLOAD property, proven here at
  // the byte level against the REAL WIRE BYTES that actually crossed the
  // live relay, not just against a local object. The plaintext byte-level
  // check (below) is the strict form of this claim; the decoded-item check
  // here is the same claim at the decoded-content level.
  ok('leg 9: the DECODED item text is the ABSTRACTION (city + free window), never the real ADDRESS',
    decoded9.shared?.items?.[0]?.text === accommodationAbstractText()
    && !decoded9.shared?.items?.[0]?.text?.includes(ADDRESS),
    decoded9.shared?.items?.[0]?.text)
  const combined9 = fromB64u(env9.body)
  const plain9 = await open(keyAB, combined9.slice(0, 12), combined9.slice(12))
  // Raw BYTE search, not a text-decode-then-substring search: the plaintext
  // is [tag, len-hi, len-lo, JSON bytes..., zero padding], and the JSON
  // bytes are UTF-8 (see gate.ts's truncateSharedJson). ADDRESS can contain
  // non-ASCII characters (ä/ö/ü/ß are ordinary in an Austrian street
  // address) -- decoding the buffer as latin1 (a 1:1 byte-to-codepoint
  // mapping, NOT a UTF-8 decoder) would mangle those multi-byte UTF-8
  // sequences and could report "not present" for an address that IS present
  // in the actual bytes that crossed the wire. Buffer#includes with a Buffer
  // needle searches raw bytes directly, so this holds regardless of what
  // encoding ADDRESS's own characters happen to need, and regardless of the
  // trailing zero-padding after the JSON region.
  const addressBytes = Buffer.from(ADDRESS, 'utf8')
  const plain9Buf = plain9 ? Buffer.from(plain9) : null
  ok('leg 9: the RAW PLAINTEXT BYTES of the sealed envelope do not contain the ADDRESS string anywhere '
    + '(proves the redaction happened in the PAYLOAD, before sealing -- not only in how a screen renders it; '
    + 'checked as raw UTF-8 bytes, not a latin1-decoded string, so multi-byte characters cannot hide a leak)',
    plain9Buf !== null && !plain9Buf.includes(addressBytes))

  // ===== LEG 10: THE NO-PEER RELAY FINALISATION (follow-up 1 of the
  // C-02/F-01 crypto review, section 7.1 of
  // DEVLOG/wot-iv-review/iv-review_of-web-of-trust_report.txt).
  //
  // A relays a real answer back to a requester she holds NO peer record for
  // (`s.peers.find((p) => p.id === q.from.id)` came back undefined --
  // reachable because relay ingress matches on the wire's `fromDid` while
  // this lookup matches on the envelope's own `q.from.id`, and the two are
  // independent). `createRelayDispatch.resolvePayload` used to seal the real
  // relayed payload under `derivePairKey(q.qid, q.qid)` -- a key computable
  // by anyone who saw the cleartext qid.
  //
  // Sealed here through the SAME functions main.ts now calls (answer_key.ts,
  // which exists so that this is not a proxy), and pushed over the LIVE
  // relay so the bytes asserted on are bytes that really crossed it. The
  // OUTER wrap uses keyAB only so B's drain will hand the inner envelope
  // back for inspection; in the shipped app fire() would not send at all
  // without `peer?.did`, which is the second reason the no-peer payload has
  // no recipient. ==========================================================
  const q10 = {
    v: 1, t: 'query', from: bIdentity, templateId: ACCOMMODATION_TEMPLATE_ID, templateVersion: 1,
    qid: `qid-2hop-leg10-${Math.random().toString(36).slice(2, 10)}`, issuedAt: Date.now(),
  }
  const NO_PEER_SECRET = 'Geheime Wohnung, nur fuer B.'
  const ak10 = await answerKeyFor(null, q10.qid, async () => { throw new Error('unreachable: no peer') }, () => {})
  ok('leg 10: with no peer record, answerKeyFor refuses -- blocked', ak10.blocked === true)
  const env10 = await sealRelayAnswer(q10.qid, q10.templateId, {
    from: '', templateId: q10.templateId, items: [{ text: NO_PEER_SECRET, when: 'Mitte August', context: 'Relay' }],
  }, ak10)
  await aChannel.send(bId.did, env10, keyAB)
  await waitFor(() => bAnswers.some((e) => e.qid === q10.qid), DELIVERY_TIMEOUT_MS)
  const wire10 = bAnswers.find((e) => e.qid === q10.qid)
  ok('leg 10: the no-peer answer really crossed the live relay', Boolean(wire10))
  // The attacker's whole capability: the qid, which rides in cleartext in
  // this very envelope.
  const eavesKey10 = await derivePairKey(q10.qid, q10.qid)
  const combined10 = fromB64u(wire10.body)
  ok('leg 10: an observer holding ONLY the cleartext qid cannot decrypt it (the defect, closed)',
    (await open(eavesKey10, combined10.slice(0, 12), combined10.slice(12))) === null)
  ok('leg 10: interpret() under the qid key reads "nothing", never the payload',
    (await interpret(wire10, eavesKey10)).outcome === 'nothing')
  ok('leg 10: B, holding the real pair key, also reads "nothing" -- a device that does not know you says nothing',
    (await interpret(wire10, keyAB)).outcome === 'nothing')
  ok('leg 10: the payload never appears in the RAW WIRE BYTES',
    !Buffer.from(combined10).includes(Buffer.from(NO_PEER_SECRET, 'utf8')))
  ok('leg 10: the envelope is the SAME WIRE SHAPE as leg 9\'s genuine shared answer (I3: no absent-answer tell)',
    wire10.body.length === env9.body.length
    && JSON.stringify(Object.keys(wire10).sort()) === JSON.stringify(Object.keys(env9).sort()))
  // NOT added to `nothingBodies`: that proof decrypts every entry under
  // keyAB and compares plaintexts, and this one is deliberately
  // decryptable by NOBODY -- including B. Its I3 guarantee is therefore
  // made at the wire-shape level, asserted directly above, which is the
  // only level at which an observer can compare it to anything.

  // ===== THE PROOF: every "nothing" cause decrypts to the identical
  // all-zero plaintext, independently, under the real A<->B pair key -- the
  // property that actually matters to B, proven across genuinely different
  // qids (realistic) AND, for leg 7 above, across two answers that share one
  // qid and one pair key -- the case a redelivered wire produces. Note that
  // "identical PLAINTEXT under distinct nonces" is the honest form of this
  // claim; identical CIPHERTEXT is not required for I3 and, before C-02,
  // was only achievable by reusing an AES-GCM nonce. =======================
  const nothingEntries = Object.entries(nothingBodies)
  const plaintexts = []
  for (const [label, body] of nothingEntries) {
    const combined = fromB64u(body)
    const plain = await open(keyAB, combined.slice(0, 12), combined.slice(12))
    ok(`${label}: decrypts under the real A<->B pair key`, plain !== null)
    ok(`${label}: interpret() reads it as "nothing"`,
      (await interpret({ v: 1, t: 'answer', qid: 'irrelevant-for-interpret', body }, keyAB)).outcome === 'nothing')
    plaintexts.push([label, plain])
  }
  const [firstLabel, firstPlain] = plaintexts[0]
  for (const [label, plain] of plaintexts) {
    ok(`${label}: decrypted PLAINTEXT byte-identical to ${firstLabel} (the all-zero "nothing" buffer)`,
      plain && firstPlain && Buffer.from(plain).equals(Buffer.from(firstPlain)))
  }
  const decoded1Combined = fromB64u(env1.body)
  const decoded1Plain = await open(keyAB, decoded1Combined.slice(0, 12), decoded1Combined.slice(12))
  ok('leg 1 (success) plaintext is DIFFERENT from every nothing cause',
    !(decoded1Plain && firstPlain && Buffer.from(decoded1Plain).equals(Buffer.from(firstPlain))))

  jakobChannel.close()
  aChannel.close()
  bChannel.close()

  const totalMs = Date.now() - t0
  console.log(`\nTotal wall time: ${totalMs}ms`)

  if (failures > 0) {
    console.log(`\n${failures} assertion(s) FAILED`)
    process.exit(1)
  }
  console.log('\nAll assertions passed.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
