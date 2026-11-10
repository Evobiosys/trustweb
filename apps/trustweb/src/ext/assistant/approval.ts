// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 ai-edit-chat: the cards of the assistant's proposed actions and their states.
 *   proposed --approve--> applied --undo--> undone
 *   proposed --skip-----> skipped
 *   proposed --approve (it throws)--> failed
 * "Apply as I watch" approves a new card at once unless the action must be approved by hand (auto: false, e.g. a tap on the page).
 * Pure, no DOM.
 */
import type { Applied, Valid } from '../../actions'

export type CardState = 'proposed' | 'applied' | 'skipped' | 'undone' | 'failed'
export interface Card { id: number; action: Valid; state: CardState; error?: string }

export function createApproval(runner: { run(a: Valid): Applied }, opts: { auto: () => boolean }) {
  const cards: Card[] = []
  const undos = new Map<number, Applied>()
  const listeners = new Set<() => void>()
  let next = 1
  const changed = (): void => { for (const fn of [...listeners]) fn() }
  const find = (id: number): Card | undefined => cards.find((c) => c.id === id)

  function apply(c: Card): void {
    try { undos.set(c.id, runner.run(c.action)); c.state = 'applied' } catch (e) { c.state = 'failed'; c.error = (e as Error).message }
  }

  return {
    add(actions: readonly Valid[]): Card[] {
      const added = actions.map((action) => ({ id: next++, action, state: 'proposed' as CardState }))
      cards.push(...added)
      if (opts.auto()) for (const c of added) if (c.action.auto) apply(c)
      if (added.length) changed()
      return added
    },
    approve(id: number): boolean {
      const c = find(id)
      if (c?.state !== 'proposed') return false
      apply(c); changed(); return true
    },
    skip(id: number): boolean {
      const c = find(id)
      if (c?.state !== 'proposed') return false
      c.state = 'skipped'; changed(); return true
    },
    undo(id: number): boolean {
      const c = find(id)
      if (c?.state !== 'applied' || !c.action.undoable) return false
      undos.get(id)?.undo()
      undos.delete(id)
      c.state = 'undone'; changed(); return true
    },
    /** Approves every waiting card in order; how many were tried. */
    approveAll(): number {
      const waiting = cards.filter((c) => c.state === 'proposed')
      for (const c of waiting) apply(c)
      if (waiting.length) changed()
      return waiting.length
    },
    cards: (): readonly Card[] => cards,
    summary(): Record<CardState, Card[]> {
      const by = (s: CardState): Card[] => cards.filter((c) => c.state === s)
      return { applied: by('applied'), skipped: by('skipped'), undone: by('undone'), failed: by('failed'), proposed: by('proposed') }
    },
    onChange(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } },
  }
}
export type Approval = ReturnType<typeof createApproval>
