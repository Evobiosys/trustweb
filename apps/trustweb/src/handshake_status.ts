// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 handshake-crypto: the record side of the sealed connect handshake (refusal log, status for MCP handshake_status). No imports
 * with runtime code, so apps/mcp's server loads it under plain node (handshake_crypto.ts itself needs the bundler: @noble, WebCrypto).
 */
export type HandshakeMode = 'qr' | 'did'
export type HandshakeFailure = 'unsupported' | 'tampered' | 'replay' | 'mismatch'

/** One refused handshake in the record (I6): when, why, and a short fingerprint of the sending DID (never a name). */
export interface HandshakeLogEntry { at: number; reason: HandshakeFailure; from: string }
export const HANDSHAKE_LOG_MAX = 20

export const logHandshake = (log: readonly HandshakeLogEntry[] | undefined, e: HandshakeLogEntry): HandshakeLogEntry[] => [e, ...(log ?? [])].slice(0, HANDSHAKE_LOG_MAX)

interface StatusPeer { id: string; displayName: string; heardAt?: number; synced?: boolean; handshake?: HandshakeMode }

/** MCP handshake_status: the connects not answered yet (encrypted = sealed handshake), and the refused ones. */
export function handshakeStatus(s: { peers?: readonly StatusPeer[]; handshakeLog?: readonly HandshakeLogEntry[] }): {
  version: number
  pending: { id: string; name: string; encrypted: boolean; mode: HandshakeMode | null }[]
  refused: HandshakeLogEntry[]
} {
  return {
    version: 2, // HANDSHAKE_VERSION of handshake_crypto.ts
    pending: (s.peers ?? []).filter((p) => p.heardAt === undefined && !p.synced).map((p) => ({ id: p.id, name: p.displayName, encrypted: p.handshake !== undefined, mode: p.handshake ?? null })),
    refused: [...(s.handshakeLog ?? [])],
  }
}
