import test from 'node:test'
import assert from 'node:assert/strict'
import { AllowanceReason, CapReason, checkBeforeWrite, planFromConfig, sanityBytes, transcribeCharge, usageBody, usageOf, writeCap } from '../quota.mjs'
import { loadConfig } from '../config.mjs'

const plan = planFromConfig(loadConfig({}))
const rec = (id, seconds, bytes) => ({ id, seconds, bytes })

test('free plan numbers: 10 x 1 h equivalent, 200 MB, 3600 s and 30 MB per recording, 50 slots', () => {
  assert.equal(plan.equivalentRecordings, 10)
  assert.equal(plan.secondsLimit, 36000)
  assert.equal(plan.bytesLimit, 200_000_000)
  assert.equal(plan.maxSecondsPerRecording, 3600)
  assert.equal(plan.maxBytesPerRecording, 30_000_000)
  assert.equal(plan.maxRecordings, 50)
  // the byte budget covers 10 h of the app's 32 kbps speech (4000 B/s) with headroom
  assert.ok(plan.bytesLimit >= 10 * 3600 * 4000 * 1.3)
})

test('seconds allowance edges: the 10th hour fits, the 11th does not, a replace frees its own seconds', () => {
  const nine = Array.from({ length: 9 }, (_, i) => rec(`r${i}`, 3600, 1))
  assert.equal(checkBeforeWrite(plan, nine, 'new', 3600), null)
  const ten = [...nine, rec('r9', 3600, 1)]
  assert.deepEqual(checkBeforeWrite(plan, ten, 'new', 1), { reason: AllowanceReason.Seconds })
  assert.equal(checkBeforeWrite(plan, ten, 'r3', 3600), null)
  assert.equal(checkBeforeWrite(plan, ten.slice(1), 'new', 3600), null) // delete one, add one
})

test('slot cap is an anti-spam bound, separate from the allowance', () => {
  const fifty = Array.from({ length: 50 }, (_, i) => rec(`r${i}`, 1, 1))
  assert.deepEqual(checkBeforeWrite(plan, fifty, 'new', 1), { reason: AllowanceReason.Slots })
  assert.equal(checkBeforeWrite(plan, fifty, 'r7', 1), null)
})

test('byte allowance: a full account refuses before streaming; the cut-off is the smallest cap and names it', () => {
  const full = [rec('a', 100, 200_000_000)]
  assert.deepEqual(checkBeforeWrite(plan, full, 'b', 100), { reason: AllowanceReason.Bytes })
  const some = [rec('a', 100, 190_000_000)]
  assert.deepEqual(writeCap(plan, some, 'b', 3600, 1e12), { reason: CapReason.Account, bytes: 10_000_000 })
  assert.deepEqual(writeCap(plan, some, 'a', 3600, 1e12), { reason: CapReason.Recording, bytes: 30_000_000 }) // replacing frees its own bytes
  assert.deepEqual(writeCap(plan, [], 'b', 1, 1e12), { reason: CapReason.Sanity, bytes: sanityBytes(plan, 1) })
  assert.deepEqual(writeCap(plan, [], 'b', 3600, 5000), { reason: CapReason.Global, bytes: 5000 })
})

test('usage body: equivalent recordings with two decimals, limits, transcription counter', () => {
  const body = usageBody(plan, [rec('a', 1800, 10), rec('b', 1800, 20), rec('c', 450, 5)], 120)
  assert.equal(body.plan, 'free')
  assert.equal(body.used, 1.13) // 4050 s / 3600 = 1.125, shown with two decimals
  assert.equal(body.limit, 10)
  assert.equal(body.secondsUsed, 4050)
  assert.equal(body.bytesUsed, 35)
  assert.deepEqual(body.transcription, { secondsUsed: 120, secondsLimit: 36000 })
  assert.deepEqual(usageOf([]), { seconds: 0, bytes: 0, count: 0 })
})

test('transcribe charge never drops below what the bytes imply at 48 kbps', () => {
  assert.equal(transcribeCharge(60, 60 * 4000), 60)
  assert.equal(transcribeCharge(1, 600000), 100)
  assert.equal(transcribeCharge(3600, 21_600_000), 3600)
})
