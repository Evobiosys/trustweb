// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Live microphone level for the record pulse: pure maths, the AnalyserNode lives in recorder.ts. */

/** Ring width in px when nothing is heard (the minimal static pulse that says "on") and at full volume. */
export const PULSE_IDLE_PX = 4
export const PULSE_MAX_PX = 22
/** Speech sits around 0.05 to 0.25 RMS; the gain brings that to most of the range. */
const GAIN = 4

/** RMS 0..1 of a byte time-domain buffer (AnalyserNode.getByteTimeDomainData: 128 = silence). */
export function rmsLevel(samples: Uint8Array): number {
  if (!samples.length) return 0
  let sum = 0
  for (const s of samples) { const v = (s - 128) / 128; sum += v * v }
  return Math.sqrt(sum / samples.length)
}

/** Rises quickly, falls slowly, so the ring follows syllables without flicker. */
export function smoothLevel(prev: number, next: number): number {
  return next > prev ? prev + (next - prev) * 0.6 : prev + (next - prev) * 0.15
}

export function pulseSpreadPx(level: number): number {
  const l = Number.isFinite(level) ? Math.min(1, Math.max(0, level * GAIN)) : 0
  return PULSE_IDLE_PX + (PULSE_MAX_PX - PULSE_IDLE_PX) * l
}
