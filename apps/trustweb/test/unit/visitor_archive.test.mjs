/** Wave 16 visitor archive: the add sheet's button label, the clickable toast, the declined invite's archive entry. */
import { addLabel } from '../../src/connect_add_view.ts'
import { Ring } from '../../src/model.ts'
import { S } from '../../src/strings.ts'
import { createToast } from '../../src/toast.ts'

/** Just what the toast touches of an element (node environment, no DOM). */
function fakeEl() {
  const attrs = new Map()
  const cls = new Set()
  const on = {}
  return {
    textContent: '', dataset: {}, attrs, on,
    classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c) },
    setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k),
    addEventListener: (type, fn) => { on[type] = fn },
  }
}

describe('connect-add button label', () => {
  it('reads "Add as intended" on Intending, else "Add to my web"', () => {
    expect(addLabel(Ring.Intending)).toBe(S.connectAddAsIntended)
    expect(S.connectAddAsIntended).toBe('Add as intended')
    for (const r of [Ring.Friend, Ring.Acquaintance]) expect(addLabel(r)).toBe(S.addSave)
  })
})

describe('toast onClick', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('a plain toast takes no taps; one with onClick is a keyboard-reachable button that runs it once', () => {
    const t = fakeEl()
    const show = createToast(t)
    const opened = []
    show('Saved.')
    expect(t.attrs.get('role')).toBe('status')
    expect(t.classList.contains('tap')).toBe(false)
    t.on.click()
    expect(opened).toEqual([])
    show(S.personAddedToast('Jakob'), { onClick: () => opened.push('card') })
    expect(t.textContent).toBe('Jakob added.')
    expect(t.attrs.get('role')).toBe('button')
    expect(t.attrs.get('tabindex')).toBe('0')
    expect(t.classList.contains('tap')).toBe(true)
    t.on.keydown({ key: 'Enter', preventDefault() {} })
    expect(opened).toEqual(['card'])
    expect(t.classList.contains('on')).toBe(false)
    t.on.click()
    expect(opened).toEqual(['card'])
  })
  it('the mark rides only while its message shows', () => {
    const t = fakeEl()
    const show = createToast(t)
    show(S.archivedToast, { mark: 'archivedToast' })
    expect('archivedToast' in t.dataset).toBe(true)
    vi.advanceTimersByTime(3300)
    expect('archivedToast' in t.dataset).toBe(false)
    show(S.archivedToast, { mark: 'archivedToast' })
    show('Other.')
    expect('archivedToast' in t.dataset).toBe(false)
  })
})
