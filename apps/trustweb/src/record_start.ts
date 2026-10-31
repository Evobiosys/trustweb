// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { S } from './strings'

/** Start of a recording: a tap asks for the microphone (requesting), which is granted (recording) or refused (denied). */
export type RecStart = 'idle' | 'requesting' | 'recording' | 'denied'

export function recStartNext(s: RecStart, ev: 'tap' | 'granted' | 'rejected' | 'stopped'): RecStart {
  if (ev === 'tap') return s === 'idle' || s === 'denied' ? 'requesting' : s
  if (s === 'requesting') return ev === 'granted' ? 'recording' : ev === 'rejected' ? 'denied' : s
  return ev === 'stopped' ? 'idle' : s
}

/** The honest line for a getUserMedia rejection. */
export function recStartFailure(err: unknown): string {
  return (err as { name?: string } | null)?.name === 'NotFoundError' ? S.recNoMic : S.recDenied
}
