// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
export const STALE_MS: number
export type Lock = { ok: true; release: () => void } | { ok: false; held: { pid: number; startedAt: string } }
export function pidAlive(pid: number): boolean
export function acquireLock(file: string, o?: { staleMs?: number; now?: number; alive?: (pid: number) => boolean; pid?: number }): Lock
export function releaseOnExit(lock: Lock): void
