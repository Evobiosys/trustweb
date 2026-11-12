// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 41 obsidian-sync: what the dynamic import yields: the rows under Settings > Extensions > Obsidian vault, and the page the Import page opens. */
import type { TwModuleBody } from '../tw_registry'
import { shutdownAll } from './obsidian_run'
import { settingsSection } from './obsidian_settings'

export { openObsidian } from './obsidian_view'

/** Switched off: a running ingestion stops and the scan worker ends (the page may still be open). */
export const body: TwModuleBody = { settings: settingsSection, dispose: shutdownAll }
