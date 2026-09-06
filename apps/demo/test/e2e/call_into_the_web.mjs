/**
 * The acceptance test the owner named for "call into the web" (In die Runde
 * fragen, DEVLOG/handover-inventory-call.md):
 *
 *   "two devices connected to the same link. on one a request should show
 *    up and on the other not, but on both there should be logs of the
 *    query."
 *
 * Runs the ACTUAL app modules -- state.ts, data/free_text_query.ts,
 * match/lexical.ts, incoming_query.ts, gate.ts -- directly in Node against
 * the LIVE relay at questhub.eco, in the same style as
 * relay_query_answer.mjs and connect_link_relay.mjs in this directory (no
 * browser: relay.ts's send/onEnvelope are origin-locked to the relay's own
 * CORS policy, so a browser page not actually served from questhub.eco
 * cannot drive this transport).
 *
 * Cast, matching the owner's own story:
 *   Nora     -- asks the network for "Ski", as free text.
 *   Marlene  -- has written "Ski" into her own "Was ich habe". Her device
 *               gets a real match above the (demo-overridden) anonymity
 *               floor, so the consent ceremony surfaces on her screen.
 *   Ben      -- has nothing matching "Ski" anywhere. His device gets no
 *               match, so NOTHING surfaces on his screen -- no notification,
 *               no screen change, nothing demanding attention.
 *
 * What this proves, precisely:
 *   1. The Ski story end to end: a free-text ask, broadcast to more than one
 *      connected peer, matched against an inventory entry (not a chat
 *      message), through the real consent gate, back to the asker.
 *   2. The exact interrupt decision main.ts's handleAmbientQuery() makes --
 *      classifyIncomingQuery() (incoming_query.ts), imported and called
 *      here, not reimplemented -- says surface:true for Marlene and
 *      surface:false for Ben, for the SAME broadcast query.
 *   3. Both devices append a QueryLogEntry (state.ts's appendQueryLog(),
 *      also imported, not reimplemented) -- I6 Auditability holds even for
 *      the device that showed nothing. Ben's (the silent side) is appended
 *      through answer_log.ts's logAndDispatch() -- the SAME function
 *      main.ts's emitAnswer() calls -- so this also exercises the ordering
 *      fix for the reported bug ("the local query log is NOT reliably
 *      written on the SILENT side"): the entry is appended BEFORE the send
 *      is attempted, not after it resolves. A separate case further down
 *      simulates that send never resolving at all (relay.ts's ingress POST
 *      has no timeout) and shows the log entry exists regardless.
 *   4. The log cannot become a side channel: the SAME pair of cases
 *      (a real match the owner declines to share, vs a genuine no-match) is
 *      run once here as a direct byte-identity check on gate.decide()'s
 *      output, and the two devices' LOCAL log entries for that pair are
 *      shown to differ ('declined' vs 'no-match') even though the wire does
 *      not. That is the entire argument: the log distinguishes exactly what
 *      the wire is built not to.
 *   5. A grep-level check that none of the five LocalOutcome labels
 *      ('shared'/'declined'/'below-k'/'no-match'/'blocked') appear anywhere
 *      in the JSON of any envelope actually sent over the wire in this run.
 *
 * Run with tsx:
 *
 *   cd apps/demo && npx tsx test/e2e/call_into_the_web.mjs
 */
import { createIdentity } from '../../src/did.ts'
import { createRelayChannel } from '../../src/relay.ts'
import { derivePairKey, open, fromB64u } from '../../src/crypto.ts'
import { decide, interpret } from '../../src/gate.ts'
import { addInventoryItem, threadsInScope, appendQueryLog } from '../../src/state.ts'
import { logAndDispatch } from '../../src/answer_log.ts'
import { freeTextTemplate } from '../../src/data/free_text_query.ts'
import { matchTemplate } from '../../src/match/lexical.ts'
import { classifyIncomingQuery } from '../../src/incoming_query.ts'

const RELAY_ORIGIN = process.env.RELAY_ORIGIN || 'https://questhub.eco'
const DELIVERY_TIMEOUT_MS = 15_000

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

/** A minimal, but real, DeviceState -- built with the actual state.ts
 *  functions (addInventoryItem), not a hand-rolled fixture, so this test
 *  exercises the exact same object shape main.ts's handleAmbientQuery()
 *  reads from. */
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

