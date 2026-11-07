/** Dev-only preview overlay rules (pure): which boxes are disabled and what a toggle cascades to. Interface: previews-interface.txt. */
export { ciDiagnostics, diagnosticsFor, ghBin, MERGE_DONE, readyToGo } from '../dev_preview_rules.mjs'
import { MERGE_DONE } from '../dev_preview_rules.mjs'

export type Repo = 'vanilla' | 'private' | 'ops'

export interface PreviewFeature { key: string; repo?: Repo; ref?: string; branch: string; title: string; requires: string[]; checked: boolean; selector?: string; where?: string; context?: string; steps?: string[]; flag?: string; merged?: boolean; verdict?: Verdict; updated?: boolean; approvedRef?: string; changedFrom?: string; walkOk?: boolean }
export type Verdict = 'merge' | 'needs-work' | null
/** The registry's compat record (written by preview_compat.mjs): the base and row refs it was computed for, each row alone, every pair and the full set merged in a scratch tree. */
export interface Compat { at?: string; state: 'running' | 'ok' | 'conflict'; baseSha?: string; refs?: Record<string, string | null>; singles?: Record<string, string>; pairs?: Record<string, string>; full?: string }

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

/** A dragged card's top-left, kept inside the viewport. */
export function clampCard(left: number, top: number, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  return { left: Math.max(0, Math.min(left, vw - w)), top: Math.max(0, Math.min(top, vh - h)) }
}

/** Where the owner dragged the step card (localStorage: per origin, kept across reloads); clear() = back to the bottom. Unavailable storage = not remembered. */
export function stepCardPosStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): { get(): { left: number; top: number } | null; set(p: { left: number; top: number }): void; clear(): void } {
  const key = 'twp-step-pos'
  return {
    get: () => {
      try {
        const p = JSON.parse(storage.getItem(key) ?? 'null') as { left?: unknown; top?: unknown } | null
        return p && typeof p.left === 'number' && typeof p.top === 'number' ? { left: p.left, top: p.top } : null
      } catch { return null }
    },
    set: (p) => { try { storage.setItem(key, JSON.stringify(p)) } catch { /* not remembered */ } },
    clear: () => { try { storage.removeItem(key) } catch { /* not remembered */ } },
  }
}

