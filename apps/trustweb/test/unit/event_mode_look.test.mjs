// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 event-mode-visible: event mode changes the look (header tint, note chip, bottom bar tint) in the event's colour; off = normal. */
import { eventModeLook, applyEventModeLook } from '../../src/event_mode_look.ts'
import { eventColour } from '../../src/event_cluster.ts'
import { eventTagSlug } from '../../src/event_tag.ts'
import { tagLabel } from '../../src/events.ts'

const events = [{ id: 'e1', name: 'Winter IYG' }]
const fakeBody = () => { const props = {}; return { dataset: {}, style: { setProperty: (k, v) => { props[k] = v }, removeProperty: (k) => { delete props[k] } }, props } }

describe('event mode look', () => {
  it('null when off or the event is gone', () => {
    expect(eventModeLook({ uiRings: {}, events })).toBeNull()
    expect(eventModeLook({ uiRings: { eventMode: 'zz' }, events })).toBeNull()
  })
  it('on: the event colour and the #event:<name> label', () => {
    const l = eventModeLook({ uiRings: { eventMode: 'e1' }, events })
    expect(l.label).toBe('#event:Winter IYG')
    expect(l.colour).toBe(eventColour(eventTagSlug(tagLabel(events[0]))))
  })
  it('apply sets the body marker and colour; off removes both', () => {
    const b = fakeBody()
    applyEventModeLook(b, { uiRings: { eventMode: 'e1' }, events })
    expect(b.dataset.twEventMode).toBe('e1')
    expect(b.props['--event-mode-colour']).toBe(eventColour(eventTagSlug(tagLabel(events[0]))))
    applyEventModeLook(b, { uiRings: {}, events })
    expect(b.dataset.twEventMode).toBeUndefined()
    expect(b.props['--event-mode-colour']).toBeUndefined()
  })
})
