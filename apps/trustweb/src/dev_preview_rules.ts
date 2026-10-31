/** Dev-only preview overlay rules (pure): which boxes are disabled and what a toggle cascades to. Interface: previews-interface.txt. */
export { ciDiagnostics, diagnosticsFor, ghBin, MERGE_DONE, readyToGo } from '../dev_preview_rules.mjs'

export type Repo = 'vanilla' | 'private' | 'ops'

export interface PreviewFeature { key: string; repo?: Repo; ref?: string; branch: string; title: string; requires: string[]; checked: boolean; selector?: string; where?: string; context?: string; steps?: string[]; merged?: boolean; verdict?: Verdict; updated?: boolean }
export type Verdict = 'merge' | 'needs-work' | null

/** The rows the panel shows: a feature whose branch is on main already (merged, set by the CLI) is in the build but no longer a choice (Jakob 2026-10-15). */
export function visible(features: PreviewFeature[]): PreviewFeature[] {
  return features.filter((f) => !f.merged)
}

/** "needs <title>" for the first required feature that is unchecked, else null (the box is usable). */
export function needsHint(features: PreviewFeature[], key: string): string | null {
  const f = features.find((x) => x.key === key)
  const missing = f?.requires.map((r) => features.find((x) => x.key === r)).find((r) => r && !r.checked)
  return missing ? 'needs ' + missing.title : null
}

/** The features after toggling `key`: off also unchecks everything that requires it (transitively); on also checks its requires. */
export function toggled(features: PreviewFeature[], key: string, checked: boolean): PreviewFeature[] {
  const set = new Set([key])
  for (let grew = true; grew;) {
    grew = false
    for (const f of features) {
      const pulled = checked ? features.some((g) => set.has(g.key) && g.requires.includes(f.key)) : f.requires.some((r) => set.has(r))
      if (pulled && !set.has(f.key)) { set.add(f.key); grew = true }
    }
  }
  return features.map((f) => (set.has(f.key) ? { ...f, checked } : f))
}

/** Reviewed rows: key -> the feature ref last reviewed and how many changes came in since (0 = reviewed as it stands). */
export type Seen = Record<string, { ref: string; updates: number }>

/** The stored reviewed rows; an old string[] (keys only) becomes entries with an unknown ref (they show as Update: until tapped). Anything else: nothing reviewed. */
export function readSeen(raw: string | null): Seen {
  try {
    const v = JSON.parse(raw ?? '{}') as unknown
    if (Array.isArray(v)) return Object.fromEntries((v as string[]).map((k) => [k, { ref: '', updates: 0 }]))  // ref unknown: the next render counts one update, never italic by itself
    return v && typeof v === 'object' ? (v as Seen) : {}
  } catch { return {} }
}

/** A tap on a row: reviewed as it stands (a row with pending updates too), or, when already reviewed with none pending, unmarked. */
export function tapSeen(seen: Seen, key: string, ref: string): Seen {
  if (seen[key]?.updates === 0) return Object.fromEntries(Object.entries(seen).filter(([k]) => k !== key))
  return { ...seen, [key]: { ref, updates: 0 } }
}

/** How a row looks: italic = reviewed; a changed ref un-italics it and counts "Update: ", "Update2: " ... until the next tap. `next` is what to store. */
export function seenState(seen: Seen, key: string, ref: string): { italic: boolean; prefix: string; next: Seen } {
  const e = seen[key]
  if (!e) return { italic: false, prefix: '', next: seen }
  const updates = e.ref === ref ? e.updates : e.updates + 1
  return { italic: updates === 0, prefix: updates === 0 ? '' : `Update${updates > 1 ? updates : ''}: `, next: updates === e.updates ? seen : { ...seen, [key]: { ref, updates } } }
}

export const REPO_LABEL: Record<Repo, string> = { vanilla: 'trustweb', private: 'trustweb-private', ops: 'trustweb-ops' }

