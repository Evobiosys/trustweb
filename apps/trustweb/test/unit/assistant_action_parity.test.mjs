// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 assistant (F07): one table says which MCP tool serves each registry action; every action must be in it, every named tool must exist. */
import { createActions } from '../../src/actions.ts'
import { defineAppActions } from '../../src/app_actions.ts'
import { defineEventActions } from '../../src/event_actions.ts'
import { defineSyncActions } from '../../src/sync_actions.ts'
import { defineHomeActions } from '../../src/home_actions.ts'
import { defineResourceShareActions } from '../../src/resource_share_send.ts'
import { defineSeenActions } from '../../src/seen_through_actions.ts' // review-44c
import { defineA44dActions } from '../../src/a44d_actions.ts' // answers-44d
import { defineGroupActions } from '../../src/group_chat_actions.ts' // wave45 group-chat-list
import { defineEventMergeActions } from '../../src/event_merge_actions.ts' // wave45 merge-events
import { defineEventsRefetchAction } from '../../src/events_refetch_actions.ts'
import { ACTION_MCP, mcpToolFor } from '../../src/ext/assistant/actions.ts'
import { allTools } from '../../../mcp/src/tools.ts'

const host = new Proxy({}, { get: () => () => undefined })
const reg = createActions()
defineAppActions(reg, host)
defineEventActions(reg, host)
defineSyncActions(reg, host) // wave43c sync-devices
defineHomeActions(reg, host) // wave44 home-dashboard   // main.ts defines both on the one registry
defineResourceShareActions(reg, host) // wave44 answers-44b
defineSeenActions(reg, host) // review-44c: seen-introduce
defineA44dActions(reg, host) // answers-44d
defineGroupActions(reg, host) // wave45 group-chat-list
defineEventMergeActions(reg, host) // wave45 merge-events
defineEventsRefetchAction(reg, host) // wave45 events-refetch

describe('registry <-> MCP parity', () => {
  const tools = allTools({ file: '/nonexistent', write: true }).map((t) => t.name)
  it('every registry action has an entry (a new action forces a decision)', () => {
    for (const s of reg.specs()) expect(Object.keys(ACTION_MCP), `action ${s.type} has no ACTION_MCP entry`).toContain(s.type)
  })
  it('every entry is a real action', () => {
    const types = reg.specs().map((s) => s.type)
    for (const t of Object.keys(ACTION_MCP)) expect(types).toContain(t)
  })
  it('every named MCP tool exists', () => {
    for (const [type, tool] of Object.entries(ACTION_MCP)) expect(tools, `${type} -> ${tool}`).toContain(tool)
  })
  it('remove-person is reachable (remove_person) and has its undo (restore_person)', () => {
    expect(mcpToolFor('remove-person')).toBe('remove_person')
    expect(tools).toContain('restore_person')
  })
})
