/** Dev-only preview overlay rules (pure): which boxes are disabled and what a toggle cascades to. Interface: previews-interface.txt. */
export { readyToGo } from '../dev_preview_rules.mjs'

export interface PreviewFeature { key: string; branch: string; title: string; requires: string[]; checked: boolean; selector?: string }

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

/** The highlighted row after a tap on `key`: the same row again switches it off. */
export function tapped(lit: string | null, key: string): string | null {
  return lit === key ? null : key
}

/** Wording of the confirm box: one differing box names it, several count them. */
export function confirmText(title: string, checked: boolean, changes = 1): string {
  return changes > 1 ? `Re-assemble preview with these ${changes} changes? The page reloads.` : `Re-assemble preview ${checked ? 'with' : 'without'} ${title}? The page reloads.`
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

/** The panel's collapsed flag in a per-tab store (sessionStorage): a new tab or a fresh load starts expanded. Unavailable storage = not remembered. */
export function collapseStore(storage: Pick<Storage, 'getItem' | 'setItem'>): { get(): boolean; set(on: boolean): void } {
  const key = 'twp-collapsed'
  return {
    get: () => { try { return storage.getItem(key) === '1' } catch { return false } },
    set: (on) => { try { storage.setItem(key, on ? '1' : '') } catch { /* not remembered */ } },
  }
}

/** True while the "Create PR" flow works: its /__tw/status step is neither none, ready nor failed. */
export function prRunning(step: string): boolean {
  return !['none', 'ready', 'failed'].includes(step)
}
