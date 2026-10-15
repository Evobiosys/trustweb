/** Dev-only preview overlay rules (pure): which boxes are disabled and what a toggle cascades to. Interface: previews-interface.txt. */
export { readyToGo } from '../dev_preview_rules.mjs'

export type Repo = 'vanilla' | 'private' | 'ops'

export interface PreviewFeature { key: string; repo?: Repo; ref?: string; branch: string; title: string; requires: string[]; checked: boolean; selector?: string; where?: string; steps?: string[]; merged?: boolean }

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

/** How many checked boxes the user sees (merged features are not rows). */
export function prCount(features: PreviewFeature[]): number {
  return visible(features).filter((f) => f.checked).length
}

/** True while the boxes on screen (a draft) differ from the assembled set: a PR takes the assembled set, so it waits for the reload. */
export function prBlocked(draft: PreviewFeature[] | null, assembled: PreviewFeature[]): boolean {
  return draft !== null && draft.some((f) => f.checked !== assembled.find((a) => a.key === f.key)?.checked)
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

/** The highlighted row after a tap on `key`: the same row again switches it off. */
export function tapped(lit: string | null, key: string): string | null {
  return lit === key ? null : key
}

/** Wording of the confirm box: one differing box names it, several count them; with a PR, it says the PR keeps its set until updated. */
export function confirmText(title: string, checked: boolean, changes = 1, pr?: number | null): string {
  const base = changes > 1 ? `Re-assemble preview with these ${changes} changes? The page reloads.` : `Re-assemble preview ${checked ? 'with' : 'without'} ${title}? The page reloads.`
  return typeof pr === 'number' ? `${base} PR #${pr} keeps its current set until you update it.` : base
}

/** True when a PR exists and may be behind the assembled branch: no recorded sha (older PRs) or a different one. */
export function prNeedsUpdate(pr: { sha?: string } | null, assembledSha: string | undefined): boolean {
  return pr !== null && (!pr.sha || pr.sha !== assembledSha)
}

/** The PR button label: create without a PR, update when the PR is behind, '' when it holds this set. */
export function prButton(pr: { number: number; sha?: string } | null, n: number, assembledSha: string | undefined): string {
  if (!pr) return `Create PR with ${n} checked`
  return prNeedsUpdate(pr, assembledSha) ? `Update PR #${pr.number} with ${n} checked` : ''
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

/** True while the "Create PR" flow works: its /__tw/status step is neither none, ready nor failed. */
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

/** The Create PR progress line: never a raw step name. `text` is the status file's own wording (used for ci and failed). */
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
