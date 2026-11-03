// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The option tokenizer, git-like and dependency-free: `--name value`, `--name=value`, `-n value`, flags, repeatable
 * list options, and `--` to end the options. Positionals keep their order. An unknown option is a UsageError (exit 2):
 * a typo must never pass as a positional and silently do something else.
 */

export type OptionKind = 'flag' | 'string' | 'list'

export interface Option {
  /** Long name without dashes: `--label`. */
  name: string
  /** One-letter alias: `-l`. */
  alias?: string
  kind: OptionKind
  /** Shown in help after the name, e.g. `<text>`. */
  placeholder?: string
  help: string
}

export type OptionValue = string | boolean | string[]

export interface Parsed {
  positionals: string[]
  options: Record<string, OptionValue>
}

/** Wrong use of the command line (exit code 2). The message names what was wrong; the caller adds the usage line. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

function find(options: readonly Option[], token: string): Option | undefined {
  return token.startsWith('--') ? options.find((o) => o.name === token.slice(2)) : options.find((o) => o.alias === token.slice(1))
}

function set(out: Record<string, OptionValue>, o: Option, value: string | undefined, spelled: string): void {
  if (o.kind === 'flag') {
    if (value !== undefined) throw new UsageError(`${spelled} takes no value`)
    out[o.name] = true
    return
  }
  if (value === undefined) throw new UsageError(`${spelled} needs a value${o.placeholder ? ` ${o.placeholder}` : ''}`)
  if (o.kind === 'list') out[o.name] = [...((out[o.name] as string[] | undefined) ?? []), value]
  else out[o.name] = value
}

export function parseArgs(argv: readonly string[], options: readonly Option[]): Parsed {
  const positionals: string[] = []
  const out: Record<string, OptionValue> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (a === '-' || !a.startsWith('-')) {
      positionals.push(a)
      continue
    }
    const eq = a.startsWith('--') ? a.indexOf('=') : -1
    const spelled = eq > 0 ? a.slice(0, eq) : a
    const o = find(options, spelled)
    if (!o) throw new UsageError(`unknown option ${spelled}`)
    if (eq > 0) {
      set(out, o, a.slice(eq + 1), spelled)
    } else if (o.kind === 'flag') {
      set(out, o, undefined, spelled)
    } else {
      set(out, o, i + 1 < argv.length ? argv[++i] : undefined, spelled)
    }
  }
  return { positionals, options: out }
}
