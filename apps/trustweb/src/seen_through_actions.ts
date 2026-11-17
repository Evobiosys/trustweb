// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** review-44c (D-P02 MCP parity): the host's "Introduce to the people here" (seen_through_view.ts eventSection) as a registry action; MCP event_introduce_person queues it. */
import { str, type Actions } from './actions'
import { S } from './strings'

export interface SeenActionHost { introduce(eventId: string, personId: string): void | Promise<void> }

export function defineSeenActions(reg: Actions, host: SeenActionHost): void {
  reg.define({
    type: 'seen-introduce', doc: 'As a host of the event: asks that person whether the people at the event may see them, then introduces them (by name only with their yes).',
    shape: '{"event": event id, "person": person id}',
    parse: (a) => ({ event: str(a, 'event', 120) as string, person: str(a, 'person', 120) as string }),
    label: () => S.review44c.introduceLabel,
    apply: (a) => { void host.introduce(a.event, a.person) },
    undoable: false,
  })
}
