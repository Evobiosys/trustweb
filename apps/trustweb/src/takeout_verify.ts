// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 28 (sovereign-import): the verify gate of the owner's sovereign-takeout (verify.py), as pure code: before an archive counts as
 * "this service's export" its member names and size are checked against the service's markers. Names only, nothing is extracted.
 * Reading the member names out of a zip is the importer's job (import-examples); this takes the list.
 */
import type { RtbfService } from './data/services_rtbf'

export const MIN_TOTAL_BYTES = 10 * 1024

export interface VerifyCheck { name: string; passed: boolean; detail: string }
export interface VerifyReport { passed: boolean; checks: VerifyCheck[] }

const wildcard = (pattern: string): RegExp => new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i')

/** Which service a downloaded file name belongs to, by archive pattern; null when none (then the owner assigns it by hand). */
export function serviceForArchive(list: readonly RtbfService[], fileName: string): string | null {
  return list.find((s) => (s.archivePatterns ?? []).some((p) => wildcard(p).test(fileName)))?.id ?? null
}

export function verifyArchive(svc: Pick<RtbfService, 'verifyMarkers' | 'verifyMode'>, names: readonly string[], totalBytes: number): VerifyReport {
  const loose = svc.verifyMode === 'loose'
  const markers = svc.verifyMarkers ?? []
  const has = (m: string): boolean => names.some((n) => n.includes(m))
  const found = svc.verifyMode === 'all' ? markers.every(has) : markers.some(has)
  const checks: VerifyCheck[] = [
    { name: 'size', passed: totalBytes >= MIN_TOTAL_BYTES, detail: `${totalBytes} bytes (need ${MIN_TOTAL_BYTES})` },
    { name: 'members', passed: loose || names.length > 0, detail: loose ? 'skipped (loose)' : `${names.length} member(s)` },
    { name: 'markers', passed: loose || (markers.length > 0 && found), detail: loose ? 'skipped (loose)' : `markers ${markers.join(', ')}` },
  ]
  return { passed: checks.every((c) => c.passed), checks }
}
