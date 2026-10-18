/** Merge two people: field picks to the survivor, records over, the other hidden in Tana with a note; an undo for 30 s. */
import { shownName } from './display'
import { mergeEdits } from './merge'
import type { MergeRow, Pick } from './merge'
import { apply, restore, valuesOf } from './sorting.svelte'
import { mergeRecords, store } from './state.svelte'
import { hideFromTrustweb, moveUnder, noteToTana, unhideInTrustweb } from './sync.svelte'

const UNDO_MS = 30_000

/** The merge that can still be undone (shown as a toast), or null. */
export const lastMerge = $state<{ name: string; undo: (() => void) | null }>({ name: '', undo: null })
let timer: ReturnType<typeof setTimeout> | undefined

function nameOf(id: string): string {
  const p = store.app.people.find((x) => x.id === id)
  return p ? shownName(p.name) : id
}

/** Merges `otherId` into `keepId`; the survivor keeps its id (and Tana node). */
export function mergePeople(keepId: string, otherId: string, rows: readonly MergeRow[], picks: Readonly<Record<string, Pick>>, custom: Readonly<Record<string, string>> = {}): void {
  const keepName = nameOf(keepId)
  const otherName = nameOf(otherId)
  const before = valuesOf(keepId)
  const edits = mergeEdits(rows, picks, custom)
  const fieldUndo = apply(keepId, edits, before)
  const recordsUndo = mergeRecords(otherId, keepId)
  noteToTana(otherId, `merged into ${keepName}`)
  noteToTana(keepId, `merged ${otherName}`)
  hideFromTrustweb(otherId)
  moveUnder(otherId, keepId, otherName)
  clearTimeout(timer)
  lastMerge.name = otherName
  lastMerge.undo = (): void => {
    clearTimeout(timer)
    unhideInTrustweb(otherId)
    recordsUndo()
    restore(keepId, fieldUndo)
    noteToTana(otherId, 'merge undone')
    lastMerge.undo = null
  }
  timer = setTimeout(() => { lastMerge.undo = null }, UNDO_MS)
}
