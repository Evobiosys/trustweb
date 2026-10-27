// Structure gate for docs/research/sharing-layer-options.md (research note, no code).
// Keeps the note honest: every option compared, a recommendation present, claims tiered,
// confidence stated, and no personal data (I7 spirit: never claim more than was verified).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DOC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/research/sharing-layer-options.md')
const doc = () => readFileSync(DOC, 'utf8')

describe('sharing-layer-options research note', () => {
  it('exists', () => {
    expect(existsSync(DOC)).toBe(true)
  })

  it.each(['OpenFGA', 'SpiceDB', 'Ory Keto', 'Solid WAC', 'Solid ACP', 'NextGraph'])(
    'covers %s',
    (name) => {
      expect(doc()).toContain(name)
    },
  )

  it.each(['tag', 'trust zone', 'person', 'group'])('evaluates the %s requirement', (req) => {
    expect(doc().toLowerCase()).toContain(req)
  })

  it('states a recommendation and a comparison table', () => {
    expect(doc()).toMatch(/^## .*Recommendation/m)
    expect(doc()).toMatch(/^\|.*OpenFGA.*\|/m)
  })

  it('tiers sources and states confidence', () => {
    expect(doc()).toMatch(/\[A\]/)
    expect(doc()).toMatch(/\[B\]/)
    expect(doc()).toMatch(/confidence/i)
  })

  it('links back to the invariants it must not break', () => {
    for (const i of ['I1', 'I2', 'I5']) expect(doc()).toContain(i)
  })

  it('contains no personal data', () => {
    expect(doc()).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
  })
})
