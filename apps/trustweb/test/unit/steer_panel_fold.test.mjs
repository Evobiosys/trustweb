// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-panel-fold (ops-fix-in-pi): the fix button answers at once, the conflict brief fixes on the preview branch, long gate text folds. */
import { conflictBrief, conflictFiles, fixConflictRoute } from '../../dev_preview_rules.mjs'
import { hintParts } from '../../src/dev_preview_rules.ts'
import { fixButtonView, fixStatusLine } from '../../src/dev_fix_button.ts'
import { S } from '../../src/strings.ts'

describe('fix button: immediate feedback', () => {
  it('idle -> pressable "Fix it in a pi session"', () => {
    expect(fixButtonView(undefined)).toEqual({ label: S.panelFixSession, disabled: false, line: '', bad: false })
  })
  it('pressed -> "pi session starting now..." at once, disabled, no line yet', () => {
    expect(fixButtonView({ state: 'starting' })).toEqual({ label: S.w44fold.fixStarting, disabled: true, line: '', bad: false })
  })
  it('launched -> the session line; failed -> red line with the error, pressable again', () => {
    expect(fixButtonView({ state: 'launched', id: '4711' })).toEqual({ label: S.panelFixSession, disabled: true, line: S.panelFixLaunched('4711'), bad: false })
    expect(fixButtonView({ state: 'failed', error: 'Another pi session of this project is active' })).toEqual({ label: S.panelFixSession, disabled: false, line: 'Another pi session of this project is active', bad: true })
  })
  it('the toast text', () => {
    expect(S.w44fold.fixToast).toBe('pi session starting now')
    expect(S.w44fold.fixStarting).toBe('pi session starting now...')
  })
})

describe('panel status line the fix session writes (registry fixStatus)', () => {
  it('one line with key, text and time; nothing when absent', () => {
    expect(fixStatusLine({ fixStatus: { key: 'invite', text: 'resolved: abc1234, patch saved', at: '2026-11-16T18:05:00Z' } })).toMatch(/^pi fix invite: resolved: abc1234, patch saved \(\d\d:\d\d\)$/)
    expect(fixStatusLine({})).toBe('')
    expect(fixStatusLine({ fixStatus: { key: 'x' } })).toBe('')
  })
})

describe('Approve box: row detail folds under one "details"', () => {
  const wall = Array.from({ length: 6 }, (_, i) => `Row ${i}: a long description of what this row does: branch wave44/steer-r${i} moved to 0199d84, the catalogue says HEAD: update the catalogue row, then apply`).join('; ')
  it('a long blocked text: a short head, every reason one detail line', () => {
    const { head, detail } = hintParts(wall)
    expect(head).toBe('Blocked: 6 rows need attention')
    expect(detail.split('\n')).toHaveLength(6)
    expect(detail).toContain('wave44/steer-r5')
  })
  it('a long "Approve first" list folds behind its prefix; short hints stay whole', () => {
    const long = `Approve first: ${Array.from({ length: 12 }, (_, i) => `Feature title number ${i}`).join(', ')}`
    expect(hintParts(long)).toEqual({ head: 'Approve first', detail: long.slice('Approve first: '.length) })
    expect(hintParts('Approve first: T-a')).toEqual({ head: 'Approve first: T-a', detail: '' })
    expect(hintParts('Tests are running')).toEqual({ head: 'Tests are running', detail: '' })
  })
})

describe('conflict brief: the fix happens on the PREVIEW branch', () => {
  const mergeTree = 'treesha\n100644 1111111111111111111111111111111111111111 1\tapps/trustweb/src/main.ts\n100644 2222222222222222222222222222222222222222 2\tapps/trustweb/src/main.ts\n100644 3333333333333333333333333333333333333333 3\tapps/trustweb/src/strings.ts\n\nAuto-merging apps/trustweb/src/main.ts\nCONFLICT (content): Merge conflict in apps/trustweb/src/main.ts\nCONFLICT (content): Merge conflict in apps/trustweb/src/strings.ts\n'
  const args = { id: 'tw-261116_steer', key: 'steer-invite-link', branch: 'wave44/steer-invite-link', previewBranch: 'preview/-261116_steer', baseSha: '3effc790c', worktree: '/wt/preview-tw-261116_steer', mergeTree, devlog: '/o/trustweb-ops/DEVLOG/wave44' }
  const brief = conflictBrief(args)
  it('conflicting files from the merge-tree output, once each', () => {
    expect(conflictFiles(mergeTree)).toEqual(['apps/trustweb/src/main.ts', 'apps/trustweb/src/strings.ts'])
  })
  it('names preview id, worktree, preview branch, base sha, files, gates verbatim, model, escalation, report, patch and status line', () => {
    for (const part of [
      'tw-261116_steer', '/wt/preview-tw-261116_steer', 'preview/-261116_steer', '3effc790c', '- apps/trustweb/src/strings.ts',
      'git merge --no-ff wave44/steer-invite-link',
      'cd apps/trustweb && ../demo/node_modules/.bin/tsc --noEmit -p tsconfig.json',
      'cd apps/demo && node_modules/.bin/vitest run --config ../trustweb/test/unit/vitest.config.mjs --root ../trustweb',
      'preview tw-261116_steer: merge steer-invite-link (conflicts resolved)',
      '/* wave44 <slug> */',
      '/o/trustweb-ops/bin/preview tw-261116_steer save-resolution steer-invite-link',
      '/o/trustweb-ops/DEVLOG/wave44/conflicts/steer-invite-link.patch',
      '/o/trustweb-ops/DEVLOG/wave44/conflict-steer-invite-link_result-report.txt',
      '/o/trustweb-ops/bin/preview_lib.mjs patch tw-261116_steer',
      'model: Sonnet', 'Opus', 'Fable only after asking Jakob',
    ]) expect(brief).toContain(part)
  })
  it('never the old route: no fix on the row branch, never the preview merged into it', () => {
    expect(brief).not.toMatch(/Merge main into it|commit on wave44\/steer-invite-link\b/)
    expect(brief).toMatch(/NEVER: merge the preview branch \(or main\) into wave44\/steer-invite-link/)
  })
  it('the route computes the conflict against the preview branch (HEAD of the worktree) and passes the wave folder', async () => {
    const preview = { id: 'tw1', baseSha: 'abc', worktree: '/wt/p', branch: 'preview/1', features: [{ key: 'k', branch: 'b/k' }] }
    const written = {}, merged = []
    const route = fixConflictRoute({ loopback: () => true, preview: () => preview, devlog: () => '/o/trustweb-ops/DEVLOG/wave44', readBody: async () => ({ id: 'tw1', key: 'k' }), mergeTree: async (...a) => { merged.push(a); return '' }, write: (f, t) => { written[f] = t }, launch: async () => ({ window: '1' }) })
    const res = { setHeader() {}, end(b) { this.body = JSON.parse(b) } }
    await route({ method: 'POST' }, res)
    expect(res.statusCode).toBe(202)
    expect(merged).toEqual([['/wt/p', 'HEAD', 'b/k']])
    expect(written['/o/trustweb-ops/DEVLOG/wave44/conflict-k.txt']).toContain('preview/1')
  })
})
