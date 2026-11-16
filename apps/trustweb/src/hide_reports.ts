// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b hide-from-crypto: the record side of verified tamper reports (AppState.hideReports, MCP ask_tamper_reports_list). No runtime
 * imports, so apps/mcp loads it under plain node (hide_from_crypto.ts needs @noble and WebCrypto).
 */
/** 'tampered': a device on the way changed the hidden list; 'unsupported': a device could not check it (a later protocol) and did not pass the ask on. */
export type HideReason = 'tampered' | 'unsupported'

/** One verified report (I6): which ask (its id and text), at which step it was caught (1 = a direct contact), why, when. Never the reporter's name. */
export interface HideReportEntry { askId: string; text: string; step: number; why: HideReason; at: number }
export const HIDE_REPORTS_MAX = 30

export const addHideReport = (list: readonly HideReportEntry[] | undefined, e: HideReportEntry): HideReportEntry[] => [e, ...(list ?? [])].slice(0, HIDE_REPORTS_MAX)

/** MCP ask_tamper_reports_list: newest first. */
export function hideReportsList(s: { hideReports?: readonly HideReportEntry[] }): { reports: HideReportEntry[] } {
  return { reports: [...(s.hideReports ?? [])] }
}
