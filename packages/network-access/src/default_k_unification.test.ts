// Finding 3 guard (2026-09-06 UH-findings handover, docs/k-parameters.md).
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
// KNOWN EXCEPTION, found while writing this test (not fixed by it — see
// docs/k-parameters.md's Finding 3 section for the open ❗): packages/
// inventory-store/src/query.ts also defines its own `DEFAULT_K = 3`,
// currently value-equal to this one but NOT imported from it.
// inventory-store deliberately declares zero dependencies (its own package.json
// has none; that fact was load-bearing evidence in decision B-22's AGPL/
// third-party-dependency audit), and network-access is licensed
// AGPL-3.0-or-later, so wiring inventory-store to import this constant is a
// dependency/license call for the project owner, not something this test or
// this handover should decide silently. Until that is resolved,
// inventory-store's copy is allowlisted below on the condition that its
// VALUE never drifts from this one -- if it ever does, or if any THIRD file
// defines DEFAULT_K, this test fails.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_K, MIN_K } from './anonymity.js'

// packages/network-access/src -> packages/network-access -> packages -> repo root
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const CANONICAL_FILE = join(ROOT, 'packages', 'network-access', 'src', 'anonymity.ts')
/** See the KNOWN EXCEPTION note above -- allowlisted only while its value matches DEFAULT_K exactly. */
const ALLOWLISTED_SECONDARY_FILE = join(ROOT, 'packages', 'inventory-store', 'src', 'query.ts')
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

/** Extracts the integer RHS of `export const DEFAULT_K = <n>` in `code`, or undefined if absent. */
function extractDefaultKValue(code: string): number | undefined {
  const m = /export\s+const\s+DEFAULT_K\s*=\s*(\d+)/.exec(code)
  return m ? Number(m[1]) : undefined
}

describe('DEFAULT_K is defined exactly once (plus one flagged, value-pinned exception) across the workspace (Finding 3)', () => {
  const files = workspaceSrcDirs()
    .flatMap(tsFilesUnder)
    .filter((f) => f !== SELF)

  it('finds the workspace it is supposed to be scanning', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files).toContain(CANONICAL_FILE)
  })

  it('has no DEFAULT_K definition outside the canonical file and the one flagged exception', () => {
    const defRe = /export\s+const\s+DEFAULT_K\b/
    const definedIn = files.filter((f) => defRe.test(readFileSync(f, 'utf8')))
    expect(definedIn.sort()).toEqual([ALLOWLISTED_SECONDARY_FILE, CANONICAL_FILE].sort())
  })

  it('the allowlisted secondary definition (inventory-store/src/query.ts) has not drifted from the canonical value', () => {
    const secondaryValue = extractDefaultKValue(readFileSync(ALLOWLISTED_SECONDARY_FILE, 'utf8'))
    expect(secondaryValue).toBe(DEFAULT_K)
  })

  it('the canonical value is 3, with the floor derived from it (never a second literal)', () => {
    expect(DEFAULT_K).toBe(3)
    expect(MIN_K).toBe(Math.max(2, DEFAULT_K - 1))
    expect(MIN_K).toBe(2)
  })
})
