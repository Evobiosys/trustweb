// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 mcp-parity: the ONE list of tools the server offers (server.ts) and the tests check (mcp_parity.test.mjs, against MCP_TOOLS in
 * apps/trustweb/src/ext/mcp-local/mcp_config.ts and the action registry). A branch that adds a tool adds its tools function here.
 * Every tool that exists only with writes on announces itself after it ran (events.ts), so an open preview shows a card for it.
 */
import { announce } from './events.ts'
import { aiChoiceTools } from './ai_choice_tools.ts'
import { assistantTools } from './assistant_tools.ts'
import { billingTools } from './billing_tools.ts'
import { bubbleTools } from './bubble_tools.ts'
import { connectExtrasTools } from './connect_extras_tools.ts'
import { hideTools } from './hide_tools.ts'
import { seenThroughTools } from './seen_through_tools.ts' // wave44c seen-through
import { homeTools } from './home_tools.ts'
import { profilePageTools } from './profile_page_tools.ts'
import { feedSourcesTools } from './feed_sources_tools.ts' // wave44 feed-sources
import { feedExtTools } from './feed_ext_tools.ts' // wave44c feed-ext
import { handshakeTools } from './handshake_tools.ts'
import { importTools } from './import_tools.ts'
import { inviteTools } from './invite_tools.ts'
import { parityTools } from './parity_tools.ts'
import { previewTools } from './preview_tools.ts'
import type { Tool } from './protocol.ts'
import { recordTools, type RecordToolsOptions } from './record_tools.ts'
import { syncTools } from './sync_tools.ts'
import { trashTools } from './trash_tools.ts' // wave44c answers-44c
import { a44dTools } from './a44d_tools.ts' // wave44c answers-44d
import { eventPeopleTools } from './event_people_tools.ts' // wave45 event-people-list
import { eventChatTools } from './event_chat_tools.ts' // wave45 event-group-chat
import { groupTools } from './group_tools.ts' // wave45 group-chat-list
import { eventMergeTools } from './event_merge_tools.ts' // wave45 merge-events
import { settingsShareTools } from './settings_share_tools.ts' // wave45 settings-suggest
import { googleSyncTools } from './google_sync_tools.ts' // wave45 google-contacts-sync
import { bulkInviteTools } from './bulk_invite_tools.ts' // wave45 bulk-invite-filter

export interface AllToolsOptions extends RecordToolsOptions {
  /** The server the app talks to (billing tools). Default https://app.trustweb.one. */
  apiBase?: string
  /** Loopback dev server of a preview: adds the review panel's tools (preview_rows, preview_verdict, preview_mark_merged). */
  previewUrl?: string
}

/** Tools that change the preview registry, not the record: no card in the preview. */
const NO_CARD = new Set(['preview_verdict', 'preview_mark_merged', /* wave43c: announces its own action */ 'sync_now', 'event_envelope_send', /* wave44 */ 'dashboard_open', /* wave44c home-default */ 'home_open_request', /* wave44c sync-seamless */ 'sync_pair_link', /* wave44c answers-44c */ 'sync_pair_show_new', 'sync_pair_scan', /* wave44c answers-44d: queued actions */ 'ask_answer', 'chat_send', 'event_chat_open', 'event_message_all', /* wave45 event-group-chat */ 'event_chat_send', 'event_chat_leave', /* wave45 group-chat-list: queued actions */ 'group_open', 'group_send', 'group_leave', 'list_create', 'list_set_active', 'list_add_item', 'list_check', 'list_move', 'list_archive_done', /* wave45 merge-events: queued actions */ 'event_merge', 'event_merge_answer'])

export function allTools(o: AllToolsOptions, allow?: readonly string[]): Tool[] {
  const build = (write: boolean): Tool[] => [
    ...recordTools({ ...o, write }), ...assistantTools({ ...o, write }), ...parityTools({ ...o, write }), ...connectExtrasTools({ ...o, write }), /* wave44 home-dashboard */ ...homeTools({ ...o, write }), ...importTools({ ...o, write }),
    ...billingTools({ file: o.file, write, apiBase: o.apiBase || 'https://app.trustweb.one' }),
    /* wave43c sync-devices */ ...syncTools({ ...o, write }),
    /* wave44 steer-ask-placement-2 */ ...aiChoiceTools({ ...o, write }),
    /* wave44b hide-from-crypto */ ...hideTools(o),
    /* wave44c seen-through */ ...seenThroughTools(o),
    /* wave44 feed-sources */ ...feedSourcesTools({ ...o, write }),
    /* wave44 steer-bubble-connect */ ...bubbleTools({ ...o, write }),
    /* wave44 handshake-crypto */ ...handshakeTools(o),
    /* wave44 steer-invite-link */ ...inviteTools({ ...o, write }),
    /* wave44b profile-page */ ...profilePageTools({ ...o, write }),
    /* wave44c feed-ext */ ...feedExtTools({ ...o, write }),
    /* wave44c answers-44c */ ...trashTools({ ...o, write }),
    /* wave44c answers-44d */ ...a44dTools({ ...o, write }),
    /* wave45 event-people-list */ ...eventPeopleTools({ ...o, write }),
    /* wave45 event-group-chat */ ...eventChatTools({ ...o, write }),
    /* wave45 group-chat-list */ ...groupTools({ ...o, write }),
    /* wave45 merge-events */ ...eventMergeTools({ ...o, write }),
    /* wave45 settings-suggest */ ...settingsShareTools({ ...o, write }),
    /* wave45 google-contacts-sync */ ...googleSyncTools({ ...o, write }),
    /* wave45 bulk-invite-filter */ ...bulkInviteTools({ ...o, write }),
    ...(o.previewUrl ? previewTools({ url: o.previewUrl, write }) : []),
  ]
  const readOnly = new Set(build(false).map((t) => t.name))
  const now = o.now ?? (() => new Date())
  return build(o.write)
    .filter((t) => !allow || allow.includes(t.name))
    .map((t) => (readOnly.has(t.name) || NO_CARD.has(t.name) || t.name === 'app_action' ? t : {
      ...t,
      run: (a: Record<string, unknown>) => {
        const tell = (out: unknown): unknown => { announce(o.file, { at: now().toISOString(), kind: 'record', tool: t.name, summary: `${t.name} ${JSON.stringify(a)}`.slice(0, 200) }); return out }
        const out = t.run(a)
        return out instanceof Promise ? out.then(tell) : tell(out)
      },
    }))
}
