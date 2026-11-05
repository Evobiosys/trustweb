/**
 * The Feed (wave 1733 round B, item 1; Jakob 16:08): "posts", built ONLY from
 * what this phone already received or holds:
 *   - lines people in your web shared with you in answers to your asks,
 *   - meetings people sent you inside TrustWeb (and kept meetings from others),
 *   - notes people shared with you through their code after a meeting,
 *   - what you share yourself (inventory lines your web can ask about),
 * plus, where the person switched it on, public fediverse posts (fediverse.ts,
 * merged in by the view). Nothing is sent to build it: pure, no network, no
 * relay (test/unit/feed.test.mjs proves it). "Things marked for everyone in a
 * ring" have no carrier in the protocol yet (asks go to direct peers only), so
 * there is nothing of that kind to show; the roadmap has it.
 */
import { isDemoItem, isDemoPerson, Provenance } from './model'
import type { AppState } from './model'
import { showsUnmatched } from './unmatched_asks'

export enum PostKind {
  /** A line someone shared with you in an answer. */
  Answer = 'answer',
  /** A meeting someone sent you. */
  Meeting = 'meeting',
  /** Notes someone shared with you through their code. */
  Note = 'note',
  /** Something you share with your web. */
  Mine = 'mine',
  /** A public post from someone's Mastodon or Pixelfed. */
  Remote = 'remote',
  /** A post to a group you are in (feed_sources.ts). */
  Group = 'group',
  /** An item of a feed you follow: an account or hashtag on the fediverse, or the news feed (feed_sources.ts). */
  Follow = 'follow',
  /** An ask addressed to you. */
  Ask = 'ask',
}

/** The chips: one stream, grouped by where an item comes from. */
export enum FeedSource {
  Web = 'web',
  Group = 'group',
  Fediverse = 'fediverse',
  News = 'news',
  Ask = 'ask',
}

/** What tapping a post opens. */
export type PostTarget =
  | { kind: 'person'; personId: string }
  | { kind: 'item'; itemId: string }
  | { kind: 'share'; receivedId: string }
  | { kind: 'meeting'; meetingId: string }
  | { kind: 'url'; url: string }
  | { kind: 'none' }

export interface Post {
  id: string
  kind: PostKind
  /** Who: a name, or null for yourself. */
  who: string | null
  personId?: string
  at: number
  text: string
  /** A second line: the question it answered, the item's context, where a meeting was. */
  context?: string
  provenance?: Provenance
  dummy: boolean
  /** A picture kept on this phone (image_store.ts). */
  imageId?: string
  /** A remote picture (fediverse; only loaded where pictures are switched on). */
  imageUrl?: string
  open: PostTarget
  /** Group posts: the group chip id (`tag:<id>` or `event:<id>`). */
  group?: string
  /** Followed items: the news feed rather than the fediverse. */
  news?: boolean
  /** Group posts: the channel id inside the group. */
  channel?: string
  /** Group posts: discussion, request, offer or event (feed_nostr.ts). */
  type?: string
  /** Group posts: no relay took it (it stays on this phone). */
  unsent?: boolean
}

/** At most this many posts. */
export const FEED_MAX = 150

