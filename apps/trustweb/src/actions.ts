// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 ai-edit-chat: the action registry. Everything a person can do by tapping (set a ring, tag someone, open a view, switch a
 * setting) is one typed command with a human label, applied and undone the same way whether the person or the assistant asks for it.
 * The app's own commands are in app_actions.ts; the assistant (ext/assistant/) proposes them as JSON and runs them only through here.
 * Pure, no DOM.
 */
export type Undo = () => void
export type By = 'user' | 'assistant'

export interface ActionSpec<A = unknown> {
  type: string
  /** One line for the model's catalogue: what it does. */
  doc: string
  /** The args as the model writes them, e.g. '{"person": id or name, "ring": "close"|"friend"}'. */
  shape: string
  /** Typed args; throws an Error with a plain message on anything else. */
  parse(args: Record<string, unknown>): A
  label(a: A): string
  /** Applies it; returns how to take it back, or nothing when it cannot be taken back. Throws when it cannot be done. */
  apply(a: A): Undo | void
  /** false: never applied without an explicit approval (Apply as I watch leaves it waiting). Default true. */
  auto?: boolean
  /** false: cannot be taken back (a tap on the page). Default true. */
  undoable?: boolean
}

/** A checked action, ready to show as a card and to run. */
export interface Valid { type: string; args: unknown; label: string; auto: boolean; undoable: boolean; why?: string }
export type Checked = { ok: true; action: Valid } | { ok: false; error: string }
export interface Applied { label: string; undo: Undo }

const RECENT = 20
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function createActions() {
  const specs = new Map<string, ActionSpec<never>>()
  const listeners = new Set<(a: Valid, by: By) => void>()
  const watchers = new Set<() => void>()
  const changed = (): void => { for (const fn of [...watchers]) fn() }
  const recent: { label: string; by: By }[] = []

  function check(raw: unknown): Checked {
    if (!isRec(raw) || typeof raw.type !== 'string') return { ok: false, error: 'an action needs a "type"' }
    const spec = specs.get(raw.type)
    if (!spec) return { ok: false, error: `unknown action: ${raw.type}` }
    try {
      const args = spec.parse((isRec(raw.args) ? raw.args : {}) as Record<string, unknown>)
      const why = typeof raw.why === 'string' && raw.why.trim() ? raw.why.trim().slice(0, 300) : undefined
      return { ok: true, action: { type: spec.type, args, label: spec.label(args as never), auto: spec.auto !== false, undoable: spec.undoable !== false, ...(why ? { why } : {}) } }
    } catch (e) { return { ok: false, error: `${spec.type}: ${(e as Error).message}` } }
  }

  function run(action: Valid, by: By = 'user'): Applied {
    const spec = specs.get(action.type)
    if (!spec) throw new Error(`unknown action: ${action.type}`)
    const back = spec.apply(action.args as never)
    recent.push({ label: action.label, by })
    if (recent.length > RECENT) recent.splice(0, recent.length - RECENT)
    for (const fn of [...listeners]) fn(action, by)
    changed()
    let undone = false
    return { label: action.label, undo: () => { if (undone || !back) return; undone = true; back(); changed() } }
  }

  return {
    define<A>(spec: ActionSpec<A>): void {
      if (specs.has(spec.type)) throw new Error(`action already defined: ${spec.type}`)
      specs.set(spec.type, spec as unknown as ActionSpec<never>)
    },
    specs: (): ActionSpec[] => [...specs.values()] as ActionSpec[],
    check,
    run,
    /** check + run in one; throws on an invalid action. The UI's own buttons call this. */
    do(type: string, args: Record<string, unknown>, by: By = 'user'): Applied {
      const c = check({ type, args })
      if (!c.ok) throw new Error(c.error)
      return run(c.action, by)
    },
    onRun(fn: (a: Valid, by: By) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } },
    /** After every run and every undo, whoever did it: an open page (Curate) redraws. */
    onChange(fn: () => void): () => void { watchers.add(fn); return () => { watchers.delete(fn) } },
    /** The last 20 steps, oldest first, with who did them (the assistant's context: what the person just did by tapping). */
    recent: (): { label: string; by: By }[] => [...recent],
  }
}
export type Actions = ReturnType<typeof createActions>

// ---- arg helpers: each returns the value or throws a plain message ----

export function str(args: Record<string, unknown>, key: string, max = 200, optional = false): string | undefined {
  const v = args[key]
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    if (optional) return undefined
    throw new Error(`${key} is required`)
  }
  if (typeof v !== 'string') throw new Error(`${key} must be text`)
  if (v.trim().length > max) throw new Error(`${key} is too long`)
  return v.trim()
}

export function oneOf<T extends string>(args: Record<string, unknown>, key: string, list: readonly T[]): T {
  const v = args[key]
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new Error(`${key} must be one of ${list.join(', ')}`)
  return v as T
}

export function bool(args: Record<string, unknown>, key: string): boolean {
  const v = args[key]
  if (typeof v !== 'boolean') throw new Error(`${key} must be true or false`)
  return v
}
