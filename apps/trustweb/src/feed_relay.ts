// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The only network code of the group feed (feed_nostr.ts): publish signed events
 * to a relay and read a group's posts back. Called only for a relay the person
 * typed in Settings > Feed; with none set nothing here runs.
 */
import { Relay } from '../../demo/src/nostr_lib'
import { groupTag, parseGroupPost } from './feed_nostr'
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

/** Posts of these groups (our ids) as the relay holds them; [] when it is unreachable. */
export async function readGroups(url: string, groups: readonly string[]): Promise<ParsedPost[]> {
  if (!groups.length) return []
  try {
    const relay = await Relay.connect(url)
    return await new Promise<ParsedPost[]>((resolve) => {
      const found: ParsedPost[] = []
      const done = (): void => { sub.close(); relay.close(); resolve(found) }
      const sub = relay.subscribe([{ kinds: [9], '#h': groups.map(groupTag), limit: 50 }], {
        onevent: (e) => { const p = parseGroupPost(e); if (p) found.push(p) },
        oneose: done,
      })
      setTimeout(done, TIMEOUT_MS)
    })
  } catch { return [] }
}
