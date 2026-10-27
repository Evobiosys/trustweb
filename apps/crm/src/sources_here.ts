// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Where a notes source can run: Tana's desktop MCP and the loopback notes bridge live on a computer, never on a phone. */
export interface SourceEnv { phone: boolean }

export function canRunSource(_pkm: string, env: SourceEnv): 'here' | 'elsewhere' {
  return env.phone ? 'elsewhere' : 'here'
}

export function isPhone(m: { coarse: boolean; width: number }): boolean {
  return m.coarse || m.width < 700
}
