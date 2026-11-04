// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { GRACE_MS, HOVER_IDLE, hoverStep, nameEdit } from '../../src/ring_hover.ts'

const run = (...events) => events.reduce((s, e) => hoverStep(s, e), HOVER_IDLE)

describe('ring hover card (ring_hover.ts)', () => {
  it('grace is 250 ms', () => expect(GRACE_MS).toBe(250))
  it('opens on the handle and on the ring band', () => {
    expect(run({ type: 'enter-handle', ring: 'close' }).open).toBe('close')
    expect(run({ type: 'enter-ring', ring: 'friend' }).open).toBe('friend')
  })
  it('leaving starts the grace and closes only when it ends', () => {
    const s = run({ type: 'enter-handle', ring: 'close' }, { type: 'leave' })
    expect(s.open).toBe('close')
    expect(s.grace).toBe(true)
    expect(hoverStep(s, { type: 'grace-end' }).open).toBeNull()
  })
  it('entering the card inside the grace keeps it open', () => {
    const s = run({ type: 'enter-handle', ring: 'close' }, { type: 'leave' }, { type: 'enter-card' }, { type: 'grace-end' })
    expect(s.open).toBe('close')
  })
  it('leaving the card starts a new grace; the ring band re-entered cancels it', () => {
    const s = run({ type: 'enter-handle', ring: 'close' }, { type: 'enter-card' }, { type: 'leave' })
    expect(s.grace).toBe(true)
    expect(hoverStep(hoverStep(s, { type: 'enter-ring', ring: 'close' }), { type: 'grace-end' }).open).toBe('close')
  })
  it('handle to ring of another circle switches the card', () => {
    expect(run({ type: 'enter-handle', ring: 'close' }, { type: 'leave' }, { type: 'enter-ring', ring: 'friend' }, { type: 'grace-end' }).open).toBe('friend')
  })
  it('a stale grace-end without a leave does nothing', () => {
    expect(run({ type: 'enter-handle', ring: 'close' }, { type: 'grace-end' }).open).toBe('close')
  })
  it('esc closes at once', () => {
    expect(run({ type: 'enter-handle', ring: 'close' }, { type: 'enter-card' }, { type: 'esc' })).toEqual(HOVER_IDLE)
  })
})

describe('name edit in the card (ring_hover.ts)', () => {
  it('Enter or blur commits the new name', () => {
    expect(nameEdit('Peter', ' Pete ', 'save')).toEqual({ kind: 'commit', name: 'Pete' })
  })
  it('empty or unchanged cancels: the old name stays', () => {
    expect(nameEdit('Peter', '  ', 'save')).toEqual({ kind: 'cancel' })
    expect(nameEdit('Peter', 'Peter', 'save')).toEqual({ kind: 'cancel' })
  })
  it('Esc cancels whatever was typed', () => {
    expect(nameEdit('Peter', 'Pete', 'cancel')).toEqual({ kind: 'cancel' })
  })
})

import { ROW_VIEW, rowStep } from '../../src/ring_hover.ts'

describe('ring card row edit (rowStep)', () => {
  const edit = rowStep(ROW_VIEW, { type: 'open' })
  it('pencil opens the edit', () => expect(edit.editing).toBe(true))
  it('accept with a new name commits and closes', () => {
    const r = rowStep(edit, { type: 'accept', current: 'Ann', typed: ' Anna ' })
    expect(r.editing).toBe(false)
    expect(r.result).toEqual({ kind: 'commit', name: 'Anna' })
  })
  it('accept with empty or unchanged text closes without a rename', () => {
    expect(rowStep(edit, { type: 'accept', current: 'Ann', typed: 'Ann' }).result).toEqual({ kind: 'cancel' })
    expect(rowStep(edit, { type: 'accept', current: 'Ann', typed: '  ' }).result).toEqual({ kind: 'cancel' })
  })
  it('cancel closes', () => {
    const r = rowStep(edit, { type: 'cancel' })
    expect(r.editing).toBe(false)
    expect(r.result).toEqual({ kind: 'cancel' })
  })
  it('archive closes and asks to archive', () => {
    const r = rowStep(edit, { type: 'archive' })
    expect(r.editing).toBe(false)
    expect(r.result).toEqual({ kind: 'archive' })
  })
  it('blur is not an event: the edit stays open', () => expect(rowStep(edit, { type: 'blur' })).toBe(edit))
  it('accept/cancel/archive outside an edit do nothing', () => {
    expect(rowStep(ROW_VIEW, { type: 'cancel' })).toBe(ROW_VIEW)
  })
})
