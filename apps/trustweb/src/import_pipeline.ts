// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 import-obsidian-ai (F04): the one import pipeline. Every source (a contacts file, a chat export, an Obsidian vault, people an AI
 * suggested) is a thin ImportAdapter that turns its input into candidates; the rest is shared: planServices (rows, duplicates, signatures)
 * -> the Curate page -> commitPlan (one batch tagged `import:<date>-<source>`, one Undo: undoBatch). Pure: no DOM, no network, no storage.
 */
import { parseFile } from '../../crm/src/import/detect'
import type { CsvMapping } from '../../crm/src/import/generic_csv'
import type { ImportedContact } from '../../crm/src/import/types'
import type { ServiceRow } from './model'
import { planServices } from './services_import'
import type { PlanOptions, ServiceFile, ServicePlan } from './services_import'

export type Candidate = ImportedContact

export interface ImportAdapter<I> {
  /** The ContactSource value of the candidates it makes (also the source id in the registry). */
  id: string
  scan(input: I): Candidate[]
  /** Source specific fields on a finished row (e.g. the vault note a person came from). */
  decorate?(row: ServiceRow): void
}

/** A run is a raw file (chat exports keep their message evidence inside planServices) or an adapter with its input. */
export type ImportRun = ServiceFile | { adapter: ImportAdapter<never>; input: unknown }
const isFile = (r: ImportRun): r is ServiceFile => 'text' in r

/** A contacts file (vCard, Google, Dex, LinkedIn, Facebook, any CSV) as candidates. */
export const fileAdapter: ImportAdapter<{ name: string; text: string; mapping?: CsvMapping }> = {
  id: 'file',
  scan: ({ name, text, mapping }) => parseFile(name, text, mapping).result.contacts,
}

export function planFrom(s: Parameters<typeof planServices>[0], runs: readonly ImportRun[], o: PlanOptions): ServicePlan {
  const adapters = new Map<string, ImportAdapter<never>>()
  const files: ServiceFile[] = runs.map((r) => {
    if (isFile(r)) return r
    const contacts = (r.adapter as ImportAdapter<unknown>).scan(r.input)
    if (r.adapter.decorate) adapters.set(r.adapter.id, r.adapter)
    return { name: r.adapter.id, text: '', contacts }
  })
  const plan = planServices(s, files, o)
  for (const row of plan.rows) adapters.get(row.source)?.decorate?.(row)
  return plan
}
