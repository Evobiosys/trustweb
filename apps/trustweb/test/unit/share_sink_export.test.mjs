// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 23: one Markdown page per person or tag: what they can see and why (share_sink/export.ts). */
import { toMarkdown } from '../../src/share_sink/export.ts'
import { parseJsonl } from '../../src/share_sink/tuples.ts'
import { JSONL, NOW } from '../helpers/share_sink_store.mjs'

const store = parseJsonl(JSONL)

describe('share sink: Markdown export', () => {
  it('a person page lists their zone, tags, and each item they can see with why', () => {
    expect(toMarkdown(store, 'person:bo', NOW)).toBe(`# person:bo

- zone: acquaintance
- tags: tag:garden

## Can see

- item:ladder
  - person:bo has_tag tag:garden
  - tag:garden may_read item:ladder
- item:recipe
  - zone:public may_read item:recipe
- item:seeds
  - person:bo has_tag tag:garden
  - tag:garden may_read item:seeds
- item:tools
  - person:bo has_tag tag:garden
  - tag:garden may_read item:tools
`)
  })
  it('a tag page lists who carries it and what it opens', () => {
    expect(toMarkdown(store, 'tag:garden', NOW)).toBe(`# tag:garden

## Carried by

- person:bo

## Opens

- item:ladder
- item:seeds
- item:tools
`)
  })
  it('says so when there is nothing', () => {
    expect(toMarkdown([], 'person:nobody', NOW)).toBe('# person:nobody\n\n- zone: public\n- tags: none\n\n## Can see\n\n- nothing\n')
    expect(toMarkdown([], 'tag:none', NOW)).toBe('# tag:none\n\n## Carried by\n\n- nobody\n\n## Opens\n\n- nothing\n')
  })
})
