// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The command tree and what every command gets to work with. A Command is data: name, one-line summary, usage,
 * options, positionals, subcommands, and `run`. Help is rendered from that data, so `--help` exists for every command
 * and subcommand by construction and never drifts from what the command accepts. Exit codes, git-like:
 *   0 done   1 the record or the request refused it (RecordError, IdError, CommandError)   2 wrong use of the command line
 */
import { parseArgs, UsageError, type Option, type OptionValue } from './args.ts'
import { IdError } from './ids.ts'
import { RecordError, appendLog, discoverRecord, loadRecord, saveRecord, type TrustRecord } from './record.ts'

export const GLOBAL_OPTIONS: readonly Option[] = [
  { name: 'record', kind: 'string', placeholder: '<file>', help: 'The record file to use (else $TRUSTWEB_RECORD, else the nearest .trustweb/record.json up the tree)' },
  { name: 'json', kind: 'flag', help: 'Print the result as JSON instead of text' },
  { name: 'now', kind: 'string', placeholder: '<iso-date>', help: 'Pretend it is this moment (tests, replays); else $TRUSTWEB_NOW, else the clock' },
  { name: 'help', alias: 'h', kind: 'flag', help: 'Show this help' },
  { name: 'version', alias: 'V', kind: 'flag', help: 'Print the version' },
]

export interface Positional {
  name: string
  help: string
  /** Default false: the command needs it. */
  optional?: boolean
  /** Default false: the last positional may repeat. */
  variadic?: boolean
}

export interface Io {
  cwd: string
  env: Record<string, string | undefined>
  stdout: (text: string) => void
  stderr: (text: string) => void
}

/** What `run` gets: the parsed line, the clock, the record (opened on first use), and the two ways to answer. */
export interface Ctx {
  io: Io
  /** The command path as typed, e.g. ['zone', 'create']. */
  path: readonly string[]
  positionals: readonly string[]
  options: Readonly<Record<string, OptionValue>>
  now: Date
  json: boolean
  /** The record, loaded from where discoverRecord found it; a CommandError when there is none. */
  record(): TrustRecord
  /** Where the record is, or null when none was found (init uses this). */
  recordPath(): string | null
  /** Appends one audit line and saves the record (the whole command's change, in one write). */
  commit(r: TrustRecord, text: string, path?: string): void
  /** The answer: `text` lines for a person, `data` when --json was given. */
  emit(data: unknown, text: string | readonly string[]): void
  /** A warning for a person, to stderr; never in the JSON. */
  warn(text: string): void
}

export interface Command {
  name: string
  summary: string
  /** Longer text under the usage line. */
  description?: string
  positionals?: readonly Positional[]
  options?: readonly Option[]
  subcommands?: readonly Command[]
  examples?: readonly string[]
  run?: (ctx: Ctx) => void | Promise<void>
}

/** The command understood the line but cannot do it (exit code 1): a zone not set up, a person unknown, a cycle. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommandError'
  }
}

export const PROGRAM = 'trustweb'

// ---- help --------------------------------------------------------------------------------------------------------

const usageOf = (path: readonly string[], c: Command): string => {
  const parts = [PROGRAM, ...path]
  if (c.subcommands?.length) parts.push('<command>')
  for (const p of c.positionals ?? []) parts.push(p.optional ? `[${p.name}${p.variadic ? '...' : ''}]` : `<${p.name}>${p.variadic ? '...' : ''}`)
  if (c.options?.length || !c.subcommands?.length) parts.push('[options]')
  return parts.join(' ')
}

function columns(rows: readonly (readonly [string, string])[], indent = '  '): string[] {
  const width = Math.max(0, ...rows.map(([a]) => a.length))
  return rows.map(([a, b]) => `${indent}${a.padEnd(width)}  ${b}`)
}

const optionLabel = (o: Option): string => `${o.alias ? `-${o.alias}, ` : '    '}--${o.name}${o.placeholder ? ` ${o.placeholder}` : ''}`

/** The help text of a command: usage, description, subcommands, positionals, its options, the global options, examples. */
export function renderHelp(path: readonly string[], c: Command): string {
  const out: string[] = [`${c.summary}`, '', `Usage: ${usageOf(path, c)}`]
  if (c.description) out.push('', ...c.description.split('\n'))
  if (c.subcommands?.length) {
    out.push('', 'Commands:', ...columns(c.subcommands.map((s) => [s.name, s.summary] as const)))
    out.push('', `Run \`${[PROGRAM, ...path, '<command>'].join(' ')} --help\` for one command.`)
  }
  if (c.positionals?.length) out.push('', 'Arguments:', ...columns(c.positionals.map((p) => [p.name, p.help] as const)))
  if (c.options?.length) out.push('', 'Options:', ...columns(c.options.map((o) => [optionLabel(o), o.help] as const)))
  out.push('', 'Global options:', ...columns(GLOBAL_OPTIONS.map((o) => [optionLabel(o), o.help] as const)))
  if (c.examples?.length) out.push('', 'Examples:', ...c.examples.map((e) => `  ${e}`))
  return out.join('\n') + '\n'
}

