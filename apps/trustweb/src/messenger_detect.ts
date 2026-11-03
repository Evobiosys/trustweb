// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28: is Geb in this browser? Pure; the checks are handed in. live = the paired loopback bridge answers; installed = a Geb page marker is present but not paired; absent = neither. */
export type GebFound = 'live' | 'installed' | 'absent'

export interface GebEnv {
  paired: boolean
  /** Geb's page marker (an element attribute or window property the Geb app sets; not verified against Geb). */
  marker: boolean
  ping: () => Promise<boolean>
}

export async function detectGeb(env: GebEnv): Promise<GebFound> {
  if (env.paired) {
    try { if (await env.ping()) return 'live' } catch { /* bridge not running: fall through */ }
  }
  return env.marker ? 'installed' : 'absent'
}
