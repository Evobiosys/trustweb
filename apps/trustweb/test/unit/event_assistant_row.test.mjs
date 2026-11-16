// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-ask-placement-3: the optional "Draft with assistant" row of the event editor. */
/** @vitest-environment jsdom */
import { eventAssistantRow, eventAssistantText } from '../../src/event_assistant_row.ts'
import { S } from '../../src/strings.ts'

describe('event_assistant_row', () => {
  it('builds the prefill from what is typed so far, skipping empty fields', () => {
    const t = eventAssistantText({ name: 'Garden day', from: '2026-12-01', where: '', description: 'Plant trees' })
    expect(t).toContain('Garden day')
    expect(t).toContain('2026-12-01')
    expect(t).toContain('Plant trees')
    expect(t).not.toContain('undefined')
  })
  it('is a button that opens the assistant with the event context when AI is configured', () => {
    const open = vi.fn()
    const row = eventAssistantRow({ name: 'Garden day' }, { ready: () => true, open })
    const btn = row.querySelector('button[data-editor-assistant]')
    expect(btn).not.toBeNull()
    expect(btn.textContent).toBe(S.w44ap3.row)
    btn.click()
    expect(open).toHaveBeenCalledWith(expect.stringContaining('Garden day'))
  })
  it('shows only a small greyed hint, no button, when no AI is configured (P7)', () => {
    const open = vi.fn()
    const row = eventAssistantRow({}, { ready: () => false, open })
    expect(row.querySelector('button')).toBeNull()
    expect(row.querySelector('.opt-min')?.textContent).toBe(S.w44ap3.hint)
    expect(open).not.toHaveBeenCalled()
  })
})
