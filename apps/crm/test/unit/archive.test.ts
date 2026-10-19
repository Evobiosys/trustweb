import { describe, expect, it } from 'vitest'
import { deleteArchived, emptyCrm } from '../../src/model'

describe('Archive: Delete for good', () => {
  it('removes the entry and the person it keeps; the others stay', () => {
    const crm = emptyCrm()
    const invite = { did: 'did:peer:2.x', from: { id: 'j', displayName: 'Jakob' } }
    crm.hiddenPeople = [
      { id: 'a', name: 'Jakob', person: { id: 'a', name: 'Jakob', context: '', ring: 'intending', metAt: 1, lines: [], pendingInvite: invite } as never },
      { id: 'b', name: 'Ben' },
    ]
    deleteArchived(crm, 'a')
    expect(crm.hiddenPeople).toEqual([{ id: 'b', name: 'Ben' }])
    deleteArchived(crm, 'zz')
    expect(crm.hiddenPeople).toHaveLength(1)
  })
})

describe('Archive key read by the trustweb rings (curator.ts CRM_KEY)', () => {
  it("is crmKey('me')", async () => {
    const { crmKey } = await import('../../src/storage')
    expect(crmKey('me')).toBe('trustweb-crm.v1.me')
  })
})
