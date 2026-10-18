/** Settings > Features: only "off" is stored; the Feed keeps its own switch. */
import { describe, expect, it } from 'vitest'
import { featureOn, setFeature } from '../../src/model.ts'

describe('features', () => {
  it('events and inventory are on unless stored false; the feed follows feed.on', () => {
    expect(featureOn({}, 'events')).toBe(true)
    expect(featureOn({ features: { events: false } }, 'events')).toBe(false)
    expect(featureOn({ features: { events: false } }, 'inventory')).toBe(true)
    expect(featureOn({}, 'feed')).toBe(false)
    expect(featureOn({ feed: { on: true } }, 'feed')).toBe(true)
  })
  it('switching on removes the key and the empty record', () => {
    const s = {}
    setFeature(s, 'events', false)
    setFeature(s, 'inventory', false)
    expect(s.features).toEqual({ events: false, inventory: false })
    setFeature(s, 'events', true)
    expect(s.features).toEqual({ inventory: false })
    setFeature(s, 'inventory', true)
    expect(s.features).toBeUndefined()
  })
})
