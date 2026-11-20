// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d (item 1, Jakob 2026-11-18: "mcp should be able to access everything"): every view module of the app (apps/trustweb/src/**\/*_view.ts)
 * names the MCP tools that read or change what it shows. scripts/parity_check.mjs (and test/unit/mcp_parity.test.mjs, so CI) fail when a view is
 * missing here or names a tool the server does not offer: a branch that adds a view adds its tool, or says honestly that only `app_action`
 * (the assistant's open / tap, queued for the open app) reaches it. Node-only helpers; no app imports.
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'

const NAV = ['app_action'] as const

export const VIEW_TOOLS: Readonly<Record<string, readonly string[]>> = {
  'agent_view.ts': ['ai_provider_get', 'ai_provider_set'],
  'agreements_view.ts': ['get_person', 'app_action'],
  'archived_copies_view.ts': ['trash_list', 'trash_restore'],
  'archived_people_view.ts': ['list_people', 'restore_person'],
  'ask_escalation_view.ts': ['ask_escalation_get', 'ask_escalation_set', 'asks_incoming_list', 'ask_answer'],
  'ask_web_view.ts': ['ask_audience_get', 'ask_audience_set', 'settings_set'],
  'backup_view.ts': ['settings_keep_copy', 'app_action'],
  'bubble_connect_view.ts': ['introduce_people', 'introduce_link_create', 'handshake_status'],
  'bw_mode_view.ts': ['settings_get', 'settings_set'],
  'card_pages_view.ts': ['profile_get', 'profile_link_add', 'profile_link_remove'],
  'card_stack_view.ts': ['get_person', 'set_ring'],
  'card_view.ts': ['get_person', 'set_ring', 'set_field', 'add_tag', 'remove_tag', 'add_note'],
  'channel_readers_view.ts': ['settings_get', 'settings_set'],
  'chat_row_view.ts': ['chats_list', 'chat_read'],
  'chat_view.ts': ['chats_list', 'chat_read', 'chat_send'],
  'circles_view.ts': ['circles_layout', 'set_ring'],
  'complete_view.ts': ['list_people', 'set_field'],
  'connect_add_view.ts': ['connect_code', 'connect_redeem', 'connect_placement_set'],
  'connect_advanced_view.ts': ['connect_placement', 'connect_link_check'],
  'connect_view.ts': ['connect_code', 'connect_redeem', 'person_qr_target'],
  'contact_box_view.ts': ['get_person', 'set_field'],
  'contacts_sync_view.ts': ['sync_status', 'sync_now'],
  'dashboard_view.ts': ['dashboard_open', 'home_layout_get'],
  'desktop_view.ts': NAV,
  'event_editor_view.ts': ['event_drafts_list', 'event_draft_save', 'event_details_set', 'event_times_set', 'event_invite'],
  'event_plan_view.ts': ['event_signup', 'event_resource_ask', 'event_resource_cover'],
  'event_roles_view.ts': ['event_roles_set', 'event_get'],
  'event_group_chat_view.ts': ['event_chat_open', 'event_chat_read', 'event_chat_send', 'event_chat_leave'], // wave45 event-group-chat
  'group_chat_view.ts': ['group_list', 'group_read', 'group_create', 'group_invite', 'group_open', 'group_send', 'group_leave', 'list_create', 'list_set_active', 'list_add_item', 'list_check', 'list_move', 'list_archive_done'], // wave45 group-chat-list
  'events_view.ts': ['events_list', 'event_get', 'event_create', 'event_settings_set', 'event_link_open', 'event_share_audience_set', 'event_chat_open', 'event_message_all'],
  'event_page_top_view.ts': ['event_get', 'event_share_audience_set', 'event_chat_open', 'event_message_all', 'event_people_list', 'event_people_add'],
  'ext/calendar/at_event_view.ts': ['event_get', 'event_settings_set'],
  'ext/calendar/calendar_tags_view.ts': ['calendar_tag_toggle'],
  'ext/calendar/calendar_view.ts': ['events_list', 'calendar_add'],
  'ext/calendar/ics_view.ts': ['calendar_add'],
  'ext/calendar/outliner_view.ts': ['tasks_list', 'app_action'],
  'ext/calendar/scheduling_view.ts': ['events_list', 'app_action'],
  'ext/calendar/tasks_view.ts': ['tasks_list', 'app_action'],
  'ext/co_notes/co_chat_view.ts': NAV,
  'ext/co_notes/co_guest_view.ts': NAV,
  'ext/co_notes/co_share_view.ts': NAV,
  'ext/co_notes/co_view.ts': ['list_notes', 'app_action'],
  'ext/community-mighty/community_calendar_view.ts': ['events_list', 'community_list'],
  'ext/community-mighty/community_view.ts': ['community_list', 'community_menu_get', 'community_settings_get', 'community_settings_set', 'resources_list', 'community_intimate_set'],
  'ext/embeds/embeds_view.ts': ['community_menu_get', 'app_action'],
  'ext/events/events_view.ts': ['events_list', 'event_get'],
  'ext/feed/feed_view.ts': ['feed_list', 'feed_post'],
  'ext/geb/geb_view.ts': NAV,
  'ext/matrix/matrix_view.ts': ['chats_list', 'app_action'],
  'ext/obsidian/obsidian_view.ts': ['import_sources', 'import_run', 'import_suggestions_list', 'import_suggestions_accept'],
  'ext/photos/photos_import_view.ts': ['import_sources', 'app_action'],
  'ext/photos/photos_share_view.ts': NAV,
  'ext/preview-phone/preview_phone_view.ts': NAV,
  'ext/signal-link/setup_view.ts': ['import_sources', 'app_action'],
  'ext/whatsapp/whatsapp_view.ts': ['import_sources', 'app_action'],
  'feed_ext_view.ts': ['feed_extension_set', 'feed_source_add', 'feed_source_remove', 'feed_refresh'],
  'feed_sources_view.ts': ['feed_sources_get', 'feed_source_toggle', 'feed_algorithm_set'],
  'feed_view.ts': ['feed_list', 'feed_post', 'feed_edit', 'feed_star', 'feed_post_read'],
  'filter_bar_view.ts': ['web_filter_get', 'web_filter_set', 'event_mode_get', 'event_mode_set', 'event_bubble_set'],
  'five_rings_view.ts': ['list_people', 'set_ring'],
  'groups_view.ts': ['groups_list', 'create_group_tag'],
  'hide_from_view.ts': ['person_hide', 'ask_tamper_reports_list'],
  'home_view.ts': ['home_layout_get', 'home_layout_set', 'requests_list', 'home_open_request'],
  'hops_view.ts': ['ask_audience_get', 'settings_set'],
  'hosting_view.ts': ['hosting_set', 'profile_discoverable_set'],
  'import_curate_view.ts': ['import_suggestions_list', 'import_suggestions_accept'],
  'import_home_view.ts': ['import_sources', 'import_run', 'import_tana_pull'],
  'import_view.ts': ['import_sources', 'import_run'],
  'inapp_banner_view.ts': NAV,
  'intro_ask_view.ts': ['introduce_link_create', 'asks_incoming_list'],
  'intro_card_view.ts': ['asks_incoming_list', 'ask_answer'],
  'invitations_view.ts': ['invitations_list'],
  'invite_view.ts': ['invite_link_status', 'invite_link_create', 'invite_link_revoke'],
  'keep_in_touch_view.ts': ['list_people', 'settings_set'],
  'knows_view.ts': ['get_person', 'relations_list'],
  'link_change_view.ts': ['profile_link_check'],
  'llm_endpoint_view.ts': ['assistant_providers', 'assistant_set_model'],
  'map_view.ts': ['list_people', 'app_action'],
  'matches_view.ts': ['search', 'app_action'],
  'meeting_search_view.ts': ['meetings_list', 'search'],
  'member_picker_view.ts': ['list_people', 'community_add_member'],
  'membranes_five_view.ts': ['resources_list', 'resource_share'],
  'messenger_combined_view.ts': ['chats_list', 'chat_read', 'chat_send'],
  'messenger_host_view.ts': ['chats_list', 'app_action'],
  'names_view.ts': ['list_people', 'set_field'],
  'network_view.ts': ['list_people', 'circles_layout'],
  'notes_view.ts': ['list_notes', 'add_note'],
  'notify_center_view.ts': ['notifications_list', 'notifications_mark_read', 'notification_dismiss'],
  'notify_popup_view.ts': ['notifications_inbox_list', 'notifications_popup_set'],
  'onboarding_whatsapp_view.ts': NAV,
  'open_space_view.ts': ['open_space_propose', 'open_space_join'],
  'own_profile_view.ts': ['profile_get', 'profile_set'],
  'pack_view.ts': NAV,
  'page_view.ts': NAV,
  'past_asks_view.ts': ['requests_list', 'asks_incoming_list', 'ask_answer'],
  'past_meetings_view.ts': ['meetings_list'],
  'people_fields_view.ts': ['get_person', 'set_field'],
  'people_list_view.ts': ['list_people', 'set_ring'],
  'people_row_view.ts': ['list_people', 'app_action'],
  'person_general_view.ts': ['get_person', 'set_field'],
  'profile_link_view.ts': ['profile_link_add', 'profile_link_check'],
  'profile_page_view.ts': ['profile_get', 'profile_set'],
  'profile_view.ts': ['profile_get', 'profile_set'],
  'provenance_view.ts': ['get_person', 'app_action'],
  'qr_modes_view.ts': ['connect_code', 'person_qr_target'],
  'reassurance_view.ts': NAV,
  'relations_view.ts': ['relations_list', 'app_action'],
  'requests_list_view.ts': ['requests_list', 'home_open_request'],
  'resource_outline_view.ts': ['resources_list', 'resource_block_add', 'resource_block_edit', 'resource_block_move', 'resource_block_remove', 'resource_block_collapse'],
  'resource_scope_view.ts': ['resources_list', 'resource_mark_opened', 'resource_add'],
  'resource_views_view.ts': ['resources_list', 'resource_set_kind', 'resource_set_physical'],
  'scope_editor_view.ts': ['trusted_only_set', 'trust_override_set'],
  'seen_through_view.ts': ['people_seen_through_list', 'event_introduce_person'],
  'services_view.ts': ['import_sources', 'app_action'],
  'share_page_view.ts': ['resource_share'],
  'shared_notes_view.ts': ['list_notes'],
  'short_alias_view.ts': ['profile_get', 'app_action'],
  'short_link_view.ts': ['invite_link_create'],
  'snapshot_view.ts': NAV,
  'social_hosting_view.ts': ['hosting_set', 'directory_search'],
  'sovereign_switch_view.ts': ['settings_get', 'settings_set'],
  'support_ask_view.ts': ['support_ask', 'support_cancel', 'support_inbox'],
  'support_delivery_view.ts': ['support_inbox'],
  'sync_view.ts': ['sync_status', 'sync_now', 'sync_pair_link', 'sync_pair_show_new', 'sync_pair_scan'],
  'sync_visibility_view.ts': ['settings_sync_capabilities', 'settings_set'],
  'tag_manager_view.ts': ['list_tags', 'create_group_tag', 'remove_tag'],
  'tana_pull_view.ts': ['import_tana_pull'],
  'timeline_view.ts': ['meetings_list', 'app_action'],
  'title_emoji_view.ts': ['settings_get', 'settings_set'],
  'transcription_view.ts': ['settings_get', 'settings_set'],
  'trash_view.ts': ['trash_list', 'trash_restore'],
  'trustzones_view.ts': ['trusted_only_set', 'trust_override_set'],
  'web_default_view.ts': ['web_default_view_get', 'web_default_view_set'],
  'web_view.ts': ['list_people', 'web_filter_get', 'web_filter_set', 'circles_layout'],
  'zone_share_link_view.ts': ['invite_link_create', 'app_action'],
}

/** Every *_view.ts under `srcDir`, as paths relative to it (forward slashes), sorted. */
export function viewFiles(srcDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('_view.ts')) out.push(path.relative(srcDir, p).split(path.sep).join('/'))
    }
  }
  walk(srcDir)
  return out.sort()
}

/** What is missing: a view without an entry, or an entry naming a tool the server does not offer. */
export function viewCoverage(views: readonly string[], tools: readonly string[], map: Readonly<Record<string, readonly string[]>> = VIEW_TOOLS): string[] {
  const out: string[] = []
  for (const v of views) {
    const named = map[v]
    if (!named || named.length === 0) { out.push(`view ${v} has no MCP tool (apps/mcp/src/view_coverage.ts)`); continue }
    for (const t of named) if (!tools.includes(t)) out.push(`view ${v} -> ${t} (no such tool)`)
  }
  return out
}
