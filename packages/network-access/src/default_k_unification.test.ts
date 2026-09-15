// Finding 3 guard (2026-09-06 UH-findings handover, docs/k-parameters.md),
// updated by the 2026-09-06 k-standardize pass ("keep k as is, just
// standardize them").
//
// DEFAULT_K used to disagree across forks: primary-repo shipped 3, the
// rebiosys fork shipped its own copy at 7, and packages/query-infra held a
// third vault-specific duplicate of 7. All three were reconciled into this
// one exported constant when query-infra was ported into the trunk (decision
// B-03 option A). This test is the STRUCTURAL guard against that drift
// coming back: a second `export const DEFAULT_K` anywhere in the workspace
// (a re-fork, a copy-pasted package, a careless merge) fails this test even
// if nobody remembers the history above.
//
// The k-standardize pass resolved the one remaining ambiguity this test used
// to carry as a value-pinned allowlist exception: packages/inventory-store/
// src/query.ts's own zero-dependency floor is no longer named `DEFAULT_K` at
// all -- it is `INVENTORY_DEFAULT_K`, so it can never again be mistaken for
// (or accidentally satisfy a grep for) the canonical constant. It also
// deliberately named the OTHER historical drift value -- the four
// apps/demo/src/data/templates.ts templates that used to hardcode a literal
// 7 -- as `HIGH_RISK_TEMPLATE_K`, defined beside DEFAULT_K in anonymity.ts.
//
// So this file now checks EXACTLY these named constants and nothing else:
//   - DEFAULT_K, MIN_K, HIGH_RISK_TEMPLATE_K: defined ONLY in the canonical
//     anonymity.ts, nowhere else in the workspace.
//   - INVENTORY_DEFAULT_K: defined ONLY in inventory-store's query.ts,
//     nowhere else -- and its value must never drift from DEFAULT_K (the
//     cross-package equality itself is asserted by
//     apps/demo/test/k_cross_package_sync.test.ts, which can import both
//     packages; this file cannot, since network-access must not gain a
//     dependency on inventory-store or vice versa -- see the dependency/
//     license reasoning in query.ts's own comment, decision B-22).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_K, HIGH_RISK_TEMPLATE_K, MIN_K } from './anonymity.js'

// packages/network-access/src -> packages/network-access -> packages -> repo root
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const CANONICAL_FILE = join(ROOT, 'packages', 'network-access', 'src', 'anonymity.ts')
const INVENTORY_FILE = join(ROOT, 'packages', 'inventory-store', 'src', 'query.ts')
/** This file's own doc comment quotes the pattern it scans for -- exclude it from its own scan. */
const SELF = fileURLToPath(import.meta.url)

function tsFilesUnder(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries.flatMap((name) => {
    if (name === 'node_modules' || name === 'dist' || name === '.git') return []
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return tsFilesUnder(full)
    return name.endsWith('.ts') || name.endsWith('.tsx') ? [full] : []
  })
}

function workspaceSrcDirs(): string[] {
  const dirs: string[] = []
  for (const group of ['packages', 'apps']) {
    const groupDir = join(ROOT, group)
    let members: string[]
    try {
      members = readdirSync(groupDir)
    } catch {
      continue
    }
    for (const member of members) {
      const src = join(groupDir, member, 'src')
      try {
        if (statSync(src).isDirectory()) dirs.push(src)
      } catch {
        // no src/ dir for this member (e.g. a docs-only or config-only package) -- skip
      }
    }
  }
  return dirs
}

/** Extracts the integer RHS of `export const <name> = <n>` in `code`, or undefined if absent. */
function extractConstValue(code: string, name: string): number | undefined {
  const m = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(\\d+)`).exec(code)
  return m ? Number(m[1]) : undefined
}

function definesConst(code: string, name: string): boolean {
  return new RegExp(`export\\s+const\\s+${name}\\b`).test(code)
}

describe('the workspace k-constants are each defined in exactly one named, expected place (Finding 3)', () => {
  const files = workspaceSrcDirs()
    .flatMap(tsFilesUnder)
    .filter((f) => f !== SELF)

  it('finds the workspace it is supposed to be scanning', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files).toContain(CANONICAL_FILE)
    expect(files).toContain(INVENTORY_FILE)
  })

  it('DEFAULT_K, MIN_K and HIGH_RISK_TEMPLATE_K are defined only in the canonical file', () => {
    for (const name of ['DEFAULT_K', 'MIN_K', 'HIGH_RISK_TEMPLATE_K']) {
      const definedIn = files.filter((f) => definesConst(readFileSync(f, 'utf8'), name))
      expect(definedIn, `${name} should be defined in exactly the canonical file`).toEqual([CANONICAL_FILE])
    }
  })

  it('INVENTORY_DEFAULT_K is defined only in inventory-store, and nowhere is DEFAULT_K itself redeclared under that name', () => {
    const definedIn = files.filter((f) => definesConst(readFileSync(f, 'utf8'), 'INVENTORY_DEFAULT_K'))
    expect(definedIn).toEqual([INVENTORY_FILE])
  })

  it('INVENTORY_DEFAULT_K has not drifted from the canonical DEFAULT_K value', () => {
    const inventoryValue = extractConstValue(readFileSync(INVENTORY_FILE, 'utf8'), 'INVENTORY_DEFAULT_K')
    expect(inventoryValue).toBe(DEFAULT_K)
  })

  it('the canonical values are unchanged: DEFAULT_K = 3, MIN_K = 2 (derived), HIGH_RISK_TEMPLATE_K = 7', () => {
    expect(DEFAULT_K).toBe(3)
    expect(MIN_K).toBe(Math.max(2, DEFAULT_K - 1))
    expect(MIN_K).toBe(2)
    expect(HIGH_RISK_TEMPLATE_K).toBe(7)
  })
})