/** The tree split by repo (order vanilla, private, ops; empty ones left out). A child whose parent sits in another repo starts at the top of its own. */
export function sections(nodes: TreeNode[]): { repo: Repo; nodes: TreeNode[] }[] {
  const roots: Record<Repo, TreeNode[]> = { vanilla: [], private: [], ops: [] }
  const walk = (n: TreeNode, parent: TreeNode | null): void => {
    const repo = n.feature.repo ?? 'vanilla'
    const home = parent !== null && (parent.feature.repo ?? 'vanilla') === repo
    const copy: TreeNode = { feature: n.feature, depth: home ? parent.depth + 1 : 0, children: [] }
    ;(home ? parent.children : roots[repo]).push(copy)
    for (const c of n.children) walk(c, copy)
  }
  for (const n of nodes) walk(n, null)
  return (Object.keys(roots) as Repo[]).filter((r) => roots[r].length).map((repo) => ({ repo, nodes: roots[repo] }))
}

/** Keys of the rows related to `key`: a requires link either way, the same context, the same where, or the same selector root (its first compound). */
export function relatedRows(rows: PreviewFeature[], key: string): string[] {
  const me = rows.find((r) => r.key === key)
  if (!me) return []
  const root = (r: PreviewFeature): string | undefined => r.selector?.trim().split(/[\s>+~]+/)[0] || undefined
  const same = (a?: string, b?: string): boolean => a !== undefined && a === b
  return rows.filter((r) => r.key !== key && (r.requires.includes(key) || me.requires.includes(r.key) || same(r.context, me.context) || same(r.where, me.where) || same(root(r), root(me)))).map((r) => r.key)
}

interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number }
/** Where the yellow step card goes: over the phone frame's bottom edge (top when the target sits under it); without a frame (responsive layouts) next to the target, below or above it, inside the viewport. */
export function stepCardPlace(phone: Box | null, target: Box | undefined, cardH: number, vw: number, vh: number): { left: number; width: number; top?: number; bottom?: number } {
  if (phone) {
    const low = Math.min(phone.bottom, vh)
    const high = target !== undefined && target.bottom > low - cardH - 16
    return { left: phone.left + 8, width: phone.width - 16, ...(high ? { top: Math.max(phone.top, 0) + 8 } : { bottom: vh - low + 8 }) }
  }
  const width = Math.min(320, vw - 16)
  const left = Math.min(Math.max(target?.left ?? 8, 8), vw - width - 8)
  if (!target) return { left, width, bottom: 8 }
  const below = target.bottom + 8
  const top = below + cardH <= vh - 8 ? below : Math.max(8, target.top - 8 - cardH)
  return { left, width, top }
}

/** The highlighted row after a tap on `key`: the same row again switches it off. */
export function tapped(lit: string | null, key: string): string | null {
  return lit === key ? null : key
}

/** Wording of the confirm box: one differing box names it, several count them; with a PR, it says the PR keeps its set until updated. */
export function confirmText(title: string, checked: boolean, changes = 1, pr?: number | null): string {
  const base = changes > 1 ? `Re-assemble preview with these ${changes} changes? The page reloads.` : `Re-assemble preview ${checked ? 'with' : 'without'} ${title}? The page reloads.`
  return typeof pr === 'number' ? `${base} PR #${pr} keeps its current set until you update it.` : base
}

/** "Approve personal view": push, open or update the PR, share on dev. A registry preview runs it through the CLI (`preview <id> pr`: PR title, registry record), a plain worktree through its own route; the CLI needs a checked feature that is not on main yet. */
export function personalApprove(registry: boolean, features: PreviewFeature[]): { url: string; ok: boolean } {
  return registry ? { url: '/__tw/preview/pr', ok: features.some((f) => f.checked && !f.merged) } : { url: '/__tw/approve', ok: true }
}

/** True once the PR's branch is contained in main (set by the CLI): the PR can only be left behind, never updated. */
export function prMerged(p: { pr: { merged?: boolean } | null }): boolean {
  return p.pr?.merged === true
}

export interface Tested { sha: string; at: string; ok: boolean | null; running: boolean; log?: string; tail?: string }
export type PrGate = 'untested' | 'running' | 'failed' | 'passed'

/** What the local checks say about the assembled set: only a run on the same sha counts. */
export function prGate(p: { assembled?: { sha: string } | null; tested?: Tested | null }): PrGate {
  const t = p.tested
  if (!t || !p.assembled || t.sha !== p.assembled.sha) return 'untested'
  if (t.running) return 'running'
  return t.ok === true ? 'passed' : t.ok === false ? 'failed' : 'untested'
}

export function testLine(gate: PrGate, tested?: Tested | null): string {
  switch (gate) {
    case 'untested': return ''
    case 'running': return 'Running the checks (about 40 s)...'
    case 'failed': return 'Checks failed: see below'
    case 'passed': return `Checks passed for ${tested?.sha ?? '?'}`
  }
}