function personByName(s: AppState, name: string): string | undefined {
  const n = name.trim().toLowerCase()
  return s.people.find((p) => p.name.toLowerCase() === n)?.id
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * The person an answer came from: by the peer that sent it (a name inside the
 * answer is the sender's own claim, review-app-b); only finds saved before the
 * peer was kept (demo accounts) fall back to the name.
 */
function answerPerson(s: AppState, sh: { from?: unknown; peerId?: unknown }): string | undefined {
  if (typeof sh.peerId === 'string') return s.people.find((p) => p.peerId === sh.peerId)?.id
  return sh.from ? personByName(s, str(sh.from)) : undefined
}

function answers(s: AppState): Post[] {
  return (Array.isArray(s.found) ? s.found : []).flatMap((f) => (f && Array.isArray(f.shared) ? f.shared : []).flatMap((sh, j) => {
    if (!sh || typeof sh !== 'object') return []
    const personId = answerPerson(s, sh)
    const who = (personId ? s.people.find((p) => p.id === personId)?.name : undefined) ?? str(sh.from)
    return (Array.isArray(sh.items) ? sh.items : []).flatMap((it, k): Post[] => (it && typeof it.text === 'string' ? [{
      id: `answer:${f.id}:${j}:${k}`, kind: PostKind.Answer, who, personId, at: Number(f.at) || 0, text: it.text, context: str(f.text),
      provenance: Provenance.SharedByPerson, dummy: Boolean(personId && isDemoPerson(s, personId)),
      open: personId ? { kind: 'person', personId } : { kind: 'none' },
    }] : []))
  }))
}

/** Meetings sent to you: each share once (opening the kept meeting where it was kept), and meetings kept from a Meet code. */
function meetings(s: AppState): Post[] {
  const received = Array.isArray(s.received) ? s.received : []
  const stored = Array.isArray(s.meetings) ? s.meetings : []
  const keptIds = new Set(received.map((r) => r.keptAs).filter((id): id is string => typeof id === 'string'))
  const fromShares = received.map((r): Post => {
    const personId = personByName(s, r.fromName)
    const kept = r.keptAs ? stored.find((m) => m?.id === r.keptAs) : undefined
    return {
      id: `share:${r.id}`, kind: PostKind.Meeting, who: r.fromName, personId, at: r.at, text: r.title, context: kept?.where || undefined,
      provenance: Provenance.SharedByPerson, dummy: Boolean(personId && isDemoPerson(s, personId)),
      open: kept ? { kind: 'meeting', meetingId: kept.id } : { kind: 'share', receivedId: r.id },
    }
  })
  const fromCodes = stored.filter((m) => m?.fromName && !keptIds.has(m.id)).map((m): Post => ({
    id: `meeting:${m.id}`, kind: PostKind.Meeting, who: m.fromName ?? null, personId: m.personId, at: m.startedAt, text: m.about,
    context: m.where || undefined, provenance: Provenance.SharedByPerson, dummy: Boolean(m.personId && isDemoPerson(s, m.personId)),
    open: { kind: 'meeting', meetingId: m.id },
  }))
  return [...fromShares, ...fromCodes]
}

function sharedNotes(s: AppState): Post[] {
  return s.people.flatMap((p) => p.lines
    .filter((l) => l.status === 'current' && l.source?.kind === Provenance.SharedByPerson && l.source.fromName)
    .map((l): Post => ({
      id: `note:${p.id}:${l.id}`, kind: PostKind.Note, who: l.source?.fromName ?? p.name, personId: p.id, at: l.notedAt, text: l.text,
      provenance: Provenance.SharedByPerson, dummy: isDemoPerson(s, p.id), open: { kind: 'person', personId: p.id },
    })))
}

function mine(s: AppState): Post[] {
  return s.inventory
    .filter((i) => i.included && i.audience !== 'me')
    .map((i): Post => ({
      id: `mine:${i.id}`, kind: PostKind.Mine, who: null, at: i.createdAt, text: i.text, provenance: i.source?.kind,
      dummy: isDemoItem(s, i.id), ...(i.imageId ? { imageId: i.imageId } : {}), open: { kind: 'item', itemId: i.id },
    }))
}

/** Asks addressed to me (held for consent, and the ones that matched nothing here) as cards; this phone only, the answer moment stays in the stack. */
export function askPosts(s: AppState): Post[] {
  const held = (Array.isArray(s.heldAsks) ? s.heldAsks : []).map((a): Post => ({
    id: `ask:${a.qid}`, kind: PostKind.Ask, who: a.fromName, personId: s.people.find((p) => p.peerId === a.peerId)?.id, at: a.receivedAt, text: a.text, dummy: false, open: { kind: 'none' },
  }))
  const unmatched = showsUnmatched(s, Boolean(s.demo?.people?.length)) ? (Array.isArray(s.unmatchedAsks) ? s.unmatchedAsks : []).map((a): Post => ({
    id: `ask:${a.id}`, kind: PostKind.Ask, who: a.from, personId: s.people.find((p) => p.peerId === a.peerId)?.id, at: a.at, text: a.text, dummy: false, open: { kind: 'none' },
  })) : []
  return [...held, ...unmatched]
}

/** Which chip a post belongs to. */
export function sourceOf(p: Post): FeedSource {
  switch (p.kind) {
    case PostKind.Group: return FeedSource.Group
    case PostKind.Ask: return FeedSource.Ask
    case PostKind.Remote: return FeedSource.Fediverse
    case PostKind.Follow: return p.news ? FeedSource.News : FeedSource.Fediverse
    default: return FeedSource.Web
  }
}

/** The chips' filter: a source, and inside Groups one group. */
export function filterFeed(posts: readonly Post[], f: { source?: FeedSource; group?: string }): Post[] {
  return posts.filter((p) => (!f.source || sourceOf(p) === f.source) && (!f.group || p.group === f.group))
}

/** Every post this phone can show, newest first. Pure: reads the record, sends nothing. */
export function buildFeed(s: AppState, remote: readonly Post[] = []): Post[] {
  const all = [...answers(s), ...meetings(s), ...sharedNotes(s), ...mine(s), ...askPosts(s), ...remote]
  return all.filter((p) => p.text.trim()).sort((a, b) => b.at - a.at).slice(0, FEED_MAX)
}
