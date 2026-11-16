// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave44 answers-44b (Jakob item 3): a shared block or line of a resource goes out by link (the existing QR route), to a chat (the existing chat
 * send path: chat_view submitText, through the host) or to the Feed (the existing post path: feed_social addSocialPost). What travels is exactly
 * the projection (resource_blocks shareProjection) plus its back-reference (resource id + block id). The chat send is also an approval card for
 * MCP resource_share via:'chat' (POLICY P02). The host (main.ts) gives the record, the sheet and the send.
 */
import { el } from '../../demo/src/ui/dom'
import { str, type Actions } from './actions'
import { chatPickerRows } from './chat_list'
import type { ChatListPerson } from './chat_list'
import { addSocialPost } from './feed_social'
import type { AppState, InventoryItem, SocialPost } from './model'
import { shareMessage, shareProjection, shareRefTag, SHARE_SCOPES } from './resource_blocks'
import type { BlockShare, ShareScope, ShareVia } from './resource_blocks'
import { S } from './strings'

/** The Feed copy: the projection's text, tagged with its back-reference. Null: nothing to post. */
export const postShareToFeed = (s: AppState, p: BlockShare, now: number): SocialPost | null => addSocialPost(s, p.text, now, { tag: shareRefTag(p.ref) })

export interface ResShareHost {
  state(): AppState
  save(): void
  /** The existing QR / link route (main.ts qrPage with #item=…&ref=…). */
  link(p: BlockShare): void
  people(): ChatListPerson[]
  /** The chat send path (submitText): false when the chat cannot take the text (too long, too many waiting). */
  sendChat(personId: string, text: string): Promise<boolean>
  sheet(kids: Node[]): void
  closeSheet(): void
  toast(msg: string): void
}

/** The outline's share handler: link, chat (a picker of connected people) or feed. */
export function resourceShare(h: ResShareHost): (p: BlockShare, via: ShareVia) => void {
  const toChat = (p: BlockShare): void => {
    const rows = chatPickerRows(h.people()).filter((r) => r.connected)
    h.sheet([
      el('h3', {}, [S.resShare.pickTitle]),
      el('pre', { class: 'ol-share-text' }, [shareMessage(p)]),
      rows.length
        ? el('div', { class: 'ppl', 'data-res-share-picker': '' }, rows.map((r) => el('button', {
          class: 'prow', type: 'button', 'data-res-share-pick': r.personId,
          onclick: () => { h.closeSheet(); void h.sendChat(r.personId, shareMessage(p)).then((ok) => h.toast(ok ? S.resShare.sent(r.name) : S.resShare.notSent)) },
        }, [el('b', {}, [r.name])])))
        : el('p', { class: 'meta', 'data-res-share-none': '' }, [S.resShare.nobody]),
    ])
  }
  return (p, via) => {
    if (via === 'link') return h.link(p)
    if (via === 'chat') return toChat(p)
    if (!postShareToFeed(h.state(), p, Date.now())) return
    h.save()
    h.toast(S.resShare.posted)
  }
}

export interface ResShareActionHost {
  state(): Pick<AppState, 'inventory'>
  /** False for a protected resource (main.ts canShareOn). */
  canShare(item: InventoryItem): boolean
  sendChat(personId: string, text: string): Promise<boolean>
}

/** MCP resource_share via:'chat' lands here as an approval card: the projection goes to one person's chat. Cannot be taken back. */
export function defineResourceShareActions(reg: Actions, host: ResShareActionHost): void {
  reg.define<{ id: string; blockId: string; scope: ShareScope; person: string }>({
    type: 'resource-share-chat', doc: 'Sends one block (scope block = with its sub-blocks) or one line (scope line) of a resource to a connected person\'s chat, with its back-reference. Needs approval; cannot be taken back.',
    shape: '{"id": resource id, "blockId": id, "scope": "block"|"line", "person": person id}',
    parse: (a) => {
      const scope = str(a, 'scope', 10)!
      if (!(SHARE_SCOPES as readonly string[]).includes(scope)) throw new Error(`scope must be one of ${SHARE_SCOPES.join(', ')}`)
      return { id: str(a, 'id', 120)!, blockId: str(a, 'blockId', 120)!, scope: scope as ShareScope, person: str(a, 'person', 120)! }
    },
    label: (a) => S.resShare.card(a.scope),
    auto: false, undoable: false,
    apply: (a) => {
      const item = (host.state().inventory ?? []).find((i) => i.id === a.id)
      if (!item) throw new Error(`no resource "${a.id}"`)
      if (!host.canShare(item)) throw new Error('a protected resource cannot be shared')
      void host.sendChat(a.person, shareMessage(shareProjection(item, a.blockId, a.scope)))
    },
  })
}
