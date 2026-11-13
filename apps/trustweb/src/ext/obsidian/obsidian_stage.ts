// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync, wave 42 (F04): the vault's two adapters for the one import pipeline (import_pipeline.ts): notes read from a vault, and
 * people a model found (complete ingestion, suggestions). Pure.
 */
import type { ImportedContact } from '../../../../crm/src/import/types'
import { ContactSource } from '../../../../crm/src/import/types'
import type { ImportAdapter } from '../../import_pipeline'
import { planFrom } from '../../import_pipeline'
import type { AppState } from '../../model'
import type { ServicePlan } from '../../services_import'
import { suggestionContacts } from './obsidian_suggest'
import type { Suggestion } from './obsidian_suggest'
import { buildContacts } from './obsidian_people'
import type { ParsedNote } from './obsidian_parse'

type State = Pick<AppState, 'people' | 'serviceImports'>

/** Notes of a vault -> the people among them. The vault note path becomes the person's `obsidianNote` field on Accept. */
export const obsidianAdapter: ImportAdapter<readonly ParsedNote[]> = {
  id: ContactSource.Obsidian,
  scan: (notes) => buildContacts(notes).contacts,
  decorate: (r) => { r.obsidianNote = r.file },
}

/** Suggestions the owner ticked -> candidates; the owner checks every row on the Curate page. */
export const obsidianAiAdapter: ImportAdapter<readonly Suggestion[]> = {
  id: ContactSource.ObsidianAi,
  scan: suggestionContacts,
  decorate: (r) => { r.ai = true },
}

/** Contacts already built (complete ingestion, wave 41 callers): the same two ids, the scan is the identity. */
const contactsAdapter = (ai: boolean): ImportAdapter<readonly ImportedContact[]> => ({
  id: ai ? ContactSource.ObsidianAi : ContactSource.Obsidian,
  scan: (c) => [...c],
  decorate: (ai ? obsidianAiAdapter : obsidianAdapter).decorate,
})

export function planVault(s: State, contacts: readonly ImportedContact[], o: { me: string; now: number; ai?: boolean }): ServicePlan {
  return planFrom(s, [{ adapter: contactsAdapter(o.ai === true), input: contacts }], o)
}
