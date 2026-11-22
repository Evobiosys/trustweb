// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 events-refetch: the registry action behind MCP events_refetch (the Refresh button of the Events list). */
import type { Actions } from './actions'
import { S } from './strings'
import { createEventsRefetch, type EventsRefetchHost } from './events_refetch'

export function defineEventsRefetchAction(reg: Actions, host: { refetch(explicit: boolean): Promise<number | null> }): void {
  reg.define({
    type: 'events-refetch', doc: 'Asks the connected people for new events of my communities now (the Refresh of the Events list).', shape: '{}',
    parse: () => ({}),
    label: () => S.w45refetch.label,
    apply: () => { void host.refetch(true) },
    undoable: false,
  })
}

/** answers-45a (P5): the whole row in one call for main.ts: the refetch engine plus its registry action; returns the run (Events open, pull, Refresh). */
export function installEventsRefetch<P extends { id: string }>(reg: Actions, h: EventsRefetchHost<P>): (explicit: boolean) => Promise<number | null> {
  const { run } = createEventsRefetch(h)
  defineEventsRefetchAction(reg, { refetch: run })
  return run
}
