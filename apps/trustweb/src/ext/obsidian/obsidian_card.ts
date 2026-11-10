// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 41 obsidian-sync: "Open in Obsidian" on a person's card and Curate row. In the main bundle (a few lines); shown only while the module is on. */
import { el } from '../../../../demo/src/ui/dom'
import type { AppState } from '../../model'
import { S } from '../../strings'
import { isEnabled } from '../registry'
import { MODULE_ID, deepLink, parseObsidian } from './obsidian_data'

/** The link row for a note path (a person's `obsidianNote` field, or a Curate row's), or null: module off, vault name unknown, no note. */
export function obsidianLink(s: Pick<AppState, 'extData'>, notePath: string | undefined): HTMLElement | null {
  if (!notePath || !isEnabled(MODULE_ID)) return null
  const href = deepLink(parseObsidian(s.extData?.[MODULE_ID]).vault ?? '', notePath)
  return href ? el('a', { class: 'btn btn-ghost btn-sm', href, 'data-open-obsidian': notePath, style: 'text-decoration:underline' }, [S.obsidian.openInObsidian]) : null
}