/** The verdict after a click on a pill: a second click on the active one clears it. */
export const verdictAfter = (current: Verdict | undefined, clicked: 'merge' | 'needs-work'): Verdict => (current === clicked ? null : clicked)

/** What a row's pills show: approved = verdict merge AND box checked, needs work = verdict needs-work AND box unchecked (the box is what the preview shows). */
export const shownVerdict = (f: PreviewFeature): Verdict => (f.verdict === 'merge' && f.checked ? 'merge' : f.verdict === 'needs-work' && !f.checked ? 'needs-work' : null)

/** A press on a pill: the verdict to store (the registry checks/unchecks the box and cascades over requires/dependants itself; nothing assembles). Pressing the shown pill again clears it. */
export const pillPress = (features: PreviewFeature[], key: string, v: 'merge' | 'needs-work'): Verdict => verdictAfter(shownVerdict(features.find((x) => x.key === key)!), v)

/** Select all / none as the exact boxes to POST: every available (not merged) row on = approved, or off; merged rows keep their box. */
export const selectAll = (features: PreviewFeature[], on: boolean): Record<string, boolean> => Object.fromEntries(features.map((f) => [f.key, f.merged ? f.checked : on]))

export const allApproved = (features: PreviewFeature[]): boolean => visible(features).every((f) => shownVerdict(f) === 'merge')

/** In the preview and in the merge only what is checked AND approved (verdict merge). Mirror of approvedKeys in the ops repo. */
export const approvedKeys = (features: PreviewFeature[]): string[] => visible(features).filter((f) => f.checked && f.verdict === 'merge').map((f) => f.key)

/** Changes not yet applied: the approved set against the set the worktree was assembled with (assembled.set; an older registry: its checked rows). */
export function pendingCount(p: { features: PreviewFeature[]; assembled?: { set?: string[] } | null }): number {
  const now = approvedKeys(p.features), was = p.assembled?.set ?? visible(p.features).filter((f) => f.checked).map((f) => f.key)
  return now.filter((k) => !was.includes(k)).length + was.filter((k) => !now.includes(k)).length
}
export const pendingText = (n: number): string => `${n} change${n === 1 ? '' : 's'} not applied`

/** No manual reload (Jakob 2026-10-24): the panel starts `apply` itself whenever the registry says pending and nothing stands in the way: no apply going
 *  (a stuck one waits for the owner's Retry), no local test run (it reads the assembled worktree). */
export const autoApply = (p: { pending?: boolean; tested?: Tested | null }, applying: { stuck: boolean } | null): boolean => !!p.pending && applying === null && !p.tested?.running

/** The assembled sha moved away from the one this page knows (a CLI apply, the Approve press, another tab): the page reloads itself. Unknown = not yet compared. */
export const assemblyMoved = (known: string | null, p: { assembled?: { sha: string } | null }): boolean => known !== null && !!p.assembled && p.assembled.sha !== known

/** The sha this tab last reloaded for, and when. */
export interface ReloadMark { sha: string; at: number }
export const RELOAD_GAP_MS = 10_000

/** The page reloads for a new assembled sha only: after the first answer, never while the assembly carries an error, once per sha, and 10 s apart: the page shows content or "Assembling…", never a flicker between them. */
export function shouldReload(served: string | null, assembled: { sha: string; error: string | null } | null | undefined, last: ReloadMark | null, now: number): boolean {
  if (served === null || !assembled || assembled.error || assembled.sha === served) return false
  return !last || (last.sha !== assembled.sha && now - last.at >= RELOAD_GAP_MS)
}

/** A per-preview, per-tab value in sessionStorage (twp-<what>-<id>); unavailable or broken storage reads as `none`. */
function tabValue<T>(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, none: T, ok: (v: unknown) => v is T): { get(): T; set(v: T): void } {
  return {
    get: (): T => { try { const v: unknown = JSON.parse(storage.getItem(key) ?? 'null'); return ok(v) ? v : none } catch { return none } },
    set: (v: T): void => { try { storage.setItem(key, JSON.stringify(v)) } catch { /* not remembered */ } },
  }
}
export const reloadMark = (storage: Pick<Storage, 'getItem' | 'setItem'>, id: string) =>
  tabValue<ReloadMark | null>(storage, 'twp-reload-' + id, null, (v): v is ReloadMark => typeof v === 'object' && v !== null && typeof (v as ReloadMark).sha === 'string' && typeof (v as ReloadMark).at === 'number')
