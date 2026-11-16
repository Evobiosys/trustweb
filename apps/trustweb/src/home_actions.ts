// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 home-dashboard (POLICY P02): opening a Dashboard (of an affiliation, or the chooser) as an action of the registry (actions.ts), reached by MCP dashboard_open. */
import { str, type Actions } from './actions'
import { S } from './strings'

export interface HomeActionHost { openDashboard(affiliation?: string): void }

export function defineHomeActions(reg: Actions, host: HomeActionHost): void {
  reg.define({
    type: 'dashboard-open', doc: 'Opens the Dashboard of an affiliation (community:<tag>, group:<tag>, event:<id>, tag:<tag>); without one, the chooser.', shape: '{"affiliation"?: id}',
    parse: (a) => ({ affiliation: str(a, 'affiliation', 120, true) }),
    label: (a) => `${S.dashboard.title}${a.affiliation ? ` ${a.affiliation}` : ''}`,
    apply: (a) => { host.openDashboard(a.affiliation) },
    undoable: false,
  })
}