/** Every envelope actually sent over the wire in this run, for the
 *  grep-level "no LocalOutcome label leaked onto the wire" check at the
 *  end. */
const wireSends = []

async function main() {
  const t0 = Date.now()
  console.log(`call_into_the_web: targeting ${RELAY_ORIGIN}`)

  const nora = createIdentity(`${RELAY_ORIGIN}/pending-relay-did-nora-citw`)
  const marlene = createIdentity(`${RELAY_ORIGIN}/pending-relay-did-marlene-citw`)
  const ben = createIdentity(`${RELAY_ORIGIN}/pending-relay-did-ben-citw`)

  const noraChannel = createRelayChannel({ relayOrigin: RELAY_ORIGIN })
  const marleneChannel = createRelayChannel({ relayOrigin: RELAY_ORIGIN })
  const benChannel = createRelayChannel({ relayOrigin: RELAY_ORIGIN })

  const statusLog = []
  noraChannel.onStatus((s) => statusLog.push(`nora:${s}`))
  marleneChannel.onStatus((s) => statusLog.push(`marlene:${s}`))
  benChannel.onStatus((s) => statusLog.push(`ben:${s}`))

  await Promise.all([noraChannel.connect(nora), marleneChannel.connect(marlene), benChannel.connect(ben)])
  ok(
    'all three drains authenticated (two independent guest contexts, Marlene and Ben, plus the asker)',
    statusLog.includes('nora:connected') && statusLog.includes('marlene:connected') && statusLog.includes('ben:connected'),
  )

  // Distinct pair keys per peer -- exactly how main.ts's registerRelaySink()
  // PairKeyResolver looks one up per sender DID, and exactly why askNetwork()
  // sends a DISTINCT qid to each peer (one shared answer-waiting slot per
  // qid, see main.ts's waitForAnswer/awaitingAnswers doc comment).
  const keyMarlene = await derivePairKey('nora-marlene-nonce-citw', 'marlene-nora-nonce-citw')
  const keyBen = await derivePairKey('nora-ben-nonce-citw', 'ben-nora-nonce-citw')

  // ---- The two answering devices, built with the real state.ts API -------
  const marleneState = makeDevice('marlene0', 'Marlene')
  addInventoryItem(marleneState, 'Ski, kannst du dir ausborgen, steht im Keller.')

  const benState = makeDevice('ben00000', 'Ben')
  // Ben's inventory has something, but nothing to do with skis -- proves
  // this is a real no-match, not an empty-inventory special case.
  addInventoryItem(benState, 'Hab eine Bohrmaschine daheim, kannst sie dir ausborgen.')

  // ---- Nora broadcasts the SAME free-text ask to both, one qid each ------
  const freeText = 'Ski'
  const tpl = freeTextTemplate(freeText)
  // `from` is the app's Identity shape ({id, displayName}), never the did:
  // peer:2 identity object -- main.ts always sends `s.me` here, so this
  // mirrors that exactly.
  const noraIdentity = { id: 'nora0000', displayName: 'Nora' }
  const qMarlene = {
    v: 1, t: 'query', from: noraIdentity, freeText,
    templateId: tpl.id, templateVersion: tpl.version,
    qid: `qid-citw-marlene-${Math.random().toString(36).slice(2, 10)}`, issuedAt: Date.now(),
  }
  const qBen = {
    v: 1, t: 'query', from: noraIdentity, freeText,
    templateId: tpl.id, templateVersion: tpl.version,
    qid: `qid-citw-ben-${Math.random().toString(36).slice(2, 10)}`, issuedAt: Date.now(),
  }

  const marleneQueries = []
  marleneChannel.onEnvelope(keyMarlene, (envelope, fromDid) => {
    if (envelope.t === 'query') marleneQueries.push({ envelope, fromDid })
  })
  const benQueries = []
  benChannel.onEnvelope(keyBen, (envelope, fromDid) => {
    if (envelope.t === 'query') benQueries.push({ envelope, fromDid })
  })
  // Nora is paired to TWO peers, so her channel needs the SAME
  // PairKeyResolver shape main.ts's registerRelaySink() uses (a fixed single
  // key only ever covers one peer) -- see relay.ts's onEnvelope doc comment:
  // a channel keeps exactly one registration, and a second onEnvelope() call
  // with a different fixed key would silently replace the first, dropping
  // every answer encrypted under the key that got overwritten.
  const noraAnswers = []
  const noraKeyByDid = new Map([[marlene.did, keyMarlene], [ben.did, keyBen]])
  noraChannel.onEnvelope(
    (fromDid) => noraKeyByDid.get(fromDid) ?? null,
    (envelope, fromDid) => {
      if (envelope.t !== 'answer') return
      if (fromDid === marlene.did && envelope.qid === qMarlene.qid) noraAnswers.push({ from: 'marlene', envelope })
      if (fromDid === ben.did && envelope.qid === qBen.qid) noraAnswers.push({ from: 'ben', envelope })
    },
  )

  wireSends.push(qMarlene, qBen)
  await noraChannel.send(marlene.did, qMarlene, keyMarlene)
  await noraChannel.send(ben.did, qBen, keyBen)
  await waitFor(() => marleneQueries.length >= 1 && benQueries.length >= 1, DELIVERY_TIMEOUT_MS)
  ok('Marlene received the broadcast query over the relay', marleneQueries.length === 1)
  ok('Ben received the SAME broadcast query over the relay', benQueries.length === 1)
  ok('both queries carry the free text verbatim', marleneQueries[0].envelope.freeText === 'Ski' && benQueries[0].envelope.freeText === 'Ski')

  // ---- Each device matches locally and classifies -- the REAL functions --
  const matchMarlene = matchTemplate(tpl, threadsInScope(marleneState))
  const matchBen = matchTemplate(tpl, threadsInScope(benState))

  ok('Marlene\'s device really has a match ("Ski" found in her own inventory)', matchMarlene.hits.length === 1)
  ok('Marlene\'s match clears the anonymity floor (demo override, structural: inventory is one author)', matchMarlene.aboveThreshold === true)
  ok('Ben\'s device really has nothing matching "Ski"', matchBen.hits.length === 0)

  const classMarlene = classifyIncomingQuery(matchMarlene, false, true)
  const classBen = classifyIncomingQuery(matchBen, false, true)

  // ---- THE ACCEPTANCE CRITERION -------------------------------------------
  ok('on Marlene\'s device, a request surfaces (classifyIncomingQuery -- the actual app decision, not a proxy for it)', classMarlene.surface === true)
  ok('on Ben\'s device, NO request surfaces -- no notification, no screen change', classBen.surface === false)
  ok('Ben\'s silent classification is logged as no-match, not dropped', classBen.outcome === 'no-match')

  // ---- Marlene's human decision: she taps "Ja, teilen" (consent: true) --
  //      exactly what main.ts's finish(true) -> emitAnswer() does. --------
  const { outcome: outcomeMarlene, envelope: answerMarlene } = await decide({
    query: qMarlene, template: tpl, match: matchMarlene, consent: true, blocked: false, key: keyMarlene,
  })
  ok('Marlene\'s gate outcome really is "shared"', outcomeMarlene === 'shared')
  wireSends.push(answerMarlene)
  await marleneChannel.send(nora.did, answerMarlene, keyMarlene)

  // ---- Ben's device answers automatically -- consent: false, exactly what
  //      main.ts's handleAmbientQuery() -> emitAnswer(..., false, ..., {
  //      silent: true }) does for a query that never surfaced. Routed
  //      through logAndDispatch() (answer_log.ts) -- the REAL function
  //      emitAnswer() calls, not a reimplementation of its ordering -- so
  //      this exercises the exact sequencing the field bug was in: the local
  //      log entry is appended (and its persist kicked off) BEFORE the send
  //      below is even attempted, not after it returns. See the deliberate
  //      hang case further down for why that ordering is the fix, not
  //      incidental.
  const { outcome: outcomeBen, envelope: answerBen } = await decide({
    query: qBen, template: tpl, match: matchBen, consent: false, blocked: false, key: keyBen,
  })
  ok('Ben\'s gate outcome really is "no-match"', outcomeBen === 'no-match')
  wireSends.push(answerBen)
  await logAndDispatch(benState, {
    at: Date.now(), fromDisplayName: qBen.from.displayName, fromId: qBen.from.id,
    text: freeText, outcome: outcomeBen,
  }, () => benChannel.send(nora.did, answerBen, keyBen))
  ok('Ben\'s local log entry already exists once logAndDispatch() returns (appended before the send, not after)',
    benState.queryLog.length === 1 && benState.queryLog[0].outcome === 'no-match')

  await waitFor(() => noraAnswers.length >= 2, DELIVERY_TIMEOUT_MS)
  const fromMarlene = noraAnswers.find((a) => a.from === 'marlene')
  const fromBen = noraAnswers.find((a) => a.from === 'ben')
  ok('Nora received an answer from Marlene', Boolean(fromMarlene))
  ok('Nora received an answer from Ben', Boolean(fromBen))

  const decodedMarlene = await interpret(fromMarlene.envelope, keyMarlene)
  const decodedBen = await interpret(fromBen.envelope, keyBen)
  ok('Nora decodes Marlene\'s answer as "shared"', decodedMarlene.outcome === 'shared')
  ok('Nora sees the Ski item, verbatim', (decodedMarlene.shared?.items ?? []).some((i) => i.text.includes('Ski')))
  ok('Nora decodes Ben\'s answer as "nothing" (not distinguishable from a decline)', decodedBen.outcome === 'nothing')

  // ---- I6: BOTH devices log the query. Marlene's path (the surfaced,
  //      human-consent ceremony) is still exercised with the real
  //      appendQueryLog() directly, matching what runConsentCeremony's own
  //      call into emitAnswer ultimately does; Ben's is already logged above
  //      via logAndDispatch(). ---------------------------------------------
  appendQueryLog(marleneState, {
    at: Date.now(), fromDisplayName: qMarlene.from.displayName, fromId: qMarlene.from.id,
    text: freeText, outcome: outcomeMarlene,
  })
  ok('Marlene\'s local log has exactly one entry, outcome "shared"', marleneState.queryLog.length === 1 && marleneState.queryLog[0].outcome === 'shared')
  ok('Ben\'s local log has exactly one entry, outcome "no-match"', benState.queryLog.length === 1 && benState.queryLog[0].outcome === 'no-match')
  ok('both log entries name only THIS device\'s own asker (Nora), never each other', (
    marleneState.queryLog[0].fromId === 'nora0000' && benState.queryLog[0].fromId === 'nora0000' &&
    JSON.stringify(marleneState.queryLog).indexOf('ben00000') === -1 &&
    JSON.stringify(benState.queryLog).indexOf('marlene0') === -1
  ))

  // ---- THE REPORTED BUG, REPRODUCED DETERMINISTICALLY ---------------------
  //
  // "The local query log is NOT reliably written on the SILENT side": the
  // silent ambient path has no UI watching its send, so a stalled
  // RelayChannel.send() (relay.ts's ingress POST has no timeout/
  // AbortController -- see postToIngress) used to leave the local Protokoll
  // entry unwritten for as long as the network stayed stuck -- reproduced
  // live as "still missing after a 9 second wait", i.e. indefinitely, not
  // merely late. Simulated here with a `dispatch` that deliberately never
  // settles, through the SAME logAndDispatch() call Ben's answer above just
  // went through -- proof that I6 no longer depends on the network at all.
  const stuckDevice = makeDevice('stuck0000', 'Stuck-Silent')
  const neverSettles = new Promise(() => {})
  void logAndDispatch(stuckDevice, {
    at: Date.now(), fromDisplayName: 'Nora', fromId: 'nora0000', text: freeText, outcome: 'no-match',
  }, () => neverSettles)
  ok('[reported bug] the silent device\'s log entry exists immediately, even though its "send" never resolves',
    stuckDevice.queryLog.length === 1 && stuckDevice.queryLog[0].outcome === 'no-match')

  // ---- THE SIDE-CHANNEL PROOF ----------------------------------------------
  //
  // The discriminating pair, same key, same qid, same question: a real match
  // Marlene DECLINES to share, against a device with genuinely nothing. If
  // the wire distinguishes these, I3 is broken. It must not -- and the log,
  // which is allowed (and required, I6) to tell them apart locally, is
  // proven never to leak that distinction onto the wire.
  const sideChannelQid = `qid-citw-sidecheck-${Math.random().toString(36).slice(2, 10)}`
  const sideChannelQuery = { v: 1, t: 'query', from: qMarlene.from, freeText, templateId: tpl.id, templateVersion: tpl.version, qid: sideChannelQid, issuedAt: Date.now() }

  const declined = await decide({
    query: sideChannelQuery, template: tpl, match: matchMarlene, consent: false, blocked: false, key: keyMarlene,
  })
  const noMatch = await decide({
    query: sideChannelQuery, template: tpl, match: { hits: [], distinctAuthors: 0, aboveThreshold: false }, consent: false, blocked: false, key: keyMarlene,
  })
  ok('[side-channel check] declined and no-match, same key/qid: outcomes really differ locally', declined.outcome === 'declined' && noMatch.outcome === 'no-match')

  const declinedCipher = fromB64u(declined.envelope.body)
  const noMatchCipher = fromB64u(noMatch.envelope.body)

  // UPDATED 2026-09-05 (C-02/F-01): this used to assert the two bodies were
  // byte-identical, which held only because the AES-GCM IV was derived from
  // `qid`. That deterministic IV was a nonce-reuse hole (gate.ts's SECURITY
  // note) and is gone, so the IV -- and therefore the ciphertext -- is now
  // fresh per seal, by design. What I3 actually requires, and what is
  // asserted instead, is that the wire-visible SHAPE is identical and the
  // DECRYPTED PLAINTEXTS are byte-identical. Identical ciphertext was in
  // fact its own small leak ("the same answer twice" was distinguishable
  // from "two different answers"); this is strictly stronger, not weaker.
  ok('[side-channel check] the two ANSWER ENVELOPES are identical in wire shape (equal length, same fields)',
    declined.envelope.body.length === noMatch.envelope.body.length &&
    JSON.stringify(Object.keys(declined.envelope)) === JSON.stringify(Object.keys(noMatch.envelope)) &&
    JSON.stringify(declined.envelope).length === JSON.stringify(noMatch.envelope).length,
    `${declined.envelope.body.length} vs ${noMatch.envelope.body.length}`)

  // The IV travels in the body (`iv || ciphertext`) and always has -- read
  // it off the wire rather than recomputing it, exactly as interpret() does.
  const IV_LEN = 12
  const declinedIv = declinedCipher.slice(0, IV_LEN)
  const noMatchIv = noMatchCipher.slice(0, IV_LEN)
  ok('[nonce check, C-02] two seals of the SAME (pair key, qid) do NOT share an AES-GCM nonce',
    !Buffer.from(declinedIv).equals(Buffer.from(noMatchIv)),
    `${Buffer.from(declinedIv).toString('hex')} vs ${Buffer.from(noMatchIv).toString('hex')}`)

  const declinedPlain = await open(keyMarlene, declinedIv, declinedCipher.slice(IV_LEN))
  const noMatchPlain = await open(keyMarlene, noMatchIv, noMatchCipher.slice(IV_LEN))
  ok('[side-channel check] the DECRYPTED PLAINTEXTS are byte-identical (the property I3 actually rests on)',
    declinedPlain !== null && noMatchPlain !== null && Buffer.from(declinedPlain).equals(Buffer.from(noMatchPlain)))

  // Now the LOCAL log for this same pair -- built with the real
  // appendQueryLog(), on a throwaway device -- and shown to differ.
  const sideChannelDevice = makeDevice('sidechk0', 'Side-Check')
  appendQueryLog(sideChannelDevice, { at: Date.now(), fromDisplayName: 'Nora', fromId: 'nora0000', text: freeText, outcome: declined.outcome })
  appendQueryLog(sideChannelDevice, { at: Date.now(), fromDisplayName: 'Nora', fromId: 'nora0000', text: freeText, outcome: noMatch.outcome })
  ok('[side-channel check] the LOCAL LOG, unlike the wire, DOES distinguish declined from no-match',
    sideChannelDevice.queryLog[0].outcome === 'declined' && sideChannelDevice.queryLog[1].outcome === 'no-match' &&
    sideChannelDevice.queryLog[0].outcome !== sideChannelDevice.queryLog[1].outcome)

  // ---- Grep-level: no LocalOutcome label anywhere on the wire ------------
  const labels = ['shared', 'declined', 'below-k', 'no-match', 'blocked']
  const wireJson = wireSends.map((e) => JSON.stringify(e))
  const leaks = []
  for (const json of wireJson) {
    for (const label of labels) {
      if (json.includes(label)) leaks.push({ label, json: json.slice(0, 80) })
    }
  }
  ok('none of the five LocalOutcome labels appear anywhere in any envelope actually sent over the wire',
    leaks.length === 0, JSON.stringify(leaks).slice(0, 300))

  noraChannel.close()
  marleneChannel.close()
  benChannel.close()

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
  console.error('call_into_the_web: uncaught error:', err)
  process.exit(1)
})
