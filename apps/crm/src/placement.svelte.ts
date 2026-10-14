/** The placement the screens read, and the one place that writes it: for me (this device) or for the networks I curate. */
import { adminNetworks, effectivePlacement } from './curation'
import type { FieldValues } from './fields'
import { prefs, savePrefs } from './prefs.svelte'
import { Kind, emptyPlacements, layout, move } from './placement'
import type { Layout, Placement, Section } from './placement'
import { curate, store } from './state.svelte'

export function placementFor(kind: Kind): Placement {
  return effectivePlacement(kind, prefs.placement, store.crm.curation, Date.now())
}

export function layoutFor(kind: Kind, values: FieldValues): Layout {
  return layout(kind, placementFor(kind), values)
}

/** Networks the scope picker offers: the ones I admin right now. */
export function scopeChoices(): string[] {
  return adminNetworks(store.crm.curation, Date.now())
}

/** Puts a field into a section before another (end when null), in the scope chosen under Fields: me, or each ticked network. */
export function placeField(kind: Kind, values: FieldValues, key: string, section: Section, before: string | null): void {
  const nets = prefs.scope.filter((n) => scopeChoices().includes(n))
  if (nets.length === 0) {
    prefs.placement[kind] = move(kind, placementFor(kind), values, key, section, before)
    savePrefs()
    return
  }
  curate((c) => {
    for (const n of nets) {
      const own = c.byNetwork[n] ?? emptyPlacements()
      c.byNetwork[n] = { ...own, [kind]: move(kind, own[kind], values, key, section, before) }
    }
  })
}
