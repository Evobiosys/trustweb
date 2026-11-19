// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 merge-events: the registry actions behind MCP event_merge / event_merge_answer (queued for the open app, which holds the pair keys). Each needs approval; neither can be taken back here (the gone event waits in Recently deleted). */
import { bool, str, type Actions } from './actions'
import { S } from './strings'

export interface EventMergeActionHost {
  /** event_merge_flow.ts start: merge at once (host of both) or ask the other host. */
  start(keep: string, gone: string): Promise<unknown>
  answer(keep: string, gone: string, yes: boolean): Promise<boolean>
}

const pairOf = (a: Record<string, unknown>): { keep: string; gone: string } => {
  const keep = str(a, 'keep', 120) as string
  const gone = str(a, 'gone', 120) as string
  if (keep === gone) throw new Error('keep and gone must be two different events')
  return { keep, gone }
}

export function defineEventMergeActions(reg: Actions, host: EventMergeActionHost): void {
  reg.define({
    type: 'event-merge', doc: 'Merges event `gone` into event `keep` (keep keeps its id and link; people, resources, roles, notes move over; the old id redirects). A host of both merges at once; otherwise the other event\'s hosts are asked.',
    shape: '{"keep": event id, "gone": event id}', parse: pairOf,
    label: () => S.w45merge.actionLabel, auto: false, undoable: false,
    apply: (a) => { void host.start(a.keep, a.gone) },
  })
  reg.define({
    type: 'event-merge-answer', doc: 'Answers another host\'s ask to merge my event `gone` into their event `keep`: yes merges, no ends the ask.',
    shape: '{"keep": event id, "gone": event id, "yes": true|false}', parse: (a) => ({ ...pairOf(a), yes: bool(a, 'yes') }),
    label: () => S.w45merge.answerLabel, auto: false, undoable: false,
    apply: (a) => { void host.answer(a.keep, a.gone, a.yes) },
  })
}
