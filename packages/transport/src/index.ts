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
export { RelayServer, type RelayServerOptions, type SubmitResult, type IngressResult } from "./relay_server.js";
export { SEND_AUTH_HEADERS, SendAuthVerifier, sendSigningInput, signSend, parseSenderAuthMode, type SendAuthHeaders, type SendAuthResult, type SenderAuthMode } from "./relay_send_auth.js";
export {
  DEFAULT_KEY_POLICY,
  SEND_AUTH_PREFIX_V1,
  sendSigningInputV2,
  signSendV1,
  type KeyLookup,
  type SendKeyPolicy,
  type SendAuthFailureCode,
  type SendAuthVerifierOptions,
  type SendSigner,
} from "./relay_send_auth.js";
export { InMemorySendNonceStore, SqliteSendNonceStore, type SendNonceStore } from "./send_nonce_store.js";
export { RelayChannel, type RelayChannelOptions, type BackoffOpts } from "./relay_channel.js";
export {
  IrohRelayChannel,
  DEFAULT_MAX_WIRE_BYTES as IROH_DEFAULT_MAX_WIRE_BYTES,
  DEFAULT_ATTEMPT_MS as IROH_DEFAULT_ATTEMPT_MS,
  DEFAULT_MAX_RELAY_ATTEMPTS as IROH_DEFAULT_MAX_RELAY_ATTEMPTS,
  type IrohEndpointLike,
  type IrohPeerAddr,
  type IrohRelayChannelOptions,
  type IrohRelayAuditEvent,
} from "./iroh_relay_channel.js";
export {
  IrohRelaySelector,
  DEFAULT_RELAY_COOLDOWN_MS as IROH_DEFAULT_RELAY_COOLDOWN_MS,
  DEFAULT_RELAY_MAX_COOLDOWN_MS as IROH_DEFAULT_RELAY_MAX_COOLDOWN_MS,
  type IrohRelaySelectorOptions,
} from "./iroh_relay_selector.js";
export {
  IrohSidecarEndpoint,
  IrohSidecarError,
  findIrohSidecar,
  IROH_SIDECAR_BINARY,
  IROH_SIDECAR_ENV,
  DEFAULT_READY_TIMEOUT_MS as IROH_SIDECAR_DEFAULT_READY_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS as IROH_SIDECAR_DEFAULT_REQUEST_TIMEOUT_MS,
  type IrohSidecarEndpointOptions,
  type IrohSidecarReady,
  type IrohSidecarLogLevel,
} from "./iroh_sidecar_endpoint.js";
export {
  LadderChannel,
  type LadderRung,
  type LadderRungName,
  type LadderOptions,
  type LadderBudgets,
  type LadderRungResult,
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
// relay env (B)
export { parseSenderAuthEnv, type SenderAuthEnv } from "./relay_env.js";
// key rotation / revocation (A2)
export { encodeEd25519Multibase, decodeEd25519Multibase, type KeyPair } from "./did_identity.js";
export {
  KEY_RECORD_PREFIXES,
  DEFAULT_DEVICE_GRANT_MS,
  signRotation,
  signRevocation,
  signDeviceGrant,
  signDeviceRevocation,
  keyRecordSigningInput,
  keyRecordSigningText,
  parseKeyRecord,
  parseKeyRecordStatement,
  type KeyRecord,
  type KeyRecordStatement,
  type RotateRecord,
  type RevokeRecord,
  type DeviceGrantRecord,
  type DeviceRevokeRecord,
} from "./did_key_records.js";
export { InMemoryDidKeyStore, SqliteDidKeyStore, type DidKeyStore, type DidStateRow, type DeviceGrantRow } from "./did_key_store.js";
export {
  DidKeyRegistry,
  DEFAULT_KEY_RECORD_WINDOW_MS,
  type ApplyResult,
  type ApplyFailureCode,
  type DidKeyRegistryOptions,
  type DidKeyStatus,
} from "./did_key_registry.js";
export { type KeyRecordResult } from "./relay_server.js";
