// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 ai-edit-chat: what the assistant's model sends back (actions as JSON) and the streaming reader (src/ext/assistant/protocol.ts). */
import { createActions } from '../../src/actions.ts'
import { parseAssistantReply, visibleText, createSseReader, systemPrompt, mentionedPeople, BLOCK } from '../../src/ext/assistant/protocol.ts'

function reg() {
  const a = createActions()
  a.define({ type: 'set-look', doc: 'Changes the look.', shape: '{"look": "default"|"sleek"|"dex"}', parse: (x) => { if (!['default', 'sleek', 'dex'].includes(x.look)) throw new Error('look must be one of default, sleek, dex'); return { look: x.look } }, label: (x) => `Look: ${x.look}`, apply: () => () => {} })
  return a
}

const reply = (body) => `Sure, I switch the look.\n\n\`\`\`${BLOCK}\n${body}\n\`\`\`\nTell me if you like it.`

describe('parseAssistantReply', () => {
  it('reads the block: valid actions, prose without the block, done flag', () => {
    const r = parseAssistantReply(reply('{"actions":[{"type":"set-look","args":{"look":"sleek"},"why":"denser"}],"done":true}'), reg().check)
    expect(r.actions.map((x) => x.label)).toEqual(['Look: sleek'])
    expect(r.actions[0].why).toBe('denser')
    expect(r.rejected).toEqual([])
    expect(r.done).toBe(true)
    expect(r.say).toBe('Sure, I switch the look.\n\nTell me if you like it.')
  })

  it('a bare array works too; done defaults to false', () => {
    const r = parseAssistantReply(reply('[{"type":"set-look","args":{"look":"dex"}}]'), reg().check)
    expect(r.actions).toHaveLength(1)
    expect(r.done).toBe(false)
  })

  it('rejects unknown actions and bad args, keeps the good ones', () => {
    const r = parseAssistantReply(reply('[{"type":"delete-everything","args":{}},{"type":"set-look","args":{"look":"neon"}},{"type":"set-look","args":{"look":"dex"}}]'), reg().check)
    expect(r.actions.map((x) => x.label)).toEqual(['Look: dex'])
    expect(r.rejected.map((x) => x.error)).toEqual(['unknown action: delete-everything', 'set-look: look must be one of default, sleek, dex'])
  })

  it('a block that is not JSON is one rejection, never a throw', () => {
    const r = parseAssistantReply(reply('{oops'), reg().check)
    expect(r.actions).toEqual([])
    expect(r.rejected).toEqual([{ error: 'the action block is not JSON' }])
  })

  it('no block: prose only; <think> is dropped', () => {
    const r = parseAssistantReply('<think>hmm</think>Just words.', reg().check)
    expect(r).toEqual({ say: 'Just words.', actions: [], rejected: [], done: false })
  })

  it('caps the number of actions in one reply at 50', () => {
    const many = JSON.stringify(Array.from({ length: 60 }, () => ({ type: 'set-look', args: { look: 'dex' } })))
    const r = parseAssistantReply(reply(many), reg().check)
    expect(r.actions).toHaveLength(50)
    expect(r.rejected).toEqual([{ error: 'more than 50 actions in one reply: the rest were left out' }])
  })
})

describe('visibleText while streaming', () => {
  it('hides a finished block and an unfinished one', () => {
    expect(visibleText(reply('[]'))).toBe('Sure, I switch the look.\n\nTell me if you like it.')
    expect(visibleText(`Working on it.\n\`\`\`${BLOCK}\n[{"type":`)).toBe('Working on it.')
    expect(visibleText('<think>x')).toBe('')
  })
})

describe('SSE reader', () => {
  it('joins deltas across chunk borders and stops at [DONE]', () => {
    const r = createSseReader()
    const out = [
      ...r.push('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choi'),
      ...r.push('ces":[{"delta":{"content":"lo"}}]}\n\n: keep-alive\n\n'),
      ...r.push('data: [DONE]\n\n'),
      ...r.push('data: {"choices":[{"delta":{"content":"late"}}]}\n\n'),
    ]
    expect(out).toEqual(['Hel', 'lo'])
    expect(r.done()).toBe(true)
  })

  it('ignores lines that are not JSON and deltas without content', () => {
    const r = createSseReader()
    expect(r.push('data: nope\n\ndata: {"choices":[{"delta":{"role":"assistant"}}]}\r\n\r\n')).toEqual([])
  })
})

describe('systemPrompt', () => {
  it('lists every action, the block format and where the person is; no e-mail or phone', () => {
    const a = reg()
    const p = systemPrompt({
      specs: a.specs(), where: 'Settings', profile: 'full', look: 'default', variations: ['full', 'reader'], modules: ['feed'],
      recent: ['user: Look: dex'], places: ['web', 'settings'],
      rows: [{ key: 'k1', name: 'Ada', labels: ['iyg'], ring: 'friend', emails: ['ada@example.org'], phones: ['+43 1'] }],
      people: [{ id: 'p1', name: 'Bo', ring: 'close', tags: ['iyg'] }],
    })
    expect(p).toContain('set-look')
    expect(p).toContain(BLOCK)
    expect(p).toContain('Settings')
    expect(p).toContain('k1')
    expect(p).toContain('p1')
    expect(p).not.toContain('ada@example.org')
    expect(p).not.toContain('+43 1')
  })
})

describe('mentionedPeople', () => {
  it('finds people whose name the message names, at most max', () => {
    const people = [{ id: 'a', name: 'Ada Lovelace' }, { id: 'b', name: 'Bo Tester' }, { id: 'c', name: 'Cy' }]
    expect(mentionedPeople(people, 'tag ada and bo tester please', 5).map((p) => p.id)).toEqual(['a', 'b'])
    expect(mentionedPeople(people, 'nobody here', 5)).toEqual([])
    expect(mentionedPeople(people, 'ada bo', 1)).toHaveLength(1)
  })
})
