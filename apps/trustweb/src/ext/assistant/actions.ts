// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 assistant (F07): the one table that says which MCP tool (apps/mcp) serves each action of the registry (../../actions.ts,
 * the app's commands in ../../app_actions.ts). Pure, no imports: the app and node read it. test/unit/assistant_action_parity.test.mjs fails
 * when a registry action has no entry or an entry names a tool that does not exist.
 * Wave 42 mcp-parity: every action has a tool. Actions that change only the record have a tool of their own; the ones that need the screen
 * go through the tool `app_action` (apps/mcp/src/parity_tools.ts), which queues them for the open preview; APP_ACTION_TYPES lists them.
 */
export const ACTION_MCP: Readonly<Record<string, string>> = {
  'open': 'app_action', 'tap': 'app_action',
  'set-ring': 'set_ring', 'add-tag': 'add_tag', 'remove-tag': 'remove_tag', 'set-field': 'set_field', 'add-note': 'add_note', 'create-group-tag': 'create_group_tag',
  'remove-person': 'remove_person',
  'row-add-tag': 'app_action', 'row-set-ring': 'app_action', 'row-note': 'app_action', 'accept-row': 'app_action', 'leave-row': 'app_action',
  'set-look': 'app_action', 'set-profile': 'app_action', 'set-extension': 'app_action', 'set-setting': 'app_action', 'create-variation': 'app_action',
  // Wave 42 community-event (event_actions.ts): a new event has its own tool; the event's text, roles and resources go through the open preview.
  'event-create': 'event_create', 'event-doc': 'app_action', 'event-role': 'app_action', 'event-resource': 'app_action',
}

/** The actions `app_action` accepts (derived, so a new entry above needs no second edit). */
export const APP_ACTION_TYPES: readonly string[] = Object.entries(ACTION_MCP).filter(([, t]) => t === 'app_action').map(([a]) => a)

export const mcpToolFor = (type: string): string | null => ACTION_MCP[type] ?? null
