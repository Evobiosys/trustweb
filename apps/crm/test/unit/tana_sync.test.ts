import { describe, expect, it } from 'vitest'
import { manualItems, nameIn, parseRpc, planFieldSync } from '../../src/tana_sync'

describe('tana sync plan', () => {
  it('maps content, option, checkbox and email edits to Tana tools', () => {
    expect(planFieldSync('xu0y_4Pu3sOL', 'Graz')).toEqual({ tool: 'set_field_content', args: { attributeId: 'xu0y_4Pu3sOL', content: 'Graz', mode: 'replace' } })
    expect(planFieldSync('rw87wwUgfnla', '2')).toEqual({ tool: 'set_field_option', args: { attributeId: 'rw87wwUgfnla', optionId: '5K66xenImXne' } })
    expect(planFieldSync('__XNQ42Dtiwx', true)).toMatchObject({ args: { content: '[X]' } })
    expect(planFieldSync('Bxw7k4FWptqp', 'a@example.org')).toMatchObject({ tool: 'set_field_content' })
  })
  it('maps a ring to the Tana ring option', () => {
    expect(planFieldSync('tw-ring', 'close')).toEqual({ tool: 'set_field_option', args: { attributeId: 'rVfw62lb7BYD', optionId: 'ODC_KVcWiMTS' } })
    expect(planFieldSync('tw-ring', 'bogus')).toMatchObject({ args: { optionId: 'THYXz_h9_MSf' } })
  })
  it('flags what a human must do in Tana', () => {
    expect(planFieldSync('yHXufuk2A7rt', 'Some org')).toHaveProperty('manual')
    expect(planFieldSync('57duUT9M7ZmS', 'ISFJ')).toHaveProperty('manual')
    expect(planFieldSync('adhoc:Date', 'x')).toHaveProperty('manual')
    expect(manualItems([{ id: 'p1', name: 'Anna Beispiel' }], { p1: { yHXufuk2A7rt: 'x', xu0y_4Pu3sOL: 'Graz' } })).toHaveLength(1)
  })
  it('reads plain JSON and SSE replies', () => {
    expect(parseRpc('{"result":{"content":[{"text":"ok"}]}}').result?.content?.[0].text).toBe('ok')
    expect(parseRpc('event: message\ndata: {"result":{}}\n\n')).toEqual({ result: {} })
    expect(parseRpc('')).toEqual({})
  })
  it('reads the node name from a live read_node reply', () => {
    expect(nameIn('- Ramakrishna #person <!-- node-id: eOW0VvopwvO_ -->\n  - *[... 8 children truncated due to depth limit]*\n')).toBe('Ramakrishna')
    expect(nameIn('- Ann Lee #person #famous <!-- node-id: abc -->')).toBe('Ann Lee')
    expect(nameIn('nothing')).toBeNull()
  })
})
