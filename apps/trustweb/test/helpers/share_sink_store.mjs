// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 23: one small relation store the share-sink tests share (made-up ids, no personal data). */
const at = '"since":"2026-01-01T00:00:00.000Z","by":"device:laptop"'
const line = (s, r, o) => `{"subject":"${s}","relation":"${r}","object":"${o}",${at}}`

export const NOW = new Date('2026-10-27T12:00:00.000Z')

export const JSONL = [
  line('person:ada', 'in_zone', 'zone:community'),
  line('person:ada', 'in_zone', 'zone:close'),
  line('person:bo', 'in_zone', 'zone:acquaintance'),
  line('person:bo', 'has_tag', 'tag:garden'),
  line('person:eve', 'in_zone', 'zone:friend'),
  line('person:cy', 'may_read', 'item:bike'),
  line('zone:friend', 'may_read', 'item:bike'),
  line('zone:community', 'may_read', 'item:ladder'),
  line('tag:garden', 'may_read', 'item:ladder'),
  line('tag:garden', 'may_read', 'item:seeds'),
  line('zone:close', 'may_read', 'item:tools'),
  line('tag:garden', 'may_read', 'item:tools'),
  line('zone:public', 'may_read', 'item:recipe'),
].join('\n') + '\n'
