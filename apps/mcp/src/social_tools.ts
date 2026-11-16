// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c social-hosting (POLICY P02, MCP parity): the global profile, directory search, hosting, trusted-only mode and per-person trust overrides as
 * tools over the record file. The same switches the settings registry holds (settings_set reaches them too). The MCP process has no friends channel, so
 * directory_search asks the chosen servers only, and never while trusted-only is on. The app publishes a changed profile when it next runs.
 */
import { verifyDid } from '../../../services/trustweb-backup/directory.mjs'
import { newest, normName } from '../../trustweb/src/name_record.ts'
import { readSetting, writeSetting, type Rec } from '../../trustweb/src/settings_registry.ts'
import { isTrusted, setTrustOverride, trustLabel, trustedOnly } from '../../trustweb/src/trust_mode.ts'
import type { Tool } from './protocol.ts'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

type Fetch = (url: string) => Promise<{ status: number; json: () => Promise<unknown> }>
const schema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false })
const bool = (v: unknown): boolean => { if (typeof v !== 'boolean') throw new Error('on must be true or false'); return v }
const need = (v: unknown, what: string): string => { if (typeof v !== 'string' || !v.trim()) throw new Error(`${what} is required`); return v.trim() }
const verify = (did: string, bytes: Uint8Array, sig: string): boolean => verifyDid(did, Buffer.from(bytes), sig)

export function socialTools(o: { file: string; write: boolean; apiBase?: string; fetch?: Fetch }): Tool[] {
  const load = (): Rec => JSON.parse(readFileSync(o.file, 'utf8')) as Rec
  const save = (r: Rec): void => { const tmp = o.file + '.tmp'; writeFileSync(tmp, JSON.stringify(r)); renameSync(tmp, o.file) }
  /** Change the record through the registry (same validation as settings_set) and return the stored values. */
  const apply = (changes: [string, unknown][]): Rec => { const r = load(); for (const [id, v] of changes) writeSetting(r, id, v); save(r); return r }
  const names = (r: Rec): { first: string; last: string } => {
    const words = String((r.me as { displayName?: string } | undefined)?.displayName ?? '').trim().split(/\s+/).filter(Boolean)
    return { first: words[0] ?? '', last: words.slice(1).join(' ') }
  }

  const read: Tool[] = [{
    name: 'directory_search',
    description: 'Find someone by first and last name (case-insensitive, exact name) in the directory of the chosen server(s). Hits are claims by a key owner, not yet connected. Refused while "only through people I trust" is on.',
    inputSchema: schema({ first: { type: 'string' }, last: { type: 'string' } }, ['first', 'last']),
    run: async (a) => {
      const first = typeof a.first === 'string' ? a.first.trim() : ''
      const last = typeof a.last === 'string' ? a.last.trim() : ''
      if (!first || !last) throw new Error('first and last name are required')
      const r = load()
      if (trustedOnly(r)) return { via: null, records: [], blocked: 'trusted_only' }
      const servers = (Array.isArray(r.directoryServers) ? (r.directoryServers as string[]) : []).length ? (r.directoryServers as string[]) : [o.apiBase || 'https://app.trustweb.one']
      const fetchFn: Fetch = o.fetch ?? (globalThis.fetch as unknown as Fetch)
      const name = normName(first, last)
      const answers = await Promise.all(servers.map(async (s) => {
        try { const res = await fetchFn(`${s}/directory?q=${encodeURIComponent(name)}`); const j = (await res.json()) as { records?: unknown[] }; return res.status === 200 && Array.isArray(j.records) ? j.records : [] } catch { return [] }
      }))
      const all = answers.flat()
      const keys = [...new Set(all.map((x) => (x as { key?: unknown })?.key).filter((k): k is string => typeof k === 'string'))]
      const known = new Set([...(Array.isArray(r.people) ? (r.people as { globalKey?: string }[]).map((p) => p.globalKey) : []), ...(Array.isArray(r.peers) ? (r.peers as { did?: string }[]).map((p) => p.did) : [])])
      const records = keys.flatMap((k) => newest(all.filter((x) => (x as { key?: unknown })?.key === k), verify) ?? []).filter((x) => normName(x.first, x.last) === name)
        .map((x) => ({ first: x.first, last: x.last, key: x.key, open: x.open, connected: known.has(x.key) }))
      return { via: 'server', records }
    },
  }]

  const write: Tool[] = [
    {
      name: 'profile_discoverable_set', description: '"Discoverable by name" on or off (off by default). On needs a first and a last name in your profile name. open sets the "open to connect" flag.',
      inputSchema: schema({ on: { type: 'boolean' }, open: { type: 'boolean', description: 'default: unchanged (true)' } }, ['on']),
      run: (a) => {
        const on = bool(a.on)
        if (on && !names(load()).last) throw new Error('discoverable needs a first and last name: set your profile name to two words first')
        const r = apply([['profile.discoverable', on], ...(a.open === undefined ? [] : [['profile.openToConnect', bool(a.open)] as [string, unknown]])])
        return { discoverable: readSetting(r, 'profile.discoverable'), open: readSetting(r, 'profile.openToConnect'), servers: !trustedOnly(r) }
      },
    },
    {
      name: 'hosting_set', description: '"Host my friends\' names": off, closest (default) or close (Closest and Close).',
      inputSchema: schema({ mode: { type: 'string', enum: ['off', 'closest', 'close'] } }, ['mode']),
      run: (a) => {
        if (a.mode !== 'off' && a.mode !== 'closest' && a.mode !== 'close') throw new Error('mode must be off, closest or close')
        return { mode: readSetting(apply([['hosting.friends', a.mode]]), 'hosting.friends') }
      },
    },
    {
      name: 'trusted_only_set', description: '"Only through people I trust (no servers)": no directory, no server fallback; trust = Closest and Close plus your overrides.',
      inputSchema: schema({ on: { type: 'boolean' } }, ['on']),
      run: (a) => ({ trustedOnly: readSetting(apply([['trust.only', bool(a.on)]]), 'trust.only') }),
    },
    {
      name: 'trust_override_set', description: 'Mark one person trusted, not trusted, or back to the default (their ring decides: Closest and Close are trusted).',
      inputSchema: schema({ personId: { type: 'string' }, trust: { type: 'string', enum: ['trusted', 'not', 'default'] } }, ['personId', 'trust']),
      run: (a) => {
        const id = need(a.personId, 'personId')
        const r = load()
        const person = (Array.isArray(r.people) ? (r.people as { id: string; ring: string; trust?: 'yes' | 'no' }[]) : []).find((p) => p.id === id)
        if (!person) throw new Error(`no such person: ${id}`)
        setTrustOverride(person, String(a.trust))
        save(r)
        return { personId: id, trust: String(a.trust), ...trustLabel(person), trusted: isTrusted(person) }
      },
    },
  ]
  return [...read, ...(o.write ? write : [])]
}
