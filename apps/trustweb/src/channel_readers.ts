// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 36b: who may read each of the owner's own channels (email addresses, messenger handles). Pure, no DOM.
 * humans = only people; private-ai = AIs that run on the owner's machines or under the owner's contract; all-ai = any AI.
 * aiAllow / aiDeny refine this per provider; aiDeny always wins, and a humans-only channel never reaches any AI.
 */
import type { AppState } from './model'

export type Readers = 'humans' | 'private-ai' | 'all-ai'
export const READERS: readonly Readers[] = ['humans', 'private-ai', 'all-ai']

/** Provider ids as in Settings > Advanced > Your AI. */
export const AI_PROVIDERS = ['openai', 'claude', 'ollama', 'pc24', 'custom', 'tw-subscription'] as const
const PRIVATE_PROVIDERS: readonly string[] = ['ollama', 'pc24', 'tw-subscription']

export interface OwnChannel {
  /** 'email:<address>' or the messenger id. */
  id: string
  value: string
  readers: Readers
  aiAllow?: string[]
  aiDeny?: string[]
}

export interface ReaderSetting { readers?: Readers; aiAllow?: string[]; aiDeny?: string[] }

export type Reader = { kind: 'human' } | { kind: 'ai'; provider?: string }

export function mayRead(c: Pick<OwnChannel, 'readers' | 'aiAllow' | 'aiDeny'>, r: Reader): boolean {
  if (r.kind === 'human') return true
  const p = r.provider ?? ''
  if (c.readers === 'humans' || c.aiDeny?.includes(p)) return false
  if (c.readers === 'all-ai') return true
  return PRIVATE_PROVIDERS.includes(p) || Boolean(c.aiAllow?.includes(p))
}

export const channelsFor = (all: readonly OwnChannel[], r: Reader): OwnChannel[] => all.filter((c) => mayRead(c, r))

/** The next class when the chip is tapped: humans -> private AIs -> all AIs -> humans. */
export const nextReaders = (r: Readers): Readers => READERS[(READERS.indexOf(r) + 1) % READERS.length]

/** All the owner's channels with their reader settings (default: humans only). */
export function ownChannels(s: Pick<AppState, 'me' | 'myChannels' | 'channelReaders'>): OwnChannel[] {
  const raw: [string, string][] = [
    ...(s.me.primaryEmail ? [[`email:${s.me.primaryEmail.address}`, s.me.primaryEmail.address] as [string, string]] : []),
    ...(s.me.otherEmails ?? []).map((a): [string, string] => [`email:${a}`, a]),
    ...Object.entries(s.myChannels ?? {}).filter(([, v]) => v).map(([k, v]): [string, string] => [k, v as string]),
  ]
  return raw.map(([id, value]) => ({ id, value, ...s.channelReaders?.[id], readers: s.channelReaders?.[id]?.readers ?? 'humans' }))
}

const literal = (v: string): RegExp => new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')

/** The text with every channel value this provider may not read blanked out, in any letter case (the guard at the AI request builder). */
export function scrubFor(text: string, own: readonly OwnChannel[], provider: string): string {
  return own.filter((c) => !mayRead(c, { kind: 'ai', provider })).reduce((t, c) => t.replace(literal(c.value), '[hidden]'), text)
}

/** The allow / deny lists after the sheet ticks or unticks one provider, so that mayRead(provider) equals `on`. */
export function setProvider(c: Pick<OwnChannel, 'readers' | 'aiAllow' | 'aiDeny'>, provider: string, on: boolean): { aiAllow: string[]; aiDeny: string[] } {
  const allow = (c.aiAllow ?? []).filter((p) => p !== provider)
  const deny = (c.aiDeny ?? []).filter((p) => p !== provider)
  const byClass = mayRead({ readers: c.readers }, { kind: 'ai', provider })
  if (on && !byClass) allow.push(provider)
  if (!on && byClass) deny.push(provider)
  return { aiAllow: allow, aiDeny: deny }
}
