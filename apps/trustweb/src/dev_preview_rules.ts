/** Dev-only preview overlay rules (pure): which boxes are disabled and what a toggle cascades to. Interface: previews-interface.txt. */
export interface PreviewFeature { key: string; branch: string; title: string; requires: string[]; checked: boolean }

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
