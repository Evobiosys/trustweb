import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * C-03 guard. "kThreshold: 1 must not ship" is Jakob's standing rule,
 * repeated across four handover documents. It was fixed once (2026-09-06)
 * by replacing the four literal `kThreshold: 1` sites in src/ with the
 * workspace's DEFAULT_K, imported from
 * packages/network-access/src/anonymity.ts. This is a STRUCTURAL guard, not
 * a behavioural one: it exists so the literal cannot quietly come back --
 * copy-pasted from an old branch, added by a new template, reintroduced by
 * a careless merge -- without a test failing.
 *
 * Scope is src/ only. Tests are exempt and MAY use kThreshold: 1 explicitly
 * when a fixture genuinely needs a floor of one to exercise a code path --
 * that is a labelled test-only value, not the banned production default.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return tsFiles(full)
    return name.endsWith('.ts') ? [full] : []
  })
}

/**
 * Blank out block comments, line comments and every string/template literal,
 * preserving offsets. Same technique as key_derivation_sweep.test.ts, for the
 * same reason: this file's own C-03 explanatory comments quote the banned
 * literal verbatim (on purpose, so the history stays readable), and a naive
 * scan of raw source would flag its own documentation as a violation.
 */
function stripCommentsAndStrings(src: string): string {
  const out = src.split('')
  let i = 0
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
  }
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      blank(i, stop); i = stop; continue
    }
    if (two === '//') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      blank(i, stop); i = stop; continue
    }
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === ch) { j++; break }
        j++
      }
      blank(i, j); i = j; continue
    }
    i++
  }
  return out.join('')
}

describe('kThreshold: 1 never ships in apps/demo/src (C-03)', () => {
  const files = tsFiles(SRC).map((f) => ({ f, raw: readFileSync(f, 'utf8'), code: stripCommentsAndStrings(readFileSync(f, 'utf8')) }))

  it('finds the source tree it is supposed to be scanning', () => {
    expect(files.length).toBeGreaterThan(10)
    expect(files.some(({ f }) => f.endsWith('main.ts'))).toBe(true)
  })

  it('has no kThreshold: 1 literal anywhere under src/', () => {
    const offenders: string[] = []
    const re = /kThreshold\s*:\s*1(?!\d)/g
    for (const { f, code } of files) {
      for (const m of code.matchAll(re)) {
        offenders.push(`${f.slice(SRC.length + 1)}:${code.slice(0, m.index).split('\n').length}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('uses DEFAULT_K, not a locally renamed stand-in, at the four known call sites', () => {
    // A renamed constant (e.g. `const DEMO_K = 1`) would pass the check above
    // while keeping the banned behaviour -- so require the actual import.
    const knownSites = [
      'main.ts',
      'match/accommodation.ts',
      'data/free_text_query.ts',
      'data/templates.ts',
    ]
    for (const rel of knownSites) {
      const entry = files.find(({ f }) => f.endsWith(rel))
      expect(entry, `expected to find ${rel}`).toBeTruthy()
      expect(entry!.raw).toMatch(/from ['"]@resource-web\/network-access\/anonymity['"]/)
      expect(entry!.code).toContain('DEFAULT_K')
    }
  })
})
