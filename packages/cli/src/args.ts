// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** A small argv parser, enough for a git-like CLI: `--flag`, `--flag value`, `--flag=value`, `-x`, repeatable lists, `--`. Pure. */
import { usage } from './errors'

export type FlagKind = 'bool' | 'string' | 'list'
export type FlagSpec = Readonly<Record<string, { kind: FlagKind; short?: string }>>
export interface Parsed { positionals: string[]; flags: Record<string, string | boolean | string[]> }

export function parseArgs(argv: readonly string[], spec: FlagSpec): Parsed {
  const out: Parsed = { positionals: [], flags: {} }
  const byShort = new Map(Object.entries(spec).flatMap(([name, s]) => (s.short ? [[s.short, name] as const] : [])))
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]
    if (word === '--') { out.positionals.push(...argv.slice(i + 1)); break }
    if (word === '-' || !word.startsWith('-')) { out.positionals.push(word); continue }
    const long = word.startsWith('--')
    const [key, inline] = long ? splitOnce(word.slice(2)) : [word.slice(1), undefined]
    const name = long ? key : byShort.get(key)
    if (name === undefined || !Object.hasOwn(spec, name)) throw usage(`unknown option ${word}`)
    const s = spec[name]
    if (s.kind === 'bool') {
      if (inline !== undefined) throw usage(`${long ? '--' : '-'}${key} takes no value`)
      out.flags[name] = true
      continue
    }
    const value = inline ?? argv[++i]
    if (value === undefined) throw usage(`${long ? '--' : '-'}${key} needs a value`)
    if (s.kind === 'list') out.flags[name] = [...((out.flags[name] as string[] | undefined) ?? []), value]
    else if (name in out.flags) throw usage(`--${name} given twice`)
    else out.flags[name] = value
  }
  return out
}

function splitOnce(s: string): [string, string | undefined] {
  const at = s.indexOf('=')
  return at < 0 ? [s, undefined] : [s.slice(0, at), s.slice(at + 1)]
}
