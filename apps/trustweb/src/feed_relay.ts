// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The only network code of the group feed (feed_nostr.ts): publish signed events
 * to a relay and read a group's posts back. Called only for a relay the person
 * typed in Settings > Feed; with none set nothing here runs.
 */
import { Relay } from '../../demo/src/nostr_lib'
import { parseGroupPost, parseMembers } from './feed_nostr'
import type { NostrEvent, ParsedPost } from './feed_nostr'

const TIMEOUT_MS = 8000

/** True when the relay took every event. */
export async function publish(url: string, events: readonly NostrEvent[]): Promise<boolean> {
  try {
    const relay = await Relay.connect(url)
    try {
      await Promise.all(events.map((e) => relay.publish(e)))
      return true
    } finally { relay.close() }
  } catch { return false }
}

export interface RelayRead { posts: ParsedPost[]; members: Record<string, string[]> }

/** Posts and member lists (39002) of these relay group ids (h tags) as the relay holds them; empty when it is unreachable. */
export async function readGroups(url: string, tags: readonly string[]): Promise<RelayRead> {
  const found: RelayRead = { posts: [], members: {} }
  if (!tags.length) return found
  try {
    const relay = await Relay.connect(url)
    return await new Promise<RelayRead>((resolve) => {
      const done = (): void => { sub.close(); relay.close(); resolve(found) }
      const sub = relay.subscribe([{ kinds: [9], '#h': [...tags], limit: 50 }, { kinds: [39002], '#d': [...tags] }], {
        onevent: (e) => {
          if (e.kind === 39002) { const d = e.tags.find((x) => x[0] === 'd')?.[1]; if (d) found.members[d] = parseMembers(e) }
          else { const p = parseGroupPost(e); if (p) found.posts.push(p) }
        },
        oneose: done,
      })
      setTimeout(done, TIMEOUT_MS)
    })
  } catch { return found }
}