/** The panel's scroll offset: kept across the self-reload, a manual reload and an apply round trip. */
export const scrollStore = (storage: Pick<Storage, 'getItem' | 'setItem'>, id: string) =>
  tabValue<number>(storage, 'twp-scroll-' + id, 0, (v): v is number => typeof v === 'number' && v >= 0)

/** What moves while an apply runs; unchanged for 90 s = stuck. */
export const applyStamp = (p: { pending?: boolean; assembled?: { at: string; set?: string[] } | null; features: PreviewFeature[] }): string => JSON.stringify([p.pending, p.assembled?.at, p.assembled?.set, approvedKeys(p.features)])
export const applyStuck = (since: number, now: number): boolean => now - since > 90e3

/** The merge box's head: the released step ends the flow for good, so DONE (green, class ok); every other step is still IN PROGRESS. */
export const mergeHead = (step: string): { text: string; ok: boolean } => step === 'released' ? { text: 'DONE', ok: true } : { text: 'IN PROGRESS', ok: false }

/** The left panel greys out and stops reacting once Declare done has been pressed and the run did not end in failure or cancel. */
export const panelDone = (step: string): boolean => !['', 'none', 'cancelled', 'failed', 'checks-failed'].includes(step)

export const APPROVE_HINT = 'Touch ID, then the tests run here; green = pushed, merged and released. Red = nothing leaves this Mac.'

/** A name in a conflict text: the file, the first feature (or branch) and the second one (feature or main), each drawn in its own colour (Jakob 2026-10-28). */
export interface ConflictName { text: string; kind: 'file' | 'a' | 'b' }
/** Splits the ops status "conflict in <file> between <a> and <b>" and raw git output ("<branch>: CONFLICT …", "Merge conflict in <file>") into plain text and names. */
export function conflictParts(text: string): Array<string | ConflictName> {
  const names: Array<{ at: number } & ConflictName> = []
  const add = (m: RegExpExecArray, kinds: ConflictName['kind'][]): void => {
    let from = m.index
    kinds.forEach((kind, i) => { const t = m[i + 1]!; const at = text.indexOf(t, from); names.push({ at, text: t, kind }); from = at + t.length })
  }
  for (const m of text.matchAll(/conflict in (\S+) between (\S+) and (\S+)/g)) add(m, ['file', 'a', 'b'])
  for (const m of text.matchAll(/(?<=^|\s)(\S+): CONFLICT/gm)) add(m, ['a'])
  for (const m of text.matchAll(/Merge conflict in (\S+)/g)) add(m, ['file'])
  const out: Array<string | ConflictName> = []
  let pos = 0
  for (const n of names.sort((x, y) => x.at - y.at)) {
    if (n.at < pos) continue
    if (n.at > pos) out.push(text.slice(pos, n.at))
    out.push({ text: n.text, kind: n.kind }); pos = n.at + n.text.length
  }
  if (pos < text.length) out.push(text.slice(pos))
  return out
}

/** Mirror of approveGate in the ops repo (bin/preview_lib.mjs): Declare done opens with no test run going, >= 1 approved row and no conflict; pending changes never close it (the press applies them first), the tests run after the press. */
export function approveGate(p: { assembled?: { sha: string; error: string | null } | null; tested?: Tested | null; features: PreviewFeature[]; pending?: boolean }): { ok: boolean; hint: string } {
  const hint = p.tested?.running ? 'Tests are running'
    : p.assembled?.error && !p.pending ? `Fix the conflict first: ${p.assembled.error.split('\n')[0]}`
    : approvedKeys(p.features).length === 0 ? 'Declare at least one feature done' : ''
  return { ok: hint === '', hint }
}

export interface TreeNode { feature: PreviewFeature; depth: number; children: TreeNode[] }

/** Features nested by `requires`: a feature sits under the first required feature present in the list, else at the root. List order is kept. */
export function tree(features: PreviewFeature[]): TreeNode[] {
  const nodes = new Map(features.map((f) => [f.key, { feature: f, depth: 0, children: [] as TreeNode[] }]))
  const roots: TreeNode[] = []
  for (const n of nodes.values()) (n.feature.requires.map((r) => nodes.get(r)).find(Boolean)?.children ?? roots).push(n)
  const setDepth = (list: TreeNode[], depth: number): void => { for (const n of list) { n.depth = depth; setDepth(n.children, depth + 1) } }
  setDepth(roots, 0)
  return roots
}

