/**
 * Record default by origin (src/record_origin.ts, owner 2026-10-06): Inventory
 * and Meet open a meeting, Web opens "Just me", anything else follows Settings.
 */
import { DefaultRecording } from '../../src/model.ts'
import { RecordOrigin, recordModeFor } from '../../src/record_origin.ts'

describe('recordModeFor', () => {
  const both = [DefaultRecording.Solo, DefaultRecording.Meeting]
  it('from Inventory: a meeting, whatever Settings says', () => {
    for (const d of both) expect(recordModeFor(RecordOrigin.Inventory, d)).toBe(DefaultRecording.Meeting)
  })
  it('from the QR / Meet code: a meeting, whatever Settings says', () => {
    for (const d of both) expect(recordModeFor(RecordOrigin.Meet, d)).toBe(DefaultRecording.Meeting)
  })
  it('from Web: just me, whatever Settings says', () => {
    for (const d of both) expect(recordModeFor(RecordOrigin.Web, d)).toBe(DefaultRecording.Solo)
  })
  it('from anywhere else: the Settings default', () => {
    for (const d of both) expect(recordModeFor(RecordOrigin.Other, d)).toBe(d)
  })
})
