// k-standardize follow-up (2026-09-08), docs/k-parameters.md's k4 section.
//
// apps/demo/src/central/types.ts duplicates @resource-web/wot-policy's
// `DeclarationFacets` interface field-for-field, on purpose -- that package
// may not be built yet when this unit builds (central-rag handover, unit U4
// note), so the two are developed in parallel against a shape both sides
// agree on rather than one importing the other. types.ts's own comment says
// so and points here.
//
// That non-import is only safe while the two shapes agree. Nothing type-level
// enforces it: TypeScript interfaces are structural and erased at runtime, so
// two independently hand-written interfaces with the same field names
// typecheck as interchangeable with no import between them either way --
// which is exactly the useful property being relied on, and exactly why a
// silent field add/rename/remove on one side would not be caught by tsc
// unless something else notices. This file is that something else: it reads
// both source files as text and compares the field NAME sets of each
// `DeclarationFacets` interface body directly, the same style as
// packages/network-access/src/default_k_unification.test.ts's structural
// guard. If this test ever fails, someone changed one shape without the
// other -- fix the field, don't delete this test.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// apps/demo/test -> apps/demo -> apps -> repo root
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const POLICY_FILE = `${ROOT}packages/wot-policy/src/index.ts`
const DEMO_FILE = `${ROOT}apps/demo/src/central/types.ts`

/**
 * Extracts the field names declared directly inside
 * `export interface <name> { ... }` in `code`. Doc-comment lines do not
 * match: the pattern requires a field name to start the (trimmed) line, and
 * every doc-comment line in both files starts with a `/**`-style opener,
 * not a word character.
 */
function interfaceFieldNames(code: string, name: string): string[] {
  const bodyMatch = new RegExp(`interface\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(code)
  if (!bodyMatch) throw new Error(`interface ${name} not found in the given source`)
  const body = bodyMatch[1]
  const names: string[] = []
  const fieldPattern = /^\s*(\w+)\??:\s*\S/gm
  let m: RegExpExecArray | null
  while ((m = fieldPattern.exec(body))) {
    names.push(m[1])
  }
  return names.sort()
}

describe('apps/demo/src/central/types.ts DeclarationFacets stays field-identical to wot-policy DeclarationFacets', () => {
  const policySource = readFileSync(POLICY_FILE, 'utf8')
  const demoSource = readFileSync(DEMO_FILE, 'utf8')

  it('finds both interface declarations', () => {
    expect(policySource).toMatch(/export interface DeclarationFacets \{/)
    expect(demoSource).toMatch(/export interface DeclarationFacets \{/)
  })

  it('the two independently-declared interfaces have exactly the same field names', () => {
    const policyFields = interfaceFieldNames(policySource, 'DeclarationFacets')
    const demoFields = interfaceFieldNames(demoSource, 'DeclarationFacets')
    expect(
      demoFields,
      "apps/demo/src/central/types.ts's DeclarationFacets has drifted from " +
        '@resource-web/wot-policy\'s -- the manual sync in that file\'s own ' +
        'comment has been broken; update the duplicate to match, or import ' +
        'the real type instead (the package is a workspace dependency of ' +
        'apps/demo as of this test, so importing is now possible).',
    ).toEqual(policyFields)
  })

  it('the expected field set is what both sides say it is (catches this test itself going stale)', () => {
    const policyFields = interfaceFieldNames(policySource, 'DeclarationFacets')
    expect(policyFields).toEqual(['authorCommitment', 'category', 'regionCode', 'sensitive'])
  })
})
