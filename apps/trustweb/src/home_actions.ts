// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 home-dashboard (POLICY P02): opening a Dashboard (of an affiliation, or the chooser) as an action of the registry (actions.ts), reached by MCP dashboard_open. */
import { str, type Actions } from './actions'
import { S } from './strings'

export interface HomeActionHost { openDashboard(affiliation?: string): void; openRequest(id: string): void }

export function defineHomeActions(reg: Actions, host: HomeActionHost): void {
  reg.define({
    type: 'dashboard-open', doc: 'Opens the Dashboard of an affiliation (community:<tag>, group:<tag>, event:<id>, tag:<tag>); without one, the chooser.', shape: '{"affiliation"?: id}',
    parse: (a) => ({ affiliation: str(a, 'affiliation', 120, true) }),
    label: (a) => `${S.dashboard.title}${a.affiliation ? ` ${a.affiliation}` : ''}`,
    apply: (a) => { host.openDashboard(a.affiliation) },
    undoable: false,
  })
  /* wave44c home-default */
  reg.define({
    type: 'home-open-request', doc: 'Opens one open request (an id from requests_list) as its ask or connect card on the Web.', shape: '{"id": request id}',
    parse: (a) => ({ id: str(a, 'id', 120) as string }),
    label: (a) => `${S.homeDefault.openRequest} ${a.id}`,
    apply: (a) => { host.openRequest(a.id) },
    undoable: false,
  })
}
