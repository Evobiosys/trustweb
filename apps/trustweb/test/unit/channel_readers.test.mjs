// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { channelsFor, mayRead, nextReaders, ownChannels, scrubFor, setProvider } from '../../src/channel_readers.ts'
import { buildRequest } from '../../src/llm_endpoint.ts'

const ch = (readers, extra = {}) => ({ id: 'x', value: 'a@b.c', readers, ...extra })
const ai = (provider) => ({ kind: 'ai', provider })

describe('mayRead', () => {
  it('humans-only hides from every AI, never from a human', () => {
    for (const p of ['openai', 'claude', 'ollama', 'pc24', 'custom', 'tw-subscription']) expect(mayRead(ch('humans'), ai(p))).toBe(false)
    expect(mayRead(ch('humans'), { kind: 'human' })).toBe(true)
  })
  it('private-ai allows pc24/ollama/tw-subscription, denies openai/claude unless allowed', () => {
    for (const p of ['pc24', 'ollama', 'tw-subscription']) expect(mayRead(ch('private-ai'), ai(p))).toBe(true)
    expect(mayRead(ch('private-ai'), ai('openai'))).toBe(false)
    expect(mayRead(ch('private-ai'), ai('claude'))).toBe(false)
    expect(mayRead(ch('private-ai', { aiAllow: ['claude'] }), ai('claude'))).toBe(true)
  })
  it('all-ai allows all; aiDeny beats it and beats aiAllow', () => {
    expect(mayRead(ch('all-ai'), ai('openai'))).toBe(true)
    expect(mayRead(ch('all-ai', { aiDeny: ['openai'] }), ai('openai'))).toBe(false)
    expect(mayRead(ch('all-ai', { aiAllow: ['openai'], aiDeny: ['openai'] }), ai('openai'))).toBe(false)
  })
})

describe('channelsFor / ownChannels / nextReaders / setProvider', () => {
  const s = {
    me: { id: 'm', displayName: 'J', primaryEmail: { provider: 'proton', address: 'me@proton.me' }, otherEmails: ['j@ik.me'] },
    myChannels: { signal: '+4312345' },
    channelReaders: { 'email:j@ik.me': { readers: 'private-ai' } },
  }
  it('defaults to humans and filters per reader', () => {
    const all = ownChannels(s)
    expect(all.map((c) => [c.id, c.readers])).toEqual([['email:me@proton.me', 'humans'], ['email:j@ik.me', 'private-ai'], ['signal', 'humans']])
    expect(channelsFor(all, ai('pc24')).map((c) => c.value)).toEqual(['j@ik.me'])
    expect(channelsFor(all, ai('openai'))).toEqual([])
    expect(channelsFor(all, { kind: 'human' })).toHaveLength(3)
  })
  it('cycles humans -> private-ai -> all-ai -> humans', () => {
    expect(nextReaders('humans')).toBe('private-ai')
    expect(nextReaders('private-ai')).toBe('all-ai')
    expect(nextReaders('all-ai')).toBe('humans')
  })
  it('setProvider makes mayRead match the tick', () => {
    for (const readers of ['private-ai', 'all-ai']) for (const p of ['claude', 'pc24']) for (const on of [true, false]) {
      const c = { readers, ...setProvider({ readers }, p, on) }
      expect(mayRead(c, ai(p))).toBe(on)
      const again = { readers, ...setProvider(c, p, !on) }
      expect(mayRead(again, ai(p))).toBe(!on)
    }
  })
})

describe('request builder', () => {
  const own = [ch('humans', { value: 'secret@proton.me' }), ch('private-ai', { value: 'j@ik.me' })]
  const cfg = { preset: 'openai', baseUrl: 'https://x/v1', apiKey: '', model: 'm' }
  const body = (c, text) => JSON.parse(buildRequest(c, text, 'sys', 300, own).init.body).messages[1].content
  it('never sends a humans-only email to any model', () => {
    expect(body(cfg, 'write to secret@proton.me')).toBe('write to [hidden]')
    expect(body({ ...cfg, preset: 'pc24' }, 'write to secret@proton.me')).toBe('write to [hidden]')
  })
  it('private AIs get private-ai channels, others do not', () => {
    expect(body({ ...cfg, preset: 'pc24' }, 'j@ik.me')).toBe('j@ik.me')
    expect(body(cfg, 'j@ik.me')).toBe('[hidden]')
  })
  it('scrubFor leaves text without channels alone', () => { expect(scrubFor('hello', own, 'openai')).toBe('hello') })
  it('an address typed in other letter case is hidden too (review)', () => {
    expect(body(cfg, 'mail Secret@Proton.ME now')).toBe('mail [hidden] now')
    expect(scrubFor('a.b', [ch('humans', { value: 'a.b' })], 'openai')).toBe('[hidden]')
    expect(scrubFor('axb', [ch('humans', { value: 'a.b' })], 'openai')).toBe('axb')
  })
})
