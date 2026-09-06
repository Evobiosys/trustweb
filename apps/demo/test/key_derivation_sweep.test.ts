import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A STRUCTURAL guard, not a behavioural one, and deliberately so.
 *
 * answer_key.test.ts proves the fixed path is correct. It cannot prove that
 * a SEVENTH call site will not reintroduce the same fallback next month --
 * that is a property of the whole source tree, and the defect it guards
 * against (follow-up 1 of the C-02/F-01 review) existed at SIX call sites at
 * once precisely because the rule lived nowhere except in a copy-pasted
 * ternary.
 *
 * THE RULE: no AES-GCM key anywhere in this app may be derived solely from
 * data that travels in cleartext. In practice that means `derivePairKey` --
 * HKDF over two plaintext strings, whose own doc comment already says
 * "anyone who saw both ... can compute the same key" -- must never be called
 * with a query id, and never with one argument twice.
 *
 * Comments and string literals are stripped before matching, so the historical
 * explanations of the removed construction (which quote it verbatim, on
 * purpose, because a fix nobody can read is a fix nobody can keep) do not
 * make this test lie in either direction.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return tsFiles(full)
    return name.endsWith('.ts') || name.endsWith('.svelte') ? [full] : []
  })
}

/**
 * Blank out block comments, line comments and every string/template literal,
 * preserving offsets so a hit's line number still means something. Written
 * as a small scanner rather than a regex because a regex cannot tell a `//`
 * inside a string from a comment, and this test's whole value is that it
 * does not cry wolf.
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

/** Every `derivePairKey(...)` call, with its two argument expressions. */
function derivePairKeyCalls(code: string): { args: string[]; line: number }[] {
  const calls: { args: string[]; line: number }[] = []
  const re = /derivePairKey\s*\(([^()]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    calls.push({
      args: m[1].split(',').map((a) => a.trim()).filter((a) => a.length > 0),
      line: code.slice(0, m.index).split('\n').length,
    })
  }
  return calls
}

describe('no AES-GCM key is derived solely from data that travels in cleartext', () => {
  const files = tsFiles(SRC).map((f) => ({ f, code: stripCommentsAndStrings(readFileSync(f, 'utf8')) }))

  it('finds the source tree it is supposed to be scanning', () => {
    // A sweep that silently scans nothing is worse than no sweep.
    expect(files.length).toBeGreaterThan(10)
    expect(files.some(({ f }) => f.endsWith('main.ts'))).toBe(true)
    expect(files.some(({ code }) => code.includes('derivePairKey'))).toBe(true)
  })

  it('never calls derivePairKey with a query id', () => {
    const offenders: string[] = []
    for (const { f, code } of files) {
      for (const { args, line } of derivePairKeyCalls(code)) {
        if (args.some((a) => /(^|\.)qid$/.test(a))) offenders.push(`${f}:${line} derivePairKey(${args.join(', ')})`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('never calls derivePairKey with the same expression twice', () => {
    // `derivePairKey(x, x)` collapses HKDF's two-input binding to one input.
    // Whatever `x` is, it can no longer be a secret shared by exactly two
    // parties -- it is whatever `x` alone is.
    const offenders: string[] = []
    for (const { f, code } of files) {
      for (const { args, line } of derivePairKeyCalls(code)) {
        if (args.length === 2 && args[0] === args[1]) offenders.push(`${f}:${line} derivePairKey(${args.join(', ')})`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('routes every no-peer answer through answer_key.ts rather than an inline fallback', () => {
    // The shape the defect had: a ternary that produced a key when there was
    // no peer to produce one from.
    const offenders: string[] = []
    for (const { f, code } of files) {
      for (const m of code.matchAll(/peer\s*\?[^\n]*:\s*await\s+derive\w*Key/g)) {
        offenders.push(`${f}:${code.slice(0, m.index).split('\n').length} ${m[0].trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('has exactly the encrypt call sites the C-02 review enumerated, and no new ones', () => {
    // A new `seal(`/`subtle.encrypt(` site is where the next version of this
    // defect would live, so it must be a deliberate, reviewed addition rather
    // than something this sweep quietly tolerates.
    const sites: string[] = []
    for (const { f, code } of files) {
      for (const m of code.matchAll(/\bseal\s*\(|subtle\.encrypt\s*\(/g)) {
        sites.push(`${f.slice(SRC.length + 1)}:${code.slice(0, m.index).split('\n').length}`)
      }
    }
    // gate.ts's sealAnswerEnvelope, relay.ts's encryptEnvelope, and crypto.ts's
    // own `seal` primitive (its declaration and its `subtle.encrypt` body)
    // that both of them call. Both callers draw randomBytes(12); neither
    // takes a key derived from the wire.
    expect([...new Set(sites.map((s) => s.split(':')[0]))].sort()).toEqual(['crypto.ts', 'gate.ts', 'relay.ts'])
    expect(sites).toHaveLength(4)
  })
})
