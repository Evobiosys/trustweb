/** Wave 18 (Jakob 2026-10-23): the Curator tells its host which face it shows (Desk or classic), so the host can give the Desk the whole window. */
import { createCurator } from '../../src/curator.ts'

const lentTo = []
vi.mock('@web-curator', () => ({ mountCurator: async (_root, lent) => { lentTo.push(lent) }, refreshCurator: async () => {} }))

const node = () => ({ className: '', setAttribute() {}, appendChild() {}, addEventListener() {}, replaceChildren() {} })

describe('createCurator lends viewChanged', () => {
  beforeEach(() => { globalThis.document = { createElement: node, createTextNode: (t) => t } })
  afterEach(() => { delete globalThis.document })

  it('passes the host callback through to the mounted Curator', async () => {
    const seen = []
    const noop = () => {}
    createCurator({ record: () => null, setRing: noop, setFamily: noop, setFlag: noop, removePerson: noop, restorePerson: noop, setHiddenSources: noop, addLine: noop, showRings: noop, viewChanged: (v) => seen.push(v) }).open()
    await vi.waitFor(() => expect(lentTo).toHaveLength(1))
    lentTo[0].viewChanged('desk')
    expect(seen).toEqual(['desk'])
  })
})
