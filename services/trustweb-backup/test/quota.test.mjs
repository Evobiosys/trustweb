import test from 'node:test'
import assert from 'node:assert/strict'
import { AllowanceReason, CapReason, checkBeforeWrite, planFromConfig, sanityBytes, transcribeCharge, usageBody, usageOf, writeCap } from '../quota.mjs'
import { loadConfig } from '../config.mjs'

const plan = planFromConfig(loadConfig({}))
const rec = (id, seconds, bytes) => ({ id, seconds, bytes })

test('free plan numbers: 10 recordings (the allowance), guards of 36000 s and 1 GB, 3600 s and 30 MB per recording', () => {
  assert.equal(plan.maxRecordings, 10)
  assert.equal(plan.secondsLimit, 36000)
  assert.equal(plan.bytesLimit, 1_000_000_000)
  assert.equal(plan.maxSecondsPerRecording, 3600)
  assert.equal(plan.maxBytesPerRecording, 30_000_000)
  // the byte guard is a backstop: the real per-account ceiling is the recording count times the per-recording cap
  assert.ok(plan.maxRecordings * plan.maxBytesPerRecording < plan.bytesLimit)
  // and the seconds guard cannot be reached by 10 recordings of at most 1 h each
  assert.equal(plan.maxRecordings * plan.maxSecondsPerRecording, plan.secondsLimit)
})

test('recording allowance edges: the 10th fits, the 11th does not (reason recordings), a replace never counts', () => {
  const nine = Array.from({ length: 9 }, (_, i) => rec(`r${i}`, 3600, 1))
  assert.equal(checkBeforeWrite(plan, nine, 'new', 3600), null)
  const ten = [...nine, rec('r9', 3600, 1)]
  assert.deepEqual(checkBeforeWrite(plan, ten, 'new', 1), { reason: AllowanceReason.Recordings })
  assert.equal(checkBeforeWrite(plan, ten, 'r3', 3600), null)
  assert.equal(checkBeforeWrite(plan, ten.slice(1), 'new', 3600), null) // delete one, add one
})

test('an account above the limit (the limit was lowered) can replace but not add', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => rec(`r${i}`, 60, 1))
  assert.deepEqual(checkBeforeWrite(plan, twelve, 'new', 1), { reason: AllowanceReason.Recordings })
  assert.equal(checkBeforeWrite(plan, twelve, 'r7', 60), null)
})

test('seconds guard (recording cap raised): 36000 declared seconds in all, a replace frees its own seconds', () => {
  const wide = planFromConfig(loadConfig({ maxRecordings: 50 }))
  const nine = Array.from({ length: 9 }, (_, i) => rec(`r${i}`, 3600, 1))
  assert.equal(checkBeforeWrite(wide, nine, 'new', 3600), null)
  const ten = [...nine, rec('r9', 3600, 1)]
  assert.deepEqual(checkBeforeWrite(wide, ten, 'new', 1), { reason: AllowanceReason.Seconds })
  assert.equal(checkBeforeWrite(wide, ten, 'r3', 3600), null)
})

test('byte allowance: a full account refuses before streaming; the cut-off is the smallest cap and names it', () => {
  const full = [rec('a', 100, 1_000_000_000)]
  assert.deepEqual(checkBeforeWrite(plan, full, 'b', 100), { reason: AllowanceReason.Bytes })
  const some = [rec('a', 100, 990_000_000)]
  assert.deepEqual(writeCap(plan, some, 'b', 3600, 1e12), { reason: CapReason.Account, bytes: 10_000_000 })
  assert.deepEqual(writeCap(plan, some, 'a', 3600, 1e12), { reason: CapReason.Recording, bytes: 30_000_000 }) // replacing frees its own bytes
  assert.deepEqual(writeCap(plan, [], 'b', 1, 1e12), { reason: CapReason.Sanity, bytes: sanityBytes(plan, 1) })
  assert.deepEqual(writeCap(plan, [], 'b', 3600, 5000), { reason: CapReason.Global, bytes: 5000 })
})

test('usage body: recordings are the primary number (used of limit), hours stay in the seconds fields, transcription counter', () => {
  const body = usageBody(plan, [rec('a', 1800, 10), rec('b', 1800, 20), rec('c', 450, 5)], 120)
  assert.equal(body.plan, 'free')
  assert.equal(body.used, 3) // recordings held, not hours
  assert.equal(body.limit, 10)
  assert.equal(body.recordings, 3)
  assert.equal(body.maxRecordings, body.limit) // one number, not two that can drift
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
