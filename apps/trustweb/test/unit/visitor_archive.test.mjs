/** Wave 16 visitor archive: the add sheet's button label, the clickable toast, the declined invite's archive entry. */
import { addLabel } from '../../src/connect_add_view.ts'
import { Ring } from '../../src/model.ts'
import { S } from '../../src/strings.ts'

describe('connect-add button label', () => {
  it('reads "Add as intended" on Intending, else "Add to my web"', () => {
    expect(addLabel(Ring.Intending)).toBe(S.connectAddAsIntended)
    expect(S.connectAddAsIntended).toBe('Add as intended')
    for (const r of [Ring.Friend, Ring.Acquaintance]) expect(addLabel(r)).toBe(S.addSave)
  })
})