/** Walks the tree along the leading positionals; returns the command and the path taken. */
export function resolveCommand(root: Command, words: readonly string[]): { command: Command; path: string[]; rest: string[] } {
  let command = root
  const path: string[] = []
  let i = 0
  while (command.subcommands?.length && i < words.length) {
    const next = command.subcommands.find((s) => s.name === words[i])
    if (!next) break
    command = next
    path.push(words[i])
    i++
  }
  return { command, path, rest: words.slice(i) }
}

/** Every command in the tree, with its path, for tests and docs. */
export function walk(root: Command, path: string[] = []): { path: string[]; command: Command }[] {
  return [{ path, command: root }, ...(root.subcommands ?? []).flatMap((s) => walk(s, [...path, s.name]))]
}

// ---- running -----------------------------------------------------------------------------------------------------

function checkPositionals(c: Command, given: readonly string[]): void {
  const spec = c.positionals ?? []
  const required = spec.filter((p) => !p.optional).length
  if (given.length < required) throw new UsageError(`missing <${spec[given.length].name}>`)
  const variadic = spec.some((p) => p.variadic)
  if (!variadic && given.length > spec.length) throw new UsageError(`unexpected argument "${given[spec.length]}"`)
}

function clock(option: OptionValue | undefined, env: Record<string, string | undefined>): Date {
  const text = typeof option === 'string' ? option : env.TRUSTWEB_NOW
  if (text === undefined) return new Date()
  const t = Date.parse(text)
  if (Number.isNaN(t)) throw new UsageError(`--now: "${text}" is not a date`)
  return new Date(t)
}

/** Runs one command line against the tree; returns the exit code. Everything a person sees goes through `io`. */
export async function execute(root: Command, argv: readonly string[], io: Io, version: string): Promise<number> {
  let path: string[] = []
  let command = root
  try {
    // Two passes: first the command is found among the words (options skipped leniently, so an unknown one is reported
    // against the right command), then the line is parsed strictly with that command's options.
    const wantsHelp = argv.includes('--help') || argv.includes('-h')
    if (argv.includes('--version') || argv.includes('-V')) {
      io.stdout(`${PROGRAM} ${version}\n`)
      return 0
    }
    const resolved = resolveCommand(root, words(argv, [...GLOBAL_OPTIONS, ...allOptions(root)]))
    command = resolved.command
    path = resolved.path
    if (wantsHelp || (command.subcommands?.length && !command.run)) {
      if (!wantsHelp && resolved.rest.length) throw new UsageError(`unknown command "${[...path, resolved.rest[0]].join(' ')}"`)
      io.stdout(renderHelp(path, command))
      return wantsHelp ? 0 : 2
    }
    const parsed = parseArgs(argv, [...GLOBAL_OPTIONS, ...(command.options ?? [])])
    const positionals = parsed.positionals.slice(path.length)
    checkPositionals(command, positionals)
    const now = clock(parsed.options.now, io.env)
    const json = parsed.options.json === true
    let record: TrustRecord | undefined
    let recordPath: string | null | undefined
    const ctx: Ctx = {
      io, path, positionals, options: parsed.options, now, json,
      recordPath: () => (recordPath === undefined ? (recordPath = discoverRecord(io.cwd, io.env, typeof parsed.options.record === 'string' ? parsed.options.record : undefined)) : recordPath),
      record: () => {
        if (record) return record
        const p = ctx.recordPath()
        if (!p) throw new CommandError(`no record found: run \`${PROGRAM} init\` in the directory that should hold it, or pass --record <file>`)
        return (record = loadRecord(p))
      },
      commit: (r, text, at) => {
        appendLog(r, [...path, ...positionals].join(' '), text, now)
        saveRecord(at ?? ctx.recordPath() ?? '', r)
      },
      emit: (data, text) => io.stdout(json ? JSON.stringify(data, null, 2) + '\n' : (Array.isArray(text) ? text.join('\n') : String(text)) + '\n'),
      warn: (text) => io.stderr(`${PROGRAM}: warning: ${text}\n`),
    }
    await command.run!(ctx)
    return 0
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`${PROGRAM}: ${e.message}\nUsage: ${usageOf(path, command)}\nTry \`${[PROGRAM, ...path].join(' ')} --help\`.\n`)
      return 2
    }
    if (e instanceof CommandError || e instanceof RecordError || e instanceof IdError) {
      io.stderr(`${PROGRAM}: ${e.message}\n`)
      return 1
    }
    throw e
  }
}

/** The non-option words of a line, for finding the command: a known value option takes the next token with it; `--` ends the options. */
function words(argv: readonly string[], known: readonly Option[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') return [...out, ...argv.slice(i + 1)]
    if (a === '-' || !a.startsWith('-')) {
      out.push(a)
      continue
    }
    if (a.includes('=')) continue
    const o = a.startsWith('--') ? known.find((k) => k.name === a.slice(2)) : known.find((k) => k.alias === a.slice(1))
    if (o && o.kind !== 'flag') i++
  }
  return out
}

/** Every option of every command, so the first pass can skip over a command's own `--opt value` while finding the command. */
function allOptions(root: Command): Option[] {
  const seen = new Map<string, Option>()
  for (const { command } of walk(root)) for (const o of command.options ?? []) if (!seen.has(o.name)) seen.set(o.name, o)
  return [...seen.values()]
}
