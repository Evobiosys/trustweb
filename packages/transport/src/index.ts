// @resource-web/transport — M2-T (see docs/TRANSPORT.md)
//
// Two TransportAdapter (@resource-web/protocol) implementations:
// - MatrixTransport: matrix-bot-sdk over a synapse homeserver.
// - MockTransport: deterministic in-memory adapter for tests (I5 proof).
//
// No protocol logic lives here (matching/policy/lifecycle) — this package
// only moves envelopes. Must not import agent-daemon.
export const PACKAGE = "transport";

export { MockBus, MockTransport } from "./mock_transport.js";
export { MatrixTransport } from "./matrix_transport.js";
export { provisionMatrixClient, localpartOf, derivePassword, type ProvisionConfig } from "./matrix_provisioning.js";
export { ENVELOPE_MSGTYPE, ENVELOPE_CONTENT_KEY, buildEnvelopeContent, extractEnvelopeWire } from "./wire.js";

// OpenVTC pillar (Task 11) — DID identity + DIDComm-v2-shaped transport + VRCs.
export {
  createIdentity,
  resolveDidPeer,
  serializeIdentity,
  deserializeIdentity,
  getCardPayload,
  type Identity,
  type ResolvedDid,
  type CardPayload,
} from "./did_identity.js";
export {
  DidCommTransport,
  ENVELOPE_TYPE,
  ROOM_MESSAGE_TYPE,
  ROOM_CREATE_TYPE,
  type RoomMessage as DidCommRoomMessage,
  type DidCommTransportOptions,
} from "./didcomm_transport.js";
export {
  HttpPostChannel,
  defaultHttpPost,
  type DeliveryChannel,
  type HttpPost,
  type HttpPostChannelOptions,
} from "./delivery_channel.js";
export {
  InMemoryDedupStore,
  SqliteDedupStore,
  MAX_HOLD_HORIZON_MS,
  type DedupStore,
} from "./dedup_store.js";
export { packMessage, unpackMessage, type JwmMessage } from "./didcomm_crypto.js";
export {
  InMemoryRelayQueueStore,
  SqliteRelayQueueStore,
  type RelayQueueStore,
  type QueuedWire,
} from "./relay_queue_store.js";
export { RelayServer, type RelayServerOptions, type SubmitResult } from "./relay_server.js";
export { RelayChannel, type RelayChannelOptions, type BackoffOpts } from "./relay_channel.js";
export {
  LadderChannel,
  type LadderRung,
  type LadderRungName,
  type LadderOptions,
  type LadderBudgets,
} from "./ladder_channel.js";
export {
  issueVrc,
  verifyVrc,
  type VerifiableRelationshipCredential,
  type VrcCredentialSubject,
  type VrcVerifyResult,
} from "./vrc.js";
// Inbound-vouch route (Finding 1, UH-findings handover 2026-09-06): the
// direction trustExport() above does NOT provide — "who vouched for me".
export {
  issueInboundVouch,
  buildVouchPresentation,
  verifyInboundVouches,
  VOUCH_RELATIONSHIP,
  VOUCH_K,
  type VouchPresentation,
  type VouchRejection,
  type VouchVerificationResult,
  type VerifyInboundVouchesOptions,
} from "./inbound_vouch.js";
export {
  IrohRelayChannel,
  type IrohClient,
  type IrohPeerAddr,
  type IrohRelayChannelOptions,
} from "./iroh_relay_channel.js";