/** Remembers that a "?" press (not the owner) collapsed the panel: press(wasCollapsed) says whether to collapse; end() says whether to expand again; owner() = the owner changed the fold meanwhile. */
export function stepFold(): { press(wasCollapsed: boolean): boolean; end(): boolean; owner(): void } {
  let ours = false
  return {
    press: (wasCollapsed) => { ours = !wasCollapsed; return ours },
    end: () => { const was = ours; ours = false; return was },
    owner: () => { ours = false },
  }
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

export const AS_ALWAYS = 'as always'
/** The approve-result text of a merged PR: "PR #n shipped" only when that PR was merged in this preview's run (made at/after the preview, or its merge recorded without a date); a PR carried over from before says "as always" (nothing changed for the row). A `next` preview stays the way on. */
export function mergedLabel(p: { created: string; pr: { number: number; at?: string; merged?: boolean; head?: string; mergeCommit?: string } | null; next?: { id: string; port: number } }): { next: { id: string; port: number } } | { text: string } {
  if (p.next) return { next: p.next }
  const pr = p.pr
  const own = !!pr && pr.merged === true && (pr.at ? pr.at >= p.created : !!(pr.mergeCommit || pr.head))
  return { text: own ? `PR #${pr!.number} shipped` : AS_ALWAYS }
}

/** The rows behind the amber "needs work" reminder, one clickable title each. */
export const remindItems = (shown: PreviewFeature[]): { key: string; title: string }[] => shown.map((f) => ({ key: f.key, title: f.title }))

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

/** Select all / none as the exact boxes to POST: every available (not merged) row on = loaded into the preview, or off (approval is the pill verdict, not the box); merged rows keep their box. */
export const selectAll = (features: PreviewFeature[], on: boolean): Record<string, boolean> => Object.fromEntries(features.map((f) => [f.key, f.merged ? f.checked : on]))

/** The panel's write before the server answers (wave 28: Approve is instant): the verdict on `keys`; needs work also unloads the row and its dependants, as the registry does. */
export function applyVerdicts(features: PreviewFeature[], keys: string[], v: Verdict): PreviewFeature[] {
  const base = v === 'needs-work' ? keys.reduce((fs, k) => toggled(fs, k, false), features) : features
  return base.map((f) => (keys.includes(f.key) ? { ...f, verdict: v } : f))
}

/** The panel's write of a box before the server answers: the cascade of `toggled`, and a row that is no longer loaded loses a merge verdict (as the registry settles it). */
export const withBox = (features: PreviewFeature[], key: string, checked: boolean): PreviewFeature[] =>
  toggled(features, key, checked).map((f) => (!f.checked && f.verdict === 'merge' ? { ...f, verdict: null } : f))

/** The features with `key` loaded (and what it requires); a press on approve or Walk on an unticked row loads it first, so no "tick the box first". */
export const ensureLoaded = (features: PreviewFeature[], key: string): PreviewFeature[] => (features.find((f) => f.key === key)?.checked ? features : withBox(features, key, true))

/** The rows whose title, key, where or steps contain `query` (case-insensitive, trimmed); an empty query keeps every row. */
export function searchRows(features: PreviewFeature[], query: string): PreviewFeature[] {
  const q = query.trim().toLowerCase()
  return q ? features.filter((f) => [f.title, f.key, f.where, ...(f.steps ?? [])].some((t) => t?.toLowerCase().includes(q))) : features
}

/** Mirror of compatFresh in the ops repo: the check was computed for this base and these loaded rows' refs. */
export const compatFresh = (c: Compat | undefined, baseSha: string | undefined, loaded: PreviewFeature[]): boolean =>
  !!c && c.baseSha === baseSha && Object.keys(c.refs ?? {}).length === loaded.length && loaded.every((f) => f.key in (c.refs ?? {}) && c.refs![f.key] === (f.ref ?? null))

const loadedRows = (features: PreviewFeature[]): PreviewFeature[] => features.filter((f) => f.checked && !f.merged)
const conflictsOf = (c: Compat): string[] => [...Object.entries({ ...c.singles, ...c.pairs }), ['full', c.full ?? 'ok']].filter(([, v]) => v !== 'ok').map(([k, v]) => `${k}: ${v.replace(/^conflict:?\s*/, '')}`)

/** The compat line under the header: text, whether it is clean, and the conflicts ("a+b: file") for the folded list. */
export function compatLine(c: Compat | undefined, fresh = true): { text: string; ok: boolean; conflicts: string[] } | null {
  if (!c) return null
  if (c.state === 'running') return { text: 'compat: checking…', ok: false, conflicts: [] }
  if (!fresh) return { text: 'compat: out of date', ok: false, conflicts: [] }
  const conflicts = conflictsOf(c)
  if (c.state === 'ok' && !conflicts.length) return { text: `compat ✓ ${Object.keys(c.pairs ?? {}).length} pairs, full set`, ok: true, conflicts }
  return { text: `compat ✗ ${conflicts[0] ?? 'conflict'}${conflicts.length > 1 ? ` (+${conflicts.length - 1})` : ''}`, ok: false, conflicts }
}

/** Mirror of compatHint in the ops repo: why Approve wave stays closed on the compat check, or ''. */
export function compatHint(c: Compat | undefined, baseSha: string | undefined, loaded: PreviewFeature[]): string {
  if (!c) return 'compat check not run yet'
  if (!compatFresh(c, baseSha, loaded)) return c.state === 'running' ? 'compat check running' : 'compat check out of date'
  if (c.state === 'running') return 'compat check running'
  return c.state === 'ok' ? '' : `compat: fix ${conflictsOf(c)[0]?.replace(/: (.*)$/, ' ($1)') ?? 'full'}`
}

/** A gate hint split for the Approve box: the short head and the long detail kept under a folded "details" (the conflict text is never a paragraph). */
export function hintParts(hint: string): { head: string; detail: string } {
  const m = /^(Fix the conflict first):\s*([\s\S]*)$/.exec(hint)
  return m ? { head: m[1], detail: m[2] } : { head: hint, detail: '' }
}

/** A row and the loaded rows below it (their `requires` chain). Only for a whole subtree (e.g. unloading a parent); one row's approve is just [key]. */
export function subtreeKeys(features: PreviewFeature[], key: string): string[] {
  const out: string[] = []
  const walk = (n: TreeNode): void => { if (n.feature.checked) out.push(n.feature.key); n.children.forEach(walk) }
  const find = (ns: TreeNode[]): TreeNode | undefined => { for (const n of ns) { const hit = n.feature.key === key ? n : find(n.children); if (hit) return hit } return undefined }
  const top = find(tree(visible(features)))
  if (top) walk(top)
  return out
}

/** "Approve wave": light green (the bulk nudge) while a loaded row was not approved on its own press (`individual` = the keys the owner pressed); dark green when every one was.
 *  `implicit` = "approved in bulk" at most; it is NOT the unapproved count (that is by verdict: `unapproved`, wave 33), so cleared storage or another browser never shows rows as unapproved. */
export function waveState(features: PreviewFeature[], individual: string[]): { warn: boolean; light: boolean; implicit: string[] } {
  const implicit = visible(features).filter((f) => f.checked && !individual.includes(f.key)).map((f) => f.key)
  return { warn: implicit.length > 0, light: implicit.length > 0, implicit }
}

/** The folded keys left after the rows in `keys` must be seen: their folded parents (the `requires` chain) open. */
export function expandFor(features: PreviewFeature[], keys: string[], foldedKeys: string[]): string[] {
  const open = new Set<string>()
  const walk = (n: TreeNode, parents: string[]): void => {
    if (keys.includes(n.feature.key)) parents.forEach((k) => open.add(k))
    n.children.forEach((c) => walk(c, [...parents, n.feature.key]))
  }
  tree(visible(features)).forEach((n) => walk(n, []))
  return foldedKeys.filter((k) => !open.has(k))
}

/** Walk shows on every row with steps (null = none); it is enabled only on a stored positive verdict (a one-time check by a Haiku subagent or pc24, kept in the registry as walkOk), else greyed with a title. */
export const walkShown = (f: { walkOk?: boolean; steps?: unknown[] }): { disabled: boolean; title: string } | null =>
  !f.steps?.length ? null : f.walkOk === true ? { disabled: false, title: '' } : { disabled: true, title: 'Walk not verified for this row yet' }

/** What the note button copies: the preview, the row, its title, branch and ref, to paste into the pi session. */
export const noteText = (id: string, f: PreviewFeature): string => `${id} | ${f.key} | ${f.title} | ${f.branch}@${f.ref ?? '?'}`

/** What the needs-work pill copies, like the note button: time, preview, row key, title, verdict. */
export const needsWorkNote = (iso: string, id: string, f: { key: string; title: string }): string => `${iso} | ${id} | ${f.key} | ${f.title} | needs work`

/** How an apply ended, read from the registry: a newer assembly (moved), nothing left to assemble 5 s after the press (idle), else running. */
export function applyOutcome(q: { pending?: boolean; assembled?: { at: string } | null }, start: number, now: number): 'moved' | 'idle' | 'running' {
  if (q.pending) return 'running'
  if (q.assembled && Date.parse(q.assembled.at) > start) return 'moved'
  return now - start > 5000 ? 'idle' : 'running'
}

/** Boxes are picked in a row: the reassembly starts this long after the last one. */
export const APPLY_DELAY_MS = 1300
export function debounce(fn: () => void, ms: number): (() => void) & { waiting(): boolean } {
  let t: ReturnType<typeof setTimeout> | undefined
  const d = (): void => { clearTimeout(t); t = setTimeout(() => { t = undefined; fn() }, ms) }
  return Object.assign(d, { waiting: (): boolean => t !== undefined })
}

// unused since wave27 review, archive candidate
export const allApproved = (features: PreviewFeature[]): boolean => visible(features).every((f) => shownVerdict(f) === 'merge')
export const allLoaded = (features: PreviewFeature[]): boolean => visible(features).every((f) => f.checked)

/** Two states per row (Jakob 2026-10-31): loaded = the box is checked = in the preview assembly; approved = loaded + verdict merge = reviewed and liked. Mirror of loadedKeys / approvedKeys in the ops repo. */
export const loadedKeys = (features: PreviewFeature[]): string[] => visible(features).filter((f) => f.checked).map((f) => f.key)
export const approvedKeys = (features: PreviewFeature[]): string[] => visible(features).filter((f) => f.checked && f.verdict === 'merge').map((f) => f.key)

/** Loaded rows still waiting for the approval, and the panel's reminder line for them (empty when none waits). Mirror of unapproved / reminderText in the ops repo. */
export const unapproved = (features: PreviewFeature[]): PreviewFeature[] => visible(features).filter((f) => f.checked && f.verdict !== 'merge')
/** An approved row whose ref moved after the approval (the registry keeps verdict merge + approvedRef and marks it updated): the two short shas, else null. */
export const changedSinceApproval = (f: PreviewFeature): { from: string; to: string } | null =>
  f.verdict === 'merge' && f.updated && f.approvedRef && f.ref && f.approvedRef !== f.ref ? { from: f.approvedRef.slice(0, 7), to: f.ref.slice(0, 7) } : null
/** How many visible loaded rows carry changes the owner has not approved yet. */
export const changesToApprove = (features: PreviewFeature[]): number => visible(features).filter((f) => f.checked && changedSinceApproval(f)).length
export function reminderText(features: PreviewFeature[]): string {
  const open = unapproved(features)
  return open.length ? `${open.length} loaded, not yet approved: ${open.map((f) => f.title).join(', ')}` : ''
}

/** Changes not yet applied: the loaded set against the set the worktree was assembled with (assembled.set; an older registry: its checked rows). A verdict alone moves nothing. */
export function pendingCount(p: { features: PreviewFeature[]; assembled?: { set?: string[] } | null }): number {
  const now = loadedKeys(p.features), was = p.assembled?.set ?? loadedKeys(p.features)
  return now.filter((k) => !was.includes(k)).length + was.filter((k) => !now.includes(k)).length
}
export const pendingText = (n: number): string => `${n} change${n === 1 ? '' : 's'} not applied`

/** No manual reload (Jakob 2026-10-24): the panel starts `apply` itself whenever the registry says pending and nothing stands in the way: no apply going
 *  (a stuck one waits for the owner's Retry). A local test run no longer blocks it (wave 32: an uncheck during a run was never assembled).
 *  `held` (wave 33): an approve on an unticked row loaded it without assembling: the page stays as it is until a box or "Assemble now" asks. */
export const autoApply = (p: { pending?: boolean; tested?: Tested | null }, applying: { stuck: boolean } | null, held = false): boolean => !!p.pending && applying === null && !held

/** When the debounced apply fires: 'now' = start it; 'later' = an apply or a write is still going, ask again; 'no' = nothing to do or a stuck apply (the owner's Retry).
 *  `wanted` = the owner unchecked or pressed needs work, which assembles whatever the registry's pending flag says at that moment. */
export function applyDue(p: { pending?: boolean }, applying: { stuck: boolean } | null, wanted: boolean, inflight: number): 'now' | 'later' | 'no' {
  if (!p.pending && !wanted) return 'no'
  if (applying) return applying.stuck ? 'no' : 'later'
  return inflight > 0 ? 'later' : 'now'
}

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

const isKeys = (v: unknown): v is string[] => Array.isArray(v) && v.every((k) => typeof k === 'string')
/** Wave 28: the rows the owner approved with their own press (localStorage: survives tabs), the folded rows of the tree and whether the load list is open (sessionStorage), per preview. */
export const individualStore = (storage: Pick<Storage, 'getItem' | 'setItem'>, id: string) => tabValue<string[]>(storage, 'twp-indiv-' + id, [], isKeys)
export const foldStore = (storage: Pick<Storage, 'getItem' | 'setItem'>, id: string) => tabValue<string[]>(storage, 'twp-tree-' + id, [], isKeys)
export const remindOpenStore = (storage: Pick<Storage, 'getItem' | 'setItem'>, id: string) => tabValue<boolean>(storage, 'twp-remind-' + id, false, (v): v is boolean => typeof v === 'boolean')
/** Focus mode (wave 32): the key of the row whose title was tapped, per preview in the tab. */
export const focusStore = (storage: Pick<Storage, 'getItem' | 'setItem'>, id: string) => tabValue<string | null>(storage, 'twp-focus-' + id, null, (v): v is string | null => v === null || typeof v === 'string')
/** Wave 33: the last row focused, so the toggle can return to it from the full list; and the hold on the assembly after an approve on an unticked row. */
export const lastFocusStore = (storage: Pick<Storage, 'getItem' | 'setItem'>, id: string) => tabValue<string | null>(storage, 'twp-lastfocus-' + id, null, (v): v is string | null => v === null || typeof v === 'string')
export const holdStore = (storage: Pick<Storage, 'getItem' | 'setItem'>, id: string) => tabValue<boolean>(storage, 'twp-hold-' + id, false, (v): v is boolean => typeof v === 'boolean')
export const loadOpenStore = (storage: Pick<Storage, 'getItem' | 'setItem'>, id: string) => tabValue<boolean>(storage, 'twp-load-' + id, false, (v): v is boolean => typeof v === 'boolean')

/** Focus mode: the wave name (branch prefix before the slash), the focused row and the other rows; null when nothing is focused or the row is gone/merged. */
export function focusSplit(features: PreviewFeature[], key: string | null): { wave: string; row: PreviewFeature; rest: PreviewFeature[] } | null {
  const rows = visible(features), row = rows.find((f) => f.key === key)
  return row ? { wave: row.branch.split('/')[0], row, rest: rows.filter((f) => f !== row) } : null
}

/** The focus toggle (wave 33): in focus mode it leaves for the full list and remembers the row; in the full list it returns to the last focused row. null = nothing to toggle. */
export function focusToggle(features: PreviewFeature[], focus: string | null, last: string | null): { to: 'full' | 'focus'; focus: string | null; last: string | null; row: PreviewFeature } | null {
  const rows = visible(features), now = rows.find((f) => f.key === focus), before = rows.find((f) => f.key === last)
  if (now) return { to: 'full', focus: null, last: now.key, row: now }
  return before ? { to: 'focus', focus: before.key, last: before.key, row: before } : null
}

/** What a verdict press does (wave 33): approve on an unticked row loads it first and never assembles (the reload to /__tw/wait hid the preview); needs work unloads, which assembles. */
export function pressPlan(features: PreviewFeature[], key: string, v: 'merge' | 'needs-work'): { loadFirst: boolean; assemble: boolean } {
  return { loadFirst: v === 'merge' && !features.find((f) => f.key === key)?.checked, assemble: v === 'needs-work' }
}

/** A panel call gives up after this long (wave 33: a hung request kept every button disabled). */
export const CALL_TIMEOUT_MS = 8000
/** Verdict/toggle/approve calls wait for a CLI run behind the queue (a verdict takes ~6-8 s): 45 s. A timed-out call keeps running server-side. */
export const WRITE_TIMEOUT_MS = 45000
export const callError = (e: { name?: string; message?: string }, ms = CALL_TIMEOUT_MS): string => e.name === 'TimeoutError' || e.name === 'AbortError' ? `no answer after ${ms / 1000} s` : e.message || 'not saved'
/** The panel shows "working…" with the elapsed seconds once a call takes longer than this. */
export const WORKING_AFTER_S = 2
/** Why the pills and boxes are disabled right now (their title). */
export const loadingWhy = (busy: string | null, prText: string): string => busy !== null ? 'saving, one moment' : prText ? 'the PR is being created' : ''

/** A PR flow whose status file has not moved for this long counts as stopped. */
export const PR_STALE_MS = 30 * 60e3
export function prStatusView<T extends { step: string; text?: string; updated?: string }>(j: T, now: number): T {
  const age = now - Date.parse(j.updated ?? '')
  return prRunning(j.step) && j.updated && age > PR_STALE_MS ? { ...j, step: 'failed', text: `The PR flow stopped answering (${Math.round(age / 60e3)} min without news). Press Approve again.` } : j
}

/** What moves while an apply runs; unchanged for 90 s = stuck. */
export const applyStamp = (p: { pending?: boolean; assembled?: { at: string; set?: string[] } | null; features: PreviewFeature[] }): string => JSON.stringify([p.pending, p.assembled?.at, p.assembled?.set, loadedKeys(p.features)])
export const applyStuck = (since: number, now: number): boolean => now - since > 90e3

/** The ended run's verdict for the merge box's big button: Success (green) once merged, Failed (red) after a failed or checks-failed run, Cancelled (neither) after a cancelled Touch ID. */
export const mergeResult = (step: string): { text: string; ok: boolean | null } =>
  step === 'released' ? { text: 'Success', ok: true }
    : step === 'release-pending' ? { text: 'Merged, release pending', ok: true }
    : step === 'cancelled' ? { text: 'Cancelled', ok: null }
    : { text: 'Failed', ok: false }

/** The merge box's head: DONE (green, class ok) once released, MERGED, RELEASE PENDING (green) while the slot catches up, FAILED / CANCELLED (red head) after a run that ended without a merge, IN PROGRESS while it runs. */
export const mergeHead = (step: string): { text: string; ok: boolean } => {
  if (!MERGE_DONE.includes(step)) return { text: 'IN PROGRESS', ok: false }
  const r = mergeResult(step)
  return { text: step === 'released' ? 'DONE' : r.text.toUpperCase(), ok: r.ok === true }
}

/** After a reload: what the box does with the status file of the last Approve wave run (Jakob 2026-11-03: the result vanished into the default buttons
 *  because the page was built from another commit than the run started on; the assembly and the tests move HEAD and restart vite).
 *  'result' = an ended run within a day: its success or failure button shows, whatever commit; 'poll' = a run still going (touched within the hour); 'none' = nothing, or too old. */
export const mergeResume = (j: { step: string; updated?: string }, now: number, wave?: { created?: string }): 'poll' | 'result' | 'none' => {
  if (!j.step || j.step === 'none') return 'none'
  if (wave?.created && Date.parse(j.updated ?? '') < Date.parse(wave.created)) return 'none'   // a run of an earlier wave: not this preview's answer
  const age = now - Date.parse(j.updated ?? '')
  if (MERGE_DONE.includes(j.step)) return age < 86_400e3 ? 'result' : 'none'
  return age < 3_600e3 ? 'poll' : 'none'
}

/** The left panel dims while an Approve wave run is going. It stays clickable and is free again after any ended run, released too (wave 33: a released status left it dead). */
export const panelDone = (step: string): boolean => !['', 'none', ...MERGE_DONE].includes(step)

/** Dev panel button labels (dev_feature.ts): the release button and the personal one that also moves on to dev.trustweb.one. */
export const APPROVE_WAVE_LABEL = 'Approve wave'
export const APPROVE_WAVE_AND_CONTINUE_LABEL = 'Approve wave and continue to dev.trustweb.one'
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

/** Mirror of approveGate in the ops repo (bin/preview_lib.mjs): Approve wave opens with no test run going, every loaded row approved (>= 1 row) and no conflict; pending changes never close it (the press applies them first), the tests run after the press. */
export function approveGate(p: { assembled?: { sha: string; error: string | null } | null; tested?: Tested | null; features: PreviewFeature[]; pending?: boolean; baseSha?: string; compat?: Compat }): { ok: boolean; hint: string } {
  const hint = p.tested?.running ? 'Tests are running'
    : p.assembled?.error && !p.pending ? `Fix the conflict first: ${p.assembled.error.split('\n')[0]}`
    : unapproved(p.features).length ? `Approve first: ${unapproved(p.features).map((f) => f.title).join(', ')}`
    : approvedKeys(p.features).length === 0 ? 'Approve at least one feature'
    : p.pending ? '' : compatHint(p.compat, p.baseSha, loadedRows(p.features))   // pending: the press applies first, which starts a new compat run
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

/** The "Personal preview / Approve wave" box (bottom right) shows only while the left panel is expanded with all rows: a pill or a single focused row hides it (Jakob 2026-11-07). */
export const approveBoxVisible = (panel: { collapsed: boolean; focused: boolean }): boolean => !panel.collapsed && !panel.focused
