/** Dev preview overlay: disabled boxes and toggle cascade. */
import { needsHint, toggled } from '../../src/dev_preview_rules.ts'

const f = (key, requires = [], checked = true) => ({ key, branch: 'wave7/' + key, title: 'T-' + key, requires, checked })
const set = [f('events'), f('event-link', ['events']), f('deep', ['event-link']), f('overlay')]
const on = (fs) => fs.filter((x) => x.checked).map((x) => x.key)

describe('dev preview rules', () => {
  it('a box is disabled only while a required feature is unchecked, with its title as hint', () => {
    expect(needsHint(set, 'event-link')).toBeNull()
    expect(needsHint(toggled(set, 'events', false), 'event-link')).toBe('needs T-events')
    expect(needsHint(set, 'nope')).toBeNull()
  })
  it('off unchecks dependents transitively and leaves the rest', () => {
    expect(on(toggled(set, 'events', false))).toEqual(['overlay'])
    expect(on(toggled(set, 'deep', false))).toEqual(['events', 'event-link', 'overlay'])
  })
  it('on checks the requires transitively', () => {
    const off = toggled(set, 'events', false)
    expect(on(toggled(off, 'deep', true))).toEqual(['events', 'event-link', 'deep', 'overlay'])
    expect(on(toggled(off, 'event-link', true))).toEqual(['events', 'event-link', 'overlay'])
  })
  it('does not mutate its input', () => {
    toggled(set, 'events', false)
    expect(on(set)).toHaveLength(4)
  })
})
