/** The plain reminder shown (never a block) when someone goes onto "intending to connect" and a way to reach them, or a message, already exists. */
import { ChatDirection } from './chat'
import type { ChatThread } from './chat'
import { CHANNELS } from './model'
import type { Person } from './model'
import { S } from './strings'

/** Tana's Email field on a person (apps/crm person_fields). */
export const EMAIL_FIELD = 'Bxw7k4FWptqp'

/** The ways to reach someone already on this phone: email, phone, and the messengers typed or shared; `points` are the Curator's email / phone entries. */
export function knownWays(p: Pick<Person, 'channels' | 'theirChannels' | 'fields'>, points: readonly { kind: string }[] = []): string[] {
  const kinds = new Set(points.map((x) => x.kind))
  return [
    ...(kinds.has('email') || p.fields?.[EMAIL_FIELD] ? ['email'] : []),
    ...(kinds.has('phone') ? ['phone'] : []),
    ...CHANNELS.filter((c) => p.channels?.[c] || p.theirChannels?.[c]).map((c) => S.chLabel[c]),
  ]
}

/** When I last wrote to them in this app's chat (0: never). */
export function lastMessagedAt(thread: ChatThread | undefined): number {
  return Math.max(0, ...(thread?.messages ?? []).filter((m) => m.dir === ChatDirection.Out).map((m) => m.at))
}

/** The lines to show; none when neither is true. `messagedAt` 0 = never. */
export function intendingReminder(name: string, ways: readonly string[], messagedAt: number): string[] {
  return [
    ...(ways.length > 0 ? [S.alreadyHaveDetails(name, ways.join(' / '))] : []),
    ...(messagedAt > 0 ? [S.alreadyMessaged(name, new Date(messagedAt).toISOString().slice(0, 10))] : []),
  ]
}
