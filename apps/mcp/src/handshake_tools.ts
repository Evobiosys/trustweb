// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 handshake-crypto (POLICY P02, MCP parity): handshake_status reads, per connection not answered yet, whether its connect handshake
 * was sealed (v2, apps/trustweb/src/handshake_crypto.ts), and the refused handshakes the record logged. Read only; never a QR secret.
 */
import { handshakeStatus } from '../../trustweb/src/handshake_status.ts'
import { load, schema, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

export function handshakeTools(o: RecordToolsOptions): Tool[] {
  return [{
    name: 'handshake_status',
    description: 'The connect handshake: version (2 = sealed with the QR key), pending (each connection that has not answered yet: id, name, encrypted true|false, mode "qr" = sealed with the QR key, "did" = sealed without a QR, null = before v2) and refused (handshakes this phone refused: when, why "tampered" | "replay" | "mismatch" | "unsupported", and a DID fingerprint).',
    inputSchema: schema({}),
    run: () => handshakeStatus(load(o.file) as Parameters<typeof handshakeStatus>[0]),
  }]
}
