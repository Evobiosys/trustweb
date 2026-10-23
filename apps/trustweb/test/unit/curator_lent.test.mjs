/** Wave 18 (Jakob 2026-10-23): the Curator tells its host which face it shows (Desk or classic), so the host can give the Desk the whole window. */
import { createCurator } from '../../src/curator.ts'

const lentTo = []
let desks = 0
let classics = 0
vi.mock('@web-curator', () => ({ mountCurator: async (_root, lent) => { lentTo.push(lent) }, refreshCurator: async () => {}, showDesk: async () => { desks++ }, showClassic: async () => { classics++ } }))

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

  it('openDesk mounts the Curator, then switches it to the Desk', async () => {
    const noop = () => {}
    createCurator({ record: () => null, setRing: noop, setFamily: noop, setFlag: noop, removePerson: noop, restorePerson: noop, setHiddenSources: noop, addLine: noop, showRings: noop, viewChanged: noop }).openDesk()
    await vi.waitFor(() => expect(desks).toBe(1))
  })

  it('openClassic (Settings > View > Classic) switches the Curator to its classic face, not the Desk', async () => {
    const noop = () => {}
    const before = desks
    createCurator({ record: () => null, setRing: noop, setFamily: noop, setFlag: noop, removePerson: noop, restorePerson: noop, setHiddenSources: noop, addLine: noop, showRings: noop, viewChanged: noop }).openClassic()
    await vi.waitFor(() => expect(classics).toBe(1))
    expect(desks).toBe(before)
  })

  it('lends renderRings: the Desk gets the host-built rings element, its pick and ring callbacks reach the host builder', async () => {
    const noop = () => {}
    const built = { className: 'rings-wrap' }
    const asked = []
    const before = lentTo.length
    createCurator({ record: () => null, setRing: noop, setFamily: noop, setFlag: noop, removePerson: noop, restorePerson: noop, setHiddenSources: noop, addLine: noop, showRings: noop, viewChanged: noop, renderRings: (o) => { asked.push(o); return built } }).open()
    await vi.waitFor(() => expect(lentTo).toHaveLength(before + 1))
    const picked = []
    const opts = { onPick: (id) => picked.push(id) }
    expect(lentTo[before].renderRings(opts)).toBe(built)
    asked[0].onPick('p1')
    expect(picked).toEqual(['p1'])
  })
  it('lends renderProfile, closeDesk and showPhoneVersion: the Desk gets the host-built profile editor and the host\'s close', async () => {
    const noop = () => {}
    const editor = { className: 'prof-editor' }
    const calls = []
    const before = lentTo.length
    createCurator({ record: () => null, setRing: noop, setFamily: noop, setFlag: noop, removePerson: noop, restorePerson: noop, setHiddenSources: noop, addLine: noop, showRings: noop, viewChanged: noop, renderRings: noop, renderProfile: () => editor, closeDesk: () => calls.push('close'), showPhoneVersion: () => calls.push('phone') }).open()
    await vi.waitFor(() => expect(lentTo).toHaveLength(before + 1))
    expect(lentTo[before].renderProfile()).toBe(editor)
    lentTo[before].closeDesk()
    lentTo[before].showPhoneVersion()
    expect(calls).toEqual(['close', 'phone'])
  })
})
