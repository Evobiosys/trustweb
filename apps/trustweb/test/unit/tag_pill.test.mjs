// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 group-tags: which tags get the ring. */
import { pillClass } from '../../src/components/tag_pill.ts'

describe('pillClass', () => {
  it('a personal or unmarked tag is a plain pill', () => {
    expect(pillClass(undefined)).toBe('tag-pill')
    expect(pillClass('personal')).toBe('tag-pill')
  })
  it('group, managed and event tags carry the ring and their kind', () => {
    expect(pillClass('group')).toBe('tag-pill tag-ring tag-kind-group')
    expect(pillClass('managed')).toBe('tag-pill tag-ring tag-kind-managed')
    expect(pillClass('event')).toBe('tag-pill tag-ring tag-kind-event')
  })
})
