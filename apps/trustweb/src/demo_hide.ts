/**
 * Hide / show demo content (Jakob 2026-10-19: "make it possible to also hide those, like show or hide demo content").
 * Hiding moves the demo-marked people and things (state.demo ids, demo_dismiss.ts semantics: a connected person is never
 * demo content) into state.demoHidden, so nothing is lost, not even a note made on a dummy; showing moves them back.
 * The marking (state.demo) stays while hidden, so isDemoPerson / isDemoItem keep saying so and "Remove demo content"
 * (removeDummyContent) can still take everything away. Pure: it changes the state it is given.
 */
import type { AppState } from './model'

/** True when there is demo content on this phone and it is in view. */
export function demoShown(s: Pick<AppState, 'demo' | 'demoHidden'>): boolean {
  return Boolean(s.demo) && !s.demoHidden
}

/** Moves the demo content into the stash. False when there is none or it is hidden already. */
export function hideDemoContent(s: AppState): boolean {
  if (!s.demo || s.demoHidden) return false
  const people = new Set(s.demo.people)
  const inventory = new Set(s.demo.inventory)
  const isDummy = (p: AppState['people'][number]): boolean => !p.peerId && people.has(p.id)
  s.demoHidden = { people: s.people.filter(isDummy), inventory: s.inventory.filter((i) => inventory.has(i.id)) }
  s.people = s.people.filter((p) => !isDummy(p))
  s.inventory = s.inventory.filter((i) => !inventory.has(i.id))
  return true
}

/** Puts the stashed demo content back. False when nothing is hidden. */
export function showDemoContent(s: AppState): boolean {
  if (!s.demoHidden) return false
  const have = new Set(s.people.map((p) => p.id))
  const haveThing = new Set(s.inventory.map((i) => i.id))
  s.people.push(...s.demoHidden.people.filter((p) => !have.has(p.id)))
  s.inventory.push(...s.demoHidden.inventory.filter((i) => !haveThing.has(i.id)))
  delete s.demoHidden
  return true
}
