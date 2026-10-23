/** Wave 19 (Jakob 2026-10-23): what the phone called the Web Curator is "Contacts" wherever the user reads it; only the About text keeps the product name. */
import { describe, expect, it } from 'vitest'
import { S } from '../../src/strings.ts'
import { S as C } from '../../../crm/src/strings.ts'

const texts = (o) => Object.entries(o).flatMap(([k, v]) => typeof v === 'string' ? [[k, v]] : v && typeof v === 'object' ? texts(v) : [])

describe('the Curator is called Contacts', () => {
  it('the glyph, the sheet title and the classic face say Contacts', () => {
    expect([S.navCurator, S.searchOpen, C.appName, C.views.classic]).toEqual(['Contacts', 'Contacts', 'Contacts', 'Contacts'])
    expect(S.curatorLoading).toMatch(/Contacts/)
    expect(S.archivedToast).toBe('Archived. Find them in Contacts.')
  })
  it('no user-visible string says Curator, except the About product name', () => {
    const left = [...texts(S), ...texts(C)].filter(([k, v]) => /curator/i.test(v) && k !== 'aboutSteward')
    expect(left).toEqual([])
  })
})
