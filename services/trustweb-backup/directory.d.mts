// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Types of directory.mjs for the TypeScript that imports its pure helpers (apps/mcp/src/social_tools.ts).
export function isDirectoryPath(pathname: string): boolean
export function normName(first: string, last: string): string
/** True when `sig` (base64url) is a valid ed25519 signature of `message` by the key inside the did:peer:2 `did`. Never throws. */
export function verifyDid(did: string, message: string | Uint8Array, sig: string): boolean
export function checkRecord(r: unknown): { v: 1; first: string; last: string; key: string; ts: number; open: boolean; srv: true; hosts: string[]; sig: string } | null
export function checkIntent(i: unknown): { to: string; from: { first: string; last: string; key: string }; ts: number; sig: string } | null
export function openDirectory(o: { cfg: Record<string, unknown>; clientOf: (req: unknown) => string; now?: () => number }): Promise<{ handle: (req: unknown, res: unknown) => Promise<number> }>
