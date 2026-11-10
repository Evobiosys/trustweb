// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: contacts read from a vault (or found by a model) -> the Import pipeline's plan (planServices -> commitPlan -> Curate),
 * Pure.
 */
import type { ImportedContact } from '../../../../crm/src/import/types'
import type { AppState } from '../../model'
import { planServices } from '../../services_import'
import type { ServicePlan } from '../../services_import'

type State = Pick<AppState, 'people' | 'serviceImports'>

/** A plan with the vault note path on each row (it becomes the person's `obsidianNote` field on Accept), and `ai` on rows a model found. */
export function planVault(s: State, contacts: readonly ImportedContact[], o: { me: string; now: number; ai?: boolean }): ServicePlan {
  const plan = planServices(s, [{ name: 'Obsidian vault', text: '', contacts: [...contacts] }], o)
  for (const r of plan.rows) {
    if (o.ai) r.ai = true
    else r.obsidianNote = r.file
  }
  return plan
}