/** Keys that flip together with `key` when it is toggled (the cascade), without `key` itself. */
export function cascaded(features: PreviewFeature[], key: string, checked: boolean): string[] {
  const after = toggled(features, key, checked)
  return features.filter((f, i) => f.key !== key && f.checked !== after[i].checked).map((f) => f.key)
}

/** Number of features below `node` (what "(n hidden)" counts). */
export function descendants(node: TreeNode): number {
  return node.children.reduce((n, c) => n + 1 + descendants(c), 0)
}

/** The exact state of every box, as POSTed to the server: key -> checked. */
export function setMap(features: PreviewFeature[]): Record<string, boolean> {
  return Object.fromEntries(features.map((f) => [f.key, f.checked]))
}

/** The panel's per-tab flags in a per-tab store (sessionStorage): collapsed to a pill, hidden by its x. A new tab or a fresh load starts expanded and shown. Unavailable storage = not remembered. */
export function collapseStore(storage: Pick<Storage, 'getItem' | 'setItem'>): { get(): boolean; set(on: boolean): void; hidden(): boolean; hide(): void } {
  const flag = (key: string) => ({
    get: (): boolean => { try { return storage.getItem(key) === '1' } catch { return false } },
    set: (on: boolean): void => { try { storage.setItem(key, on ? '1' : '') } catch { /* not remembered */ } },
  })
  const [fold, gone] = [flag('twp-collapsed'), flag('twp-hidden')]
  return { get: fold.get, set: fold.set, hidden: gone.get, hide: () => { gone.set(true) } }
}

/** True while the personal-view PR flow works: its /__tw/status step is neither none, ready nor failed. */
export function prRunning(step: string): boolean {
  return !['none', 'ready', 'failed'].includes(step)
}

/** What a row tap does: `visible` = the selector matches on this page now. Point (red ring), show the way (the steps overlay on the phone), or nothing to offer. */
export function rowPlan(visible: boolean, steps: string[] | undefined): 'point' | 'steps' | 'none' {
  return visible ? 'point' : steps?.length ? 'steps' : 'none'
}

/** A step is "text" or "text @ <css selector>": the selector (null without one) is the element the red ring sits on while the step shows. */
export function parseStep(s: string): { text: string; selector: string | null } {
  const i = s.lastIndexOf(' @ ')
  return i < 0 ? { text: s, selector: null } : { text: s.slice(0, i).trim(), selector: s.slice(i + 3).trim() || null }
}

/** The PR flow progress line: never a raw step name. `text` is the status file's own wording (used for ci and failed). */
export function stepText(step: string, text: string | undefined, short: string, pr?: number | null): string {
  switch (step) {
    case 'none': return 'starting...'
    case 'start': return 'tagging and pushing'
    case 'pushed': return `pushed task/${short}`
    case 'pr': return `PR #${pr ?? '?'} opened, CI running`
    case 'ready': return 'dev ready'
    default: return text || 'starting...'
  }
}

/** "CI usually takes about N min" and, while the estimate has not run out, how long is left (counted from the flow's `started`). */
export function ciLine(etaSeconds: number, started: string, now: number): string {
  const left = Math.round(etaSeconds - (now - Date.parse(started)) / 1000)
  const usual = `CI usually takes about ${Math.max(1, Math.round(etaSeconds / 60))} min`
  return left > 0 ? `${usual} · about ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : `${usual} · should be done any moment`
}

/** Where "dev" opens: the slot's root with this page's place (path, query, hash) carried over. */
export function devUrl(slot: string, loc: Pick<Location, 'pathname' | 'search' | 'hash'>): string {
  return slot.replace(/\/$/, '') + loc.pathname + loc.search + loc.hash
}

/** "dev2" for https://dev2.trustweb.one/ */
export const devLabel = (slot: string): string => new URL(slot).hostname.split('.')[0]

/** The value a step asks to type: the text after "paste" or "type" (quotes dropped), else null. */
export function typedValue(text: string): string | null {
  const m = /\b(?:paste|type)\s+(.+)$/i.exec(text)
  return m ? m[1].trim().replace(/^["'“‘]|["'”’]$/g, '') : null
}
