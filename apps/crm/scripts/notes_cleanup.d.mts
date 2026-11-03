// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import type { Person } from '../../trustweb/src/model'
export interface CleanupRemoved { id: string; name: string; path: string; archived: string }
export interface CleanupResult { scanned: number; removed: CleanupRemoved[]; unchanged: number; errors: string[] }
export function cleanup(vault: string, people: Pick<Person, 'id'>[], o?: { now?: number; dryRun?: boolean; archiveDir?: string; logFile?: string; own?: Map<string, number> }): CleanupResult
