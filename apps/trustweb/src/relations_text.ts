// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 hover-sources: the plain words for a relation and its sources (card on the dashed line, section on the person card). Pure. */
import type { Relation, RelationSource } from './relations_model'
import { S } from './strings'

export const kindName = (kind: string): string => S.relations.kind[kind] ?? kind

export const headline = (r: Pick<Relation, 'kind' | 'confidence'>, y: string, z: string): string => S.relations.headline(y, z, kindName(r.kind), r.confidence)

export function sourceText(src: RelationSource): string {
  const R = S.relations
  const date = src.date ? ` (${src.date})` : ''
  const text = ((): string => {
    switch (src.type) {
      case 'stated-by-me': return src.detail === 'knows' ? R.knows : R.saidSo + date
      case 'stated-by-them': return R.theySaid + date
      case 'shared-tag': return R.tag(src.detail)
      case 'shared-import': return R.import(src.detail) + date
      case 'co-presence-event': return R.event(src.detail) + date
      case 'messenger-group': return R.group(src.detail) + date
      case 'inferred': return src.detail === 'family' ? R.family : R.ring(R.ringName[src.detail] ?? src.detail)
    }
  })()
  return src.crowd ? `${text} (${R.crowd})` : text
}

export const whyLine = (r: Pick<Relation, 'sources'>): string => S.relations.why + r.sources.map(sourceText).join('; ')
