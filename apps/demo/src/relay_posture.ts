/**
 * Relay-target posture (orchestrator ruling, 2026-09-06, under Jakob's
 * stated understanding "refuse relaying in general").
 *
 * SCOPE, READ THIS FIRST: "relaying" here means this device acting as the
 * CARRIER of someone ELSE's traffic -- the role relay.ts's own module doc
 * describes for questhub.eco's server ("the ciphertext is never touched,
 * never decrypted"), reused at the level of a single device rather than the
 * server. It is deliberately NOT the demo-21 (secondHop) "I know X, want me
 * to ask them for you?" feature (main.ts's `runSecondHopRelayCeremony` /
 * `renderSecondHopRelayCard`): that flow's own doc comment says outright the
 * intermediary "can read both the question and whatever answer comes back --
 * this is not a blind pipe," which directly contradicts "sealed and
 * unreadable to the relay." Two different things share the English word
 * "relay" in this project; this module is about the carrier role, not the
 * second-hop forward. See this feature's handover doc for the full
 * reasoning and why this is flagged as an interpretation to confirm with
 * Jakob, not a certainty.
 *
 * WHY THIS IS A POSTURE, NOT YET A GATE ON REAL TRAFFIC: no code path in
 * this tree currently has one device carry a THIRD party's ciphertext --
 * `relayChannel` in main.ts talks only to the questhub.eco server, never
 * peer-to-peer-via-another-peer. This module ships the SETTING (global
 * default-on switch, per-peer override, the help text, and the pure gate
 * function a future carrier feature must call) honestly labelled per I7:
 * the POSTURE is SHIPPED; the carrier path it would gate is DESIGNED, not
 * built. Do not let the setting's presence imply a capability that does not
 * exist yet -- see the settings copy in screens/profile.ts, which says this
 * explicitly.
 *
 * WHY DEFAULT ON: a relayed envelope, by construction, is ciphertext this
 * device cannot open (it holds neither party's pair key) -- carrying it
 * costs battery and bandwidth but exposes nothing this device could not
 * already see about its own traffic metadata. Declining by default would
 * weaken the network's reachability for a cost that, per this project's own
 * privacy contract, is not actually a privacy cost. See I9's usual
 * "conservative unless a documented reason says otherwise" -- this is that
 * documented reason, same shape as D28's own stated exception.
 *
 * WHY NO PER-MESSAGE REFUSAL: a sealed envelope cannot be inspected by the
 * device asked to carry it (that is the entire point of it being sealed --
 * see relay.ts's own module doc), so there is no content a per-message
 * decision could be made FROM. The only decisions available are ones that
 * do not require reading the payload: a standing global posture, and a
 * standing per-peer one.
 */

import type { DeviceState, Peer } from './state'

/** See this module's own doc comment for the full "why on" argument. Kept as
 *  a named constant (not a literal `true` scattered across call sites) so
 *  the settings screen, the gate function below, and the handover all cite
 *  the same value if it is ever revisited. */
export const RELAY_POSTURE_DEFAULT_ON = true

/** Absent reads as `RELAY_POSTURE_DEFAULT_ON` -- the same "absent means the
 *  safe/shipped default" convention every other optional DeviceState field
 *  in state.ts already uses (see e.g. `deviceMode`). A device that predates
 *  this field is not silently opted OUT (that would be a behaviour change
 *  hiding in an upgrade) nor silently opted into a NEW default that was
 *  never announced -- it reads exactly as the one default this feature
 *  ships with. */
export function actAsRelay(s: Pick<DeviceState, 'actAsRelay'>): boolean {
  return s.actAsRelay ?? RELAY_POSTURE_DEFAULT_ON
}

/**
 * The one gate a future carrier feature must call before agreeing to carry
 * traffic on behalf of `peer`. Pure, and the unit under test in
 * test/relay_posture.test.ts: global posture off outranks everything (a
 * person who turned the whole thing off meant it for everyone); otherwise a
 * per-peer "do not relay for this person" (Peer.doNotRelayFor) refuses only
 * that one contact while leaving the global default in place for everyone
 * else.
 */
export function mayRelayFor(s: Pick<DeviceState, 'actAsRelay'>, peer: Pick<Peer, 'doNotRelayFor'> | null | undefined): boolean {
  if (!actAsRelay(s)) return false
  if (peer?.doNotRelayFor) return false
  return true
}
