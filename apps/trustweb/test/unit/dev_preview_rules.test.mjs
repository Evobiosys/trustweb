/** Dev preview overlay: disabled boxes and toggle cascade. */
import { readyToGo as readyToGoSource } from '../../dev_preview_rules.mjs'
import { approveMergeRoute, fixConflictRoute, launchError, mergeStatusFile, opsDevlogRoot } from '../../dev_preview_rules.mjs'
import { ensureLoaded, remindOpenStore, searchRows, compatLine, compatHint, hintParts, conflictParts, mergeHead, mergeResume, mergeResult, panelDone, approveGate, prGate, testLine, verdictAfter, shownVerdict, pillPress, selectAll, allApproved, allLoaded, approvedKeys, loadedKeys, unapproved, reminderText, pendingCount, pendingText, applyStamp, applyStuck, autoApply, applyDue, needsWorkNote, focusStore, focusSplit, assemblyMoved, shouldReload, reloadMark, scrollStore, RELOAD_GAP_MS, APPROVE_HINT, APPROVE_WAVE_LABEL, APPROVE_WAVE_AND_CONTINUE_LABEL, cascaded, ciDiagnostics, diagnosticsFor, ghBin, ciLine, typedValue, collapseStore, confirmText, descendants, devLabel, devUrl, needsHint, parseStep, personalApprove, prMerged, prRunning, readyToGo, rowPlan, setMap, stepText, readSeen, sections, seenState, tapped, tapSeen, toggled, tree } from '../../src/dev_preview_rules.ts'

const f = (key, requires = [], checked = true) => ({ key, branch: 'wave7/' + key, title: 'T-' + key, requires, checked })
const set = [f('events'), f('event-link', ['events']), f('deep', ['event-link']), f('overlay')]
const on = (fs) => fs.filter((x) => x.checked).map((x) => x.key)

describe('dev preview rules', () => {
  it('the dev panel buttons say Approve wave, never Declare done', () => {
    expect(APPROVE_WAVE_LABEL).toBe('Approve wave')
    expect(APPROVE_WAVE_AND_CONTINUE_LABEL).toBe('Approve wave and continue to dev.trustweb.one')
    for (const l of [APPROVE_WAVE_LABEL, APPROVE_WAVE_AND_CONTINUE_LABEL]) expect(l).not.toContain('Declare done')
  })
  it('the left panel is done (dimmed) only while an Approve wave run is going; free after a failed, cancelled or released run (wave 33: a released status left it dead)', () => {
    for (const step of ['tests', 'merging']) expect(panelDone(step)).toBe(true)
    for (const step of ['none', '', 'failed', 'checks-failed', 'cancelled', 'released', 'release-pending']) expect(panelDone(step)).toBe(false)
  })
  it('a box is disabled only while a required feature is unchecked, with its title as hint', () => {
    expect(needsHint(set, 'event-link')).toBeNull()
    expect(needsHint(toggled(set, 'events', false), 'event-link')).toBe('needs T-events')
    expect(needsHint(set, 'nope')).toBeNull()
  })
  it('off unchecks dependents transitively and leaves the rest', () => {
    expect(on(toggled(set, 'events', false))).toEqual(['overlay'])
    expect(on(toggled(set, 'deep', false))).toEqual(['events', 'event-link', 'overlay'])
  })
  it('on checks the requires transitively', () => {
    const off = toggled(set, 'events', false)
    expect(on(toggled(off, 'deep', true))).toEqual(['events', 'event-link', 'deep', 'overlay'])
    expect(on(toggled(off, 'event-link', true))).toEqual(['events', 'event-link', 'overlay'])
  })
  it('does not mutate its input', () => {
    toggled(set, 'events', false)
    expect(on(set)).toHaveLength(4)
  })
})

describe('dev preview row tap and confirm', () => {
  it('one row lit at a time; the same row again switches it off', () => {
    let lit = null
    lit = tapped(lit, 'a'); expect(lit).toBe('a')
    lit = tapped(lit, 'b'); expect(lit).toBe('b')
    lit = tapped(lit, 'b'); expect(lit).toBeNull()
  })
  it('confirm wording follows the direction of the toggle', () => {
    expect(confirmText('Events', false)).toBe('Re-assemble preview without Events? The page reloads.')
    expect(confirmText('Events', true)).toBe('Re-assemble preview with Events? The page reloads.')
  })
})

describe('dev preview outliner tree and cascade preview', () => {
  const keys = (ns) => ns.map((n) => `${n.depth}:${n.feature.key}`)
  const flat = (ns) => ns.flatMap((n) => [n, ...flat(n.children)])
  it('nests by requires with depth, keeps list order', () => {
    expect(keys(flat(tree(set)))).toEqual(['0:events', '1:event-link', '2:deep', '0:overlay'])
  })
  it('a feature whose requires are missing sits at the root; the first present require is the parent', () => {
    const odd = [f('a'), f('b', ['gone']), f('c', ['gone', 'a'])]
    expect(keys(flat(tree(odd)))).toEqual(['0:a', '1:c', '0:b'])
  })
  it('cascaded lists what flips with a toggle, not the key itself', () => {
    expect(cascaded(set, 'events', false)).toEqual(['event-link', 'deep'])
    expect(cascaded(set, 'overlay', false)).toEqual([])
    expect(cascaded(toggled(set, 'events', false), 'deep', true)).toEqual(['events', 'event-link'])
  })

  it('readyToGo needs three 200s in a row from a server started after since', () => {
    const ok = { status: 200, serverStarted: 2000 }
    expect(readyToGo([ok, ok, ok], 1000)).toBe(true)
    expect(readyToGo([{ status: 0 }, ok, ok], 1000)).toBe(false)
    expect(readyToGo([ok, ok], 1000)).toBe(false)
    expect(readyToGo([ok, ok, ok], 2000)).toBe(false)
    expect(readyToGo([{ status: 200 }, ok, ok, ok], 1000)).toBe(true)
    expect(readyToGo([ok, ok, { status: 200, serverStarted: 500 }], 1000)).toBe(false)
  })

  it('setMap maps every key to its checked state, confirmText counts several changes', () => {
    expect(setMap(toggled(set, 'deep', false))).toEqual({ events: true, 'event-link': true, deep: false, overlay: true })
    expect(confirmText('X', false, 2)).toBe('Re-assemble preview with these 2 changes? The page reloads.')
  })

  it('descendants counts every feature below a node', () => {
    const [events, overlay] = tree(set)
    expect(descendants(events)).toBe(2)
    expect(descendants(overlay)).toBe(0)
  })
})

describe('dev preview collapse store and PR status', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) } } }
  it('starts expanded, remembers per storage, and the re-export is the plain-ESM function', () => {
    const a = mem(), b = mem()
    expect(collapseStore(a).get()).toBe(false)
    collapseStore(a).set(true)
    expect(collapseStore(a).get()).toBe(true)
    expect(collapseStore(b).get()).toBe(false)
    collapseStore(a).set(false)
    expect(collapseStore(a).get()).toBe(false)
    expect(readyToGo).toBe(readyToGoSource)
  })
  it('unavailable storage is not remembered and never throws', () => {
    const dead = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    expect(collapseStore(dead).get()).toBe(false)
    expect(() => collapseStore(dead).set(true)).not.toThrow()
  })
  it('a PR flow runs while the step is none of none, ready, failed', () => {
    expect(['none', 'ready', 'failed'].map(prRunning)).toEqual([false, false, false])
    expect(prRunning('ci')).toBe(true)
  })

  it('a row tap points when the target shows, else shows the steps, else has nothing to offer', () => {
    expect(rowPlan(true, ['a'])).toBe('point')
    expect(rowPlan(true, undefined)).toBe('point')
    expect(rowPlan(false, ['Web view', 'calendar glyph'])).toBe('steps')
    expect(rowPlan(false, [])).toBe('none')
    expect(rowPlan(false, undefined)).toBe('none')
  })
  it('a step is text, optionally with " @ selector"', () => {
    expect(parseStep('Web view')).toEqual({ text: 'Web view', selector: null })
    expect(parseStep('calendar glyph top right @ .events-btn')).toEqual({ text: 'calendar glyph top right', selector: '.events-btn' })
    expect(parseStep('Web @ .tab[data-go="web"]')).toEqual({ text: 'Web', selector: '.tab[data-go="web"]' })
    expect(parseStep('odd @ ')).toEqual({ text: 'odd', selector: null })
  })
  it('PR progress never shows a raw step name', () => {
    expect(stepText('none', undefined, 's')).toBe('starting...')
    expect(stepText('start', 'starting', 's')).toBe('tagging and pushing')
    expect(stepText('pushed', 'pushed as task/s', '261015_1227')).toBe('pushed task/261015_1227')
    expect(stepText('pr', 'PR #8 opened', 's', 8)).toBe('PR #8 opened, CI running')
    expect(stepText('ci', 'CI running (PR #8)', 's', 8)).toBe('CI running (PR #8)')
    expect(stepText('ready', 'slot ready', 's', 8)).toBe('dev ready')
    expect(stepText('failed', 'CI failed on PR #8', 's')).toBe('CI failed on PR #8')
  })
  it('CI estimate in minutes with a countdown from the flow start', () => {
    const t0 = '2026-10-15T10:00:00Z', at = (s) => Date.parse(t0) + s * 1000
    expect(ciLine(200, t0, at(0))).toBe('CI usually takes about 3 min · about 3:20 left')
    expect(ciLine(200, t0, at(140))).toBe('CI usually takes about 3 min · about 1:00 left')
    expect(ciLine(200, t0, at(300))).toBe('CI usually takes about 3 min · should be done any moment')
    expect(ciLine(20, t0, at(0))).toContain('about 1 min')
  })
  it('dev opens at the same place as the preview, labelled by its host', () => {
    expect(devUrl('https://dev2.trustweb.one/', { pathname: '/', search: '', hash: '#/web' })).toBe('https://dev2.trustweb.one/#/web')
    expect(devUrl('https://dev2.trustweb.one/', { pathname: '/x', search: '?a=1', hash: '' })).toBe('https://dev2.trustweb.one/x?a=1')
    expect(devLabel('https://dev2.trustweb.one/')).toBe('dev2')
  })
  it('the x hides the panel for this tab only', () => {
    const m = new Map()
    const store = collapseStore({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) })
    expect(store.hidden()).toBe(false)
    store.hide()
    expect(store.hidden()).toBe(true)
    expect(store.get()).toBe(false)
  })
})

describe('dev preview PR update', () => {
  it('prMerged: true only when the registry says the PR is merged', () => {
    expect(prMerged({ pr: { merged: true } })).toBe(true)
    expect(prMerged({ pr: {} })).toBe(false)
    expect(prMerged({ pr: null })).toBe(false)
  })
  it('confirmText names the PR only when there is one', () => {
    expect(confirmText('Events', false, 1, 8)).toBe('Re-assemble preview without Events? The page reloads. PR #8 keeps its current set until you update it.')
    expect(confirmText('X', true, 2, null)).toBe('Re-assemble preview with these 2 changes? The page reloads.')
  })
})

describe('merged features', () => {
  it('visible() drops features whose branch is on main already', async () => {
    const { visible } = await import('../../src/dev_preview_rules.ts')
    const list = [{ key: 'a', branch: 'x/a', title: 'A', requires: [], checked: true, merged: true }, { key: 'b', branch: 'x/b', title: 'B', requires: ['a'], checked: true }]
    expect(visible(list).map((f) => f.key)).toEqual(['b'])
  })
})

describe('dev preview PR count, block and reviewed rows', () => {
  const list = [f('a'), f('b', [], false), { ...f('c'), merged: true }]
  it('seenState: first mark, same ref, one change, two changes, re-mark', () => {
    expect(seenState({}, 'a', 'r1')).toEqual({ italic: false, prefix: '', next: {} })
    const marked = tapSeen({}, 'a', 'r1')
    expect(marked).toEqual({ a: { ref: 'r1', updates: 0 } })
    expect(seenState(marked, 'a', 'r1')).toEqual({ italic: true, prefix: '', next: marked })
    const one = seenState(marked, 'a', 'r2')
    expect(one).toMatchObject({ italic: false, prefix: 'Update: ', next: { a: { ref: 'r2', updates: 1 } } })
    expect(seenState(one.next, 'a', 'r2')).toMatchObject({ italic: false, prefix: 'Update: ' })
    const two = seenState(one.next, 'a', 'r3')
    expect(two).toMatchObject({ italic: false, prefix: 'Update2: ', next: { a: { ref: 'r3', updates: 2 } } })
    const again = tapSeen(two.next, 'a', 'r3')
    expect(seenState(again, 'a', 'r3')).toMatchObject({ italic: true, prefix: '' })
    expect(tapSeen(again, 'a', 'r3')).toEqual({})
  })
  it('readSeen migrates an old key list to an unknown ref (shows Update: until tapped)', () => {
    const fs = [{ key: 'a', ref: 'r1' }, { key: 'b', ref: 'r2' }]
    expect(readSeen('["b"]')).toEqual({ b: { ref: '', updates: 0 } })
    expect(seenState(readSeen('["b"]'), 'b', 'r2')).toMatchObject({ italic: false, prefix: 'Update: ' })
    expect(readSeen('{"a":{"ref":"x","updates":2}}')).toEqual({ a: { ref: 'x', updates: 2 } })
    expect(readSeen('nope')).toEqual({})
  })
  it('sections: vanilla, private, ops; empty ones dropped; a child of another repo starts its own top level', () => {
    const f = (key, repo, requires = []) => ({ key, repo, requires, branch: key, title: key, checked: true })
    const out = sections(tree([f('o', 'ops'), f('v'), f('v2', undefined, ['v']), f('p', 'private', ['v']), f('p2', 'private', ['p'])]))
    expect(out.map((s) => s.repo)).toEqual(['vanilla', 'private', 'ops'])
    expect(out[0].nodes.map((n) => [n.feature.key, n.children.map((c) => c.feature.key)])).toEqual([['v', ['v2']]])
    expect(out[1].nodes.map((n) => [n.feature.key, n.children.map((c) => c.feature.key)])).toEqual([['p', ['p2']]])
    expect(sections(tree([f('o', 'ops')])).map((s) => s.repo)).toEqual(['ops'])
  })
  it('ciDiagnostics: failed job names first, then only error lines, 200 lines at most', () => {
    const log = 'job\tstep\tall fine\njob\tstep\t  ✗ chain FAIL 429\njob\tstep\tError: boom'
    expect(ciDiagnostics(['reach-out-link'], log)).toBe('job: reach-out-link\n✗ chain FAIL 429\nError: boom')
    expect(ciDiagnostics([], 'FAIL\n'.repeat(500)).split('\n')).toHaveLength(200)
  })
  it('ciDiagnostics: nothing found says so instead of an empty clipboard', () => {
    expect(ciDiagnostics([], 'all fine')).toMatch(/no failed job/)
  })
  it('ghBin: TW_GH first, then PATH, then the Homebrew spots, else null', () => {
    const has = (...ps) => (p) => ps.includes(p)
    expect(ghBin({ TW_GH: '/x/gh', PATH: '/bin' }, has())).toBe('/x/gh')
    expect(ghBin({ PATH: '/bin:/u/bin' }, has('/u/bin/gh', '/opt/homebrew/bin/gh'))).toBe('/u/bin/gh')
    expect(ghBin({ PATH: '/bin' }, has('/opt/homebrew/bin/gh'))).toBe('/opt/homebrew/bin/gh')
    expect(ghBin({}, has())).toBeNull()
  })
  it('diagnosticsFor: runs a fake gh (TW_GH), names the failed job, and says why when gh is missing or fails', async () => {
    const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs')
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const dir = mkdtempSync('/tmp/twgh-')
    const fake = `${dir}/gh`
    writeFileSync(fake, '#!/bin/sh\ncase "$*" in\n"pr view"*) echo feat;;\n"run list"*) echo 7;;\n*"--log-failed"*) printf "j\\ts\\tError: boom\\n";;\n*"--json jobs"*) echo build;;\nesac\n')
    chmodSync(fake, 0o755)
    const run = async (bin, a) => (await promisify(execFile)(bin, a, { encoding: 'utf8' })).stdout
    await expect(diagnosticsFor('25', fake, run)).resolves.toBe('job: build\nError: boom')
    await expect(diagnosticsFor('25', null, run)).rejects.toThrow(/gh not found/)
    await expect(diagnosticsFor('25', dir + '/nope', run)).rejects.toThrow()
  })
  it('typedValue: the text after paste or type, quotes dropped; none otherwise', () => {
    expect(typedValue('paste https://wa.me/qr/ABC')).toBe('https://wa.me/qr/ABC')
    expect(typedValue('Type "Manuel"')).toBe('Manuel')
    expect(typedValue('tap Save')).toBeNull()
  })
})

describe('approve (merge to main) rules', () => {
  const g = (key, checked, verdict, extra = {}) => ({ key, branch: 'b/' + key, title: 'T-' + key, requires: [], checked, verdict, ...extra })
  const passed = { assembled: { sha: 'abc1234', error: null }, tested: { sha: 'abc1234', at: 'x', ok: true, running: false } }
  it('a pill shows only when verdict and checkbox agree: approved = merge + checked, needs work = needs-work + unchecked', () => {
    expect(shownVerdict(g('a', true, 'merge'))).toBe('merge')
    expect(shownVerdict(g('a', false, 'merge'))).toBeNull()
    expect(shownVerdict(g('a', false, 'needs-work'))).toBe('needs-work')
    expect(shownVerdict(g('a', true, 'needs-work'))).toBeNull()
    expect(shownVerdict(g('a', true, null))).toBeNull()
  })
  it('a press on a pill gives the verdict to store (approve also loads the row on the server; un-approve keeps it loaded); the shown pill pressed again clears it', () => {
    expect(pillPress([g('a', false, null)], 'a', 'merge')).toBe('merge')
    expect(pillPress([g('a', true, 'merge')], 'a', 'merge')).toBeNull()
    expect(pillPress([g('a', true, 'merge')], 'a', 'needs-work')).toBe('needs-work')
    expect(pillPress([g('a', false, 'needs-work')], 'a', 'needs-work')).toBeNull()
  })
  it('select all = the exact boxes that load every available row (approving none); select none unloads them; merged rows stay as they are', () => {
    const list = [g('a', false, 'needs-work'), g('b', true, null), g('m', true, null, { merged: true })]
    expect(allLoaded(list)).toBe(false)
    expect(allLoaded([g('a', true, null), g('m', false, null, { merged: true })])).toBe(true)
    expect(allApproved(list)).toBe(false)
    expect(selectAll(list, true)).toEqual({ a: true, b: true, m: true })
    expect(selectAll(list, false)).toEqual({ a: false, b: false, m: true })
    expect(allApproved([g('a', true, 'merge'), g('m', true, null, { merged: true })])).toBe(true)
  })
  it('loaded = checked, approved = loaded + verdict merge; the pending count is the loaded set against the assembled set (approving moves nothing)', () => {
    const list = [g('a', true, 'merge'), g('b', true, null), g('c', false, 'needs-work'), g('d', true, 'merge'), g('m', true, 'merge', { merged: true })]
    expect(approvedKeys(list)).toEqual(['a', 'd'])
    expect(loadedKeys(list)).toEqual(['a', 'b', 'd'])
    expect(pendingCount({ features: list, assembled: { set: ['a', 'b', 'd'] } })).toBe(0)
    expect(pendingCount({ features: [g('a', true, null), g('b', true, 'merge')], assembled: { set: ['a', 'b'] } })).toBe(0)
    expect(pendingCount({ features: list, assembled: { set: ['a', 'x'] } })).toBe(3)
    expect(pendingCount({ features: list, assembled: { set: [] } })).toBe(3)
    expect(pendingCount({ features: list, assembled: null })).toBe(0)   // no assembled.set (older registry): its checked rows a, b, d against the loaded a, b, d
    expect(pendingText(1)).toBe('1 change not applied'); expect(pendingText(3)).toBe('3 changes not applied')
  })
  it('no manual reload (Jakob 2026-10-24): a pending registry starts the apply by itself, unless one is going, a test runs, or the last apply got stuck (Retry is the owner\'s)', () => {
    const pend = { pending: true, tested: null }
    expect(autoApply(pend, null)).toBe(true)
    expect(autoApply({ pending: false, tested: null }, null)).toBe(false)
    expect(autoApply(pend, { stamp: '', moved: 0, stuck: false })).toBe(false)
    expect(autoApply(pend, { stamp: '', moved: 0, stuck: true })).toBe(false)
    expect(autoApply({ pending: true, tested: { sha: 'x', at: '', ok: null, running: true } }, null)).toBe(true)   // wave 32: a running test never swallows an uncheck
    expect(autoApply({ pending: true, tested: { sha: 'x', at: '', ok: true, running: false } }, null)).toBe(true)
  })
  it('the page reloads itself once the assembled sha moved away from the one it knows (a CLI apply, or the Approve press); unknown or same sha: stay', () => {
    expect(assemblyMoved('abc1234', { assembled: { sha: 'abc1234' } })).toBe(false)
    expect(assemblyMoved('abc1234', { assembled: { sha: 'def5678' } })).toBe(true)
    expect(assemblyMoved(null, { assembled: { sha: 'def5678' } })).toBe(false)
    expect(assemblyMoved('abc1234', { assembled: null })).toBe(false)
  })
  it('the apply counts as stuck when the registry did not change for 90 s', () => {
    const p = { pending: true, assembled: { at: 't1', set: [] }, features: [g('a', true, 'merge')] }
    expect(applyStamp(p)).toBe(applyStamp({ ...p }))
    expect(applyStamp(p)).toBe(applyStamp({ ...p, features: [g('a', true, null)] }))   // a verdict alone does not move it
    expect(applyStamp(p)).not.toBe(applyStamp({ ...p, features: [g('a', true, 'merge'), g('b', true, null)] }))
    expect(applyStamp(p)).not.toBe(applyStamp({ ...p, assembled: { at: 't2', set: [] } }))
    expect(applyStuck(1000, 1000 + 89e3)).toBe(false); expect(applyStuck(1000, 1000 + 91e3)).toBe(true)
  })
  it('a verdict click on the active pill clears it', () => {
    expect(verdictAfter(null, 'merge')).toBe('merge')
    expect(verdictAfter('merge', 'needs-work')).toBe('needs-work')
    expect(verdictAfter('merge', 'merge')).toBeNull()
  })
  it('tests count only for the assembled sha', () => {
    expect(prGate(passed)).toBe('passed')
    expect(prGate({ ...passed, tested: { ...passed.tested, sha: 'old' } })).toBe('untested')
    expect(prGate({ ...passed, tested: { ...passed.tested, running: true } })).toBe('running')
    expect(prGate({ ...passed, tested: { ...passed.tested, ok: false } })).toBe('failed')
    expect(testLine('passed', passed.tested)).toBe('Checks passed for abc1234')
  })
  it('Approve wave opens with nothing running, every loaded row approved (>= 1) and no conflict; pending changes, tests not run or failed do not block; the hint names the blocker', () => {
    expect(approveGate({ ...passed, baseSha: 'B', compat: { state: 'ok', baseSha: 'B', refs: { a: null } }, features: [g('a', true, 'merge'), g('b', false, 'needs-work'), g('m', true, null, { merged: true })] })).toEqual({ ok: true, hint: '' })
    expect(approveGate({ ...passed, baseSha: 'B', compat: { state: 'ok', baseSha: 'B', refs: { a: null } }, tested: undefined, features: [g('a', true, 'merge')] }).ok).toBe(true)
    expect(approveGate({ ...passed, baseSha: 'B', compat: { state: 'ok', baseSha: 'B', refs: { a: null } }, tested: { ...passed.tested, ok: false }, features: [g('a', true, 'merge')] }).ok).toBe(true)
    expect(approveGate({ ...passed, pending: true, features: [g('a', true, 'merge')] }).ok).toBe(true)
    expect(approveGate({ ...passed, pending: true, blocked: 'base c0e05d4 is behind origin/main', features: [g('a', true, 'merge')] })).toEqual({ ok: false, hint: 'base c0e05d4 is behind origin/main' })   // ops `preview <id> guard`: out of date or already merged closes the button, whatever else is open
    expect(approveGate({ ...passed, pending: true, blocked: null, features: [g('a', true, 'merge')] }).ok).toBe(true)
    expect(approveGate({ ...passed, tested: { ...passed.tested, running: true }, features: [g('a', true, 'merge')] }).hint).toBe('Tests are running')
    expect(approveGate({ ...passed, features: [g('a', true, null), g('b', false, 'merge')] }).hint).toBe('Approve first: T-a')
    expect(approveGate({ ...passed, features: [g('a', true, 'merge'), g('b', true, null), g('c', true, null)] })).toEqual({ ok: false, hint: 'Approve first: T-b, T-c' })
    expect(approveGate({ ...passed, features: [g('b', false, 'merge'), g('c', false, 'needs-work')] }).hint).toBe('Approve at least one feature')
    expect(approveGate({ ...passed, features: [] }).ok).toBe(false)
    expect(approveGate({ ...passed, assembled: { sha: 'abc1234', error: 'conflict x' } , features: [g('a', true, 'merge')] }).hint).toBe('Fix the conflict first: conflict x')
    expect(approveGate({ ...passed, pending: true, assembled: { sha: 'abc1234', error: 'conflict x' } , features: [g('a', true, 'merge')] }).ok).toBe(true)
  })
  it('the reminder names the loaded rows still waiting for the approval; empty when none waits; merged and unloaded rows do not count', () => {
    const list = [g('a', true, null), g('b', true, null), g('c', true, 'merge'), g('d', false, null), g('m', true, null, { merged: true })]
    expect(unapproved(list).map((x) => x.key)).toEqual(['a', 'b'])
    expect(reminderText(list)).toBe('2 loaded, not yet approved: T-a, T-b')
    expect(reminderText([g('a', true, 'merge'), g('d', false, null)])).toBe('')
  })
  it('the box head says DONE (class ok) once the released step ended the flow, FAILED / CANCELLED after a run that ended without a merge, IN PROGRESS before', () => {
    expect(mergeHead('released')).toEqual({ text: 'DONE', ok: true })
    expect(mergeHead('release-pending')).toEqual({ text: 'MERGED, RELEASE PENDING', ok: true })
    for (const step of ['failed', 'checks-failed']) expect(mergeHead(step)).toEqual({ text: 'FAILED', ok: false })
    expect(mergeHead('cancelled')).toEqual({ text: 'CANCELLED', ok: false })
    for (const step of ['tests', 'merging', 'checks']) expect(mergeHead(step)).toEqual({ text: 'IN PROGRESS', ok: false })
  })
  describe('merge box after a reload (Jakob 2026-11-03: the result vanished into the default buttons; a run always ends in a success or failure button)', () => {
    const t0 = Date.parse('2026-11-03T12:00:00Z')
    const at = (min) => new Date(t0 - min * 60e3).toISOString()
    it('an ended run within a day shows its result, whatever commit the page was built from', () => {
      expect(mergeResume({ step: 'checks-failed', updated: at(5), sha: 'f062cdc4' }, t0)).toBe('result')
      expect(mergeResume({ step: 'released', updated: at(600) }, t0)).toBe('result')
      expect(mergeResume({ step: 'cancelled', updated: at(1) }, t0)).toBe('result')
      expect(mergeResume({ step: 'failed', updated: at(1500) }, t0)).toBe('none')
    })
    it('a run still going is polled for an hour, then counts as dead; no status file = nothing', () => {
      expect(mergeResume({ step: 'tests', updated: at(2) }, t0)).toBe('poll')
      expect(mergeResume({ step: 'checks', updated: at(90) }, t0)).toBe('none')
      expect(mergeResume({ step: 'none' }, t0)).toBe('none')
      expect(mergeResume({ step: '' }, t0)).toBe('none')
    })
    it('the result button: green success, red failure, cancelled neither', () => {
      expect(mergeResult('released')).toEqual({ text: 'Success', ok: true })
      expect(mergeResult('release-pending')).toEqual({ text: 'Merged, release pending', ok: true })
      expect(mergeResult('checks-failed')).toEqual({ text: 'Failed', ok: false })
      expect(mergeResult('failed')).toEqual({ text: 'Failed', ok: false })
      expect(mergeResult('cancelled')).toEqual({ text: 'Cancelled', ok: null })
    })
  })
  it('the hint under Approve says what happens and never asks for a test run first', () => {
    expect(APPROVE_HINT).toBe('Touch ID, then the tests run here; green = pushed, merged and released. Red = nothing leaves this Mac.')
    expect(testLine('untested', null)).toBe('')
  })
})

describe('/__tw/approve-merge route', () => {
  const res = () => { const r = { code: 200, body: '', setHeader() {}, end(b) { r.body = b ?? '' } }; return r }
  const make = (over = {}) => {
    const spawned = []
    const files = {}
    const h = approveMergeRoute({ loopback: () => true, branch: () => 'preview/261023_1500', cache: '/c', ops: '/ops', wt: '/wt', exists: (f) => f in files, read: (f) => files[f], spawn: (...a) => { spawned.push(a) }, ...over })
    return { h, spawned, files }
  }
  it('POST starts the script detached on the worktree and answers 202', () => {
    const { h, spawned } = make(); const r = res()
    h({ method: 'POST' }, r)
    expect(r.code).toBe(202)
    expect(spawned).toEqual([['/ops/bin/tw_approve_merge.sh', ['/wt']]])
  })
  it('refuses a non-loopback caller and any other method; never spawns', () => {
    const a = make({ loopback: () => false }), r1 = res(); a.h({ method: 'POST' }, r1)
    const b = make(), r2 = res(); b.h({ method: 'PUT' }, r2)
    expect([r1.code, r2.code, a.spawned.length, b.spawned.length]).toEqual([403, 405, 0, 0])
  })
  it('GET returns the status file of this branch, or step none', () => {
    expect(mergeStatusFile('/c', 'preview/261023_1500')).toBe('/c/approvals/preview-261023_1500.merge.json')
    const { h, files } = make(); const r = res()
    h({ method: 'GET' }, r); expect(JSON.parse(r.body)).toEqual({ step: 'none' })
    files['/c/approvals/preview-261023_1500.merge.json'] = '{"step":"released","text":"released abc1234"}'
    const r2 = res(); h({ method: 'GET' }, r2); expect(JSON.parse(r2.body).step).toBe('released')
  })
  it('does not start a second run while the status is still running', () => {
    const { h, spawned, files } = make(); files['/c/approvals/preview-261023_1500.merge.json'] = JSON.stringify({ step: 'checks', updated: new Date().toISOString() })
    const r = res(); h({ method: 'POST' }, r)
    expect([r.code, spawned.length]).toEqual([409, 0])
  })
})

describe('Approve personal view (the one button that pushes, opens the PR and shares on dev)', () => {
  const list = [f('a'), f('b', [], false), { ...f('c'), merged: true }]
  it('a registry preview goes through `preview <id> pr`, a plain worktree through its own approve route', () => {
    expect(personalApprove(true, list).url).toBe('/__tw/preview/pr')
    expect(personalApprove(false, list).url).toBe('/__tw/approve')
  })
  it('a registry preview needs one checked feature that is not on main yet', () => {
    expect(personalApprove(true, list).ok).toBe(true)
    expect(personalApprove(true, [f('b', [], false), { ...f('c'), merged: true }]).ok).toBe(false)
    expect(personalApprove(true, []).ok).toBe(false)
    expect(personalApprove(false, []).ok).toBe(true)
  })
})

describe('panel polish: one clean reload, scroll kept', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) } } }
  const asm = (sha, error = null) => ({ sha, error })
  it('reloads once a different assembled sha shows, never before the first answer', () => {
    expect(shouldReload('a', asm('b'), null, 1e6)).toBe(true)
    expect(shouldReload('a', asm('a'), null, 1e6)).toBe(false)
    expect(shouldReload(null, asm('b'), null, 1e6)).toBe(false)
    expect(shouldReload('a', null, null, 1e6)).toBe(false)
  })
  it('never while the assembly carries an error', () => {
    expect(shouldReload('a', asm('b', 'CONFLICT'), null, 1e6)).toBe(false)
  })
  it('at most once per distinct sha, and not within 10 s of the last reload', () => {
    expect(shouldReload('a', asm('b'), { sha: 'b', at: 0 }, 1e6)).toBe(false)
    expect(shouldReload('a', asm('c'), { sha: 'b', at: 1e6 - RELOAD_GAP_MS + 1 }, 1e6)).toBe(false)
    expect(shouldReload('a', asm('c'), { sha: 'b', at: 1e6 - RELOAD_GAP_MS }, 1e6)).toBe(true)
  })
  it('the reload mark is kept per preview id in the tab store', () => {
    const s = mem()
    expect(reloadMark(s, 'p1').get()).toBeNull()
    reloadMark(s, 'p1').set({ sha: 'b', at: 5 })
    expect(reloadMark(s, 'p1').get()).toEqual({ sha: 'b', at: 5 })
    expect(reloadMark(s, 'p2').get()).toBeNull()
    s.setItem('twp-reload-p3', '{bad')
    expect(reloadMark(s, 'p3').get()).toBeNull()
  })
  it('the panel scroll position is kept per preview id; junk and dead storage read as 0', () => {
    const s = mem()
    expect(scrollStore(s, 'p1').get()).toBe(0)
    scrollStore(s, 'p1').set(240)
    expect(scrollStore(s, 'p1').get()).toBe(240)
    expect(scrollStore(s, 'p2').get()).toBe(0)
    s.setItem('twp-scroll-p3', 'x')
    expect(scrollStore(s, 'p3').get()).toBe(0)
    const dead = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    expect(scrollStore(dead, 'p').get()).toBe(0)
    expect(() => scrollStore(dead, 'p').set(1)).not.toThrow()
  })
})

describe('conflictParts: the names in a conflict text, each with its own colour', () => {
  it('ops status "conflict in <file> between <feature> and <feature or main>": file, first and second feature', () => {
    expect(conflictParts('conflict in apps/x.ts between approve-merge and main')).toEqual([
      'conflict in ', { text: 'apps/x.ts', kind: 'file' }, ' between ', { text: 'approve-merge', kind: 'a' }, ' and ', { text: 'main', kind: 'b' },
    ])
  })
  it('raw git error (assembled.error, the gate hint): branch before the colon, every "Merge conflict in <file>"', () => {
    expect(conflictParts('Fix the conflict first: wave20/approve-merge: CONFLICT (content): Merge conflict in src/r.ts')).toEqual([
      'Fix the conflict first: ', { text: 'wave20/approve-merge', kind: 'a' }, ': CONFLICT (content): Merge conflict in ', { text: 'src/r.ts', kind: 'file' },
    ])
    expect(conflictParts('b/c: CONFLICT (content): Merge conflict in x.txt\nAuto-merging y\nCONFLICT (content): Merge conflict in y.txt')).toEqual([
      { text: 'b/c', kind: 'a' }, ': CONFLICT (content): Merge conflict in ', { text: 'x.txt', kind: 'file' }, '\nAuto-merging y\nCONFLICT (content): Merge conflict in ', { text: 'y.txt', kind: 'file' },
    ])
  })
  it('text without a conflict stays one plain string', () => {
    expect(conflictParts('PR #49: merging')).toEqual(['PR #49: merging'])
    expect(conflictParts('')).toEqual([])
  })
})

describe('panel-approve-2', () => {
  const g = (key, checked, verdict, extra = {}) => ({ key, branch: 'b/' + key, title: 'T-' + key, requires: [], checked, verdict, ...extra })
  it('approve on an unticked row loads it (and what it requires) first; a loaded row stays as it is', () => {
    const list = [g('a', true, null), g('b', false, null, { requires: ['a'] }), g('c', false, null)]
    expect(ensureLoaded(list, 'b').find((x) => x.key === 'b').checked).toBe(true)
    expect(ensureLoaded(list, 'c').find((x) => x.key === 'c').checked).toBe(true)
    expect(ensureLoaded(list, 'a')).toBe(list)
  })
  it('the reminder is collapsed per preview until opened', () => {
    const mem = {}
    const st = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v } }
    expect(remindOpenStore(st, 'p1').get()).toBe(false)
    remindOpenStore(st, 'p1').set(true)
    expect(remindOpenStore(st, 'p1').get()).toBe(true)
    expect(remindOpenStore(st, 'p2').get()).toBe(false)
  })
  it('search keeps rows by title, key, where or steps; empty keeps all', () => {
    const list = [g('rec', true, null, { title: 'Recording icon' }), g('map', true, null, { where: 'Map view', steps: ['Tap the pin @ .pin'] }), g('x', true, null)]
    expect(searchRows(list, ' RECORD').map((x) => x.key)).toEqual(['rec'])
    expect(searchRows(list, 'map').map((x) => x.key)).toEqual(['map'])
    expect(searchRows(list, 'tap the pin').map((x) => x.key)).toEqual(['map'])
    expect(searchRows(list, '')).toBe(list)
  })
  it('compat line and hint (real registry shape)', () => {
    const loaded = [g('a', true, 'merge', { ref: 'r1' }), g('b', true, 'merge', { ref: 'r2' })]
    const c = (o) => ({ baseSha: 'B', refs: { a: 'r1', b: 'r2' }, singles: { a: 'ok', b: 'ok' }, pairs: { 'a+b': 'ok' }, full: 'ok', state: 'ok', ...o })
    expect(compatLine(undefined)).toBeNull()
    expect(compatLine({ state: 'running' }).text).toBe('compat: checking…')
    expect(compatLine(c({}))).toEqual({ text: 'compat ✓ 1 pairs, full set', ok: true, conflicts: [] })
    expect(compatLine(c({}), false).text).toBe('compat: out of date')
    const bad = compatLine(c({ state: 'conflict', pairs: { 'a+b': 'conflict: strings.ts' }, full: 'conflict: b (main.ts)' }))
    expect(bad.text).toBe('compat ✗ a+b: strings.ts (+1)')
    expect(bad.conflicts).toEqual(['a+b: strings.ts', 'full: b (main.ts)'])
    expect(compatHint(undefined, 'B', loaded)).toBe('compat check not run yet')
    expect(compatHint(c({ state: 'running' }), 'B', loaded)).toBe('compat check running')
    expect(compatHint(c({}), 'X', loaded)).toBe('compat check out of date')
    expect(compatHint(c({ state: 'conflict', pairs: { 'a+b': 'conflict: strings.ts' } }), 'B', loaded)).toBe('compat: fix a+b (strings.ts)')
    expect(compatHint(c({}), 'B', loaded)).toBe('')
    const p = { assembled: { sha: 'x', error: null }, features: loaded, baseSha: 'B' }
    expect(approveGate({ ...p, compat: c({ state: 'running' }) })).toEqual({ ok: false, hint: 'compat check running' })
    expect(approveGate({ ...p, compat: c({}) }).ok).toBe(true)
    expect(approveGate({ ...p, compat: undefined, pending: true }).ok).toBe(true)
  })
  it('a long conflict hint folds into head and detail', () => {
    expect(hintParts('Fix the conflict first: a\nb')).toEqual({ head: 'Fix the conflict first', detail: 'a\nb' })
    expect(hintParts('Approve first: T-a')).toEqual({ head: 'Approve first: T-a', detail: '' })
  })

  describe('wave 32 panel-assemble', () => {
    it('an uncheck or needs work always leads to an apply: due now when idle, later while an apply or a write is going, never lost', () => {
      expect(applyDue({ pending: false }, null, true, 0)).toBe('now')
      expect(applyDue({ pending: true, tested: { running: true } }, null, false, 0)).toBe('now')
      expect(applyDue({ pending: false }, null, false, 0)).toBe('no')
      expect(applyDue({ pending: false }, { stamp: '', moved: 0, stuck: false }, true, 0)).toBe('later')
      expect(applyDue({ pending: true }, null, false, 2)).toBe('later')
      expect(applyDue({ pending: true }, { stamp: '', moved: 0, stuck: true }, true, 0)).toBe('no')
    })
    it('the needs-work line for the clipboard', () => {
      expect(needsWorkNote('2026-11-04T10:00:00.000Z', 'pv1', { key: 'k', title: 'T' })).toBe('2026-11-04T10:00:00.000Z | pv1 | k | T | needs work')
    })
    it('focus is stored per preview in the tab; broken storage reads as none', () => {
      const m = {}
      const st = { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v } }
      expect(focusStore(st, 'a').get()).toBe(null)
      focusStore(st, 'a').set('five-rings')
      expect(focusStore(st, 'a').get()).toBe('five-rings')
      expect(focusStore(st, 'b').get()).toBe(null)
      focusStore(st, 'a').set(null)
      expect(focusStore(st, 'a').get()).toBe(null)
      expect(focusStore({ getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }, 'a').get()).toBe(null)
    })
    it('focus splits the rows: wave name, the row, the rest; unknown or merged key = no focus', () => {
      const rows = [{ ...f('a'), branch: 'wave31/a', where: 'W' }, { ...f('b'), branch: 'wave30/b' }, { ...f('m'), merged: true }]
      const s = focusSplit(rows, 'a')
      expect(s.wave).toBe('wave31')
      expect(s.row.key).toBe('a')
      expect(s.rest.map((x) => x.key)).toEqual(['b'])
      expect(focusSplit(rows, 'zz')).toBe(null)
      expect(focusSplit(rows, 'm')).toBe(null)
      expect(focusSplit(rows, null)).toBe(null)
      expect(focusSplit([{ ...f('n'), branch: 'solo' }], 'n').wave).toBe('solo')
    })
  })
})

import { readFileSync } from 'node:fs'
import { WRITE_TIMEOUT_MS, WORKING_AFTER_S, CALL_TIMEOUT_MS, PR_STALE_MS, callError, focusToggle, holdStore, lastFocusStore, loadingWhy, pressPlan, prStatusView } from '../../src/dev_preview_rules.ts'

describe('wave 33 panel', () => {
  const row = (key, over = {}) => ({ key, branch: `wave33/${key}`, title: 'T-' + key, requires: [], checked: true, ...over })
  const memory = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v } } }

  describe('focus toggle (items 2a-c)', () => {
    const rows = [row('a'), row('b'), row('m', { merged: true })]
    it('in focus mode it goes to the full list and remembers the row; in the full list it returns to the last focused row', () => {
      expect(focusToggle(rows, 'a', null)).toEqual({ to: 'full', focus: null, last: 'a', row: rows[0] })
      expect(focusToggle(rows, null, 'a')).toEqual({ to: 'focus', focus: 'a', last: 'a', row: rows[0] })
    })
    it('no button without a focus and without a remembered row; a gone or merged row is forgotten', () => {
      expect(focusToggle(rows, null, null)).toBe(null)
      expect(focusToggle(rows, null, 'zz')).toBe(null)
      expect(focusToggle(rows, null, 'm')).toBe(null)
    })
    it('round trip: full -> focus -> full lands on the same row', () => {
      const there = focusToggle(rows, null, 'b')
      expect(focusToggle(rows, there.focus, there.last)).toEqual({ to: 'full', focus: null, last: 'b', row: rows[1] })
    })
    it('the last focused row is kept per preview in the tab', () => {
      const st = memory()
      expect(lastFocusStore(st, 'p1').get()).toBe(null)
      lastFocusStore(st, 'p1').set('a')
      expect(lastFocusStore(st, 'p1').get()).toBe('a')
      expect(lastFocusStore(st, 'p2').get()).toBe(null)
    })
  })

  describe('approve never hides the personal preview (item 2d; repro: approve on an unticked row assembled and navigated to /__tw/wait)', () => {
    it('approve on an unticked row loads it and sets the verdict, but never starts an assembly; needs work still does', () => {
      const rows = [row('a', { checked: false }), row('b')]
      expect(pressPlan(rows, 'a', 'merge')).toEqual({ loadFirst: true, assemble: false })
      expect(pressPlan(rows, 'b', 'merge')).toEqual({ loadFirst: false, assemble: false })
      expect(pressPlan(rows, 'b', 'needs-work')).toEqual({ loadFirst: false, assemble: true })
    })
    it('a held assembly (set by the approve) is not started by the registry pending flag; a box or Assemble now releases it', () => {
      expect(autoApply({ pending: true }, null)).toBe(true)
      expect(autoApply({ pending: true }, null, true)).toBe(false)
      expect(autoApply({ pending: true }, { stuck: false }, false)).toBe(false)
      const st = memory()
      expect(holdStore(st, 'p1').get()).toBe(false)
      holdStore(st, 'p1').set(true)
      expect(holdStore(st, 'p1').get()).toBe(true)
      expect(holdStore(st, 'p2').get()).toBe(false)
    })
    const src = readFileSync(new URL('../../src/dev_preview.ts', import.meta.url), 'utf8')
    const between = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i + 1); expect(i, from).toBeGreaterThan(-1); expect(j, to).toBeGreaterThan(i); return src.slice(i, j) }
    const never = /tab\.hide|tab\.set\(|setCollapsed|location\.|\bgo\(|\bapply\(\)|fold\.|root\.hidden/
    const handlers = {
      'press (pill and note approve / needs work)': between('const press = (', 'const pressAll'),
      'pressAll (Select all) and approveAll (Approve all)': between('const pressAll', 'const load = '),
      'verdict pill click': between("const pill = (v: 'merge'", '// 📝:'),
      'note click': between("const note = h('button'", "const how = h('button'"),
      'chevron fold': between("const chev = h('button'", 'const walking = '),
      'search button': between("const searchBtn = h('button'", 'const searchBox'),
    }
    for (const [name, body] of Object.entries(handlers)) {
      it(`${name} never folds, hides, navigates or starts an apply by itself`, () => {
        expect(body).not.toMatch(never)
      })
    }
    const labelled = (re, labels) => {
      const lines = src.split('\n').filter((l) => re.test(l) && !/^\s*(\/\/|\*)/.test(l))
      return lines.map((l) => (labels.find(([r]) => r.test(l)) ?? [null, 'UNLISTED: ' + l.trim().slice(0, 60)])[1])
    }
    it('the only handlers that hide / fold the panel are the Walk / ? fold, the x, the minimize button and Esc', () => {
      expect(labelled(/tab\.hide\(|tab\.set\(true\)|setCollapsed\(true\)/, [[/foldFor/, 'walk fold'], [/close\.add/, 'x'], [/x\.add/, 'minimize'], [/else if \(!collapsed/, 'esc']])).toEqual(['walk fold', 'x', 'minimize', 'esc'])
    })
    it('the only navigations are: the assembled reload (go), Open stock/personal preview, dev after the PR, and the flag switch', () => {
      expect(labelled(/location\.(href\s*=|assign)|(?<![.\w])go\(/, [[/!q\.assembled\.error/, 'apply reload'], [/const go = \(since/, 'go def'], [/shouldReload/, 'watch reload'], [/location\.assign/, 'flag switch'], [/\$\{other === /, 'open other preview'], [/devUrl/, 'dev after PR']])).toEqual(['apply reload', 'go def', 'watch reload', 'dev after PR', 'flag switch', 'open other preview'])
    })
  })

  describe('Approve is never dead (item 14)', () => {
    it('a call gives up after 8 s with a readable error', () => {
      expect(CALL_TIMEOUT_MS).toBe(8000)
      expect(callError({ name: 'TimeoutError' })).toBe('no answer after 8 s')
      expect(callError({ name: 'AbortError' })).toBe('no answer after 8 s')
      expect(callError(new Error('HTTP 500'))).toBe('HTTP 500')
      expect([WRITE_TIMEOUT_MS, WORKING_AFTER_S]).toEqual([45000, 2])
      expect(callError({ name: 'TimeoutError' }, WRITE_TIMEOUT_MS)).toBe('no answer after 45 s')
    })
    it('a disabled control says why', () => {
      expect(loadingWhy('x', '')).toMatch(/saving/)
      expect(loadingWhy(null, 'tagging and pushing')).toMatch(/PR/)
    })
    it('a PR flow without an update for 30 min counts as failed with a retry text; a fresh or finished one is untouched', () => {
      const now = Date.parse('2026-11-07T10:00:00Z')
      const old = new Date(now - PR_STALE_MS - 1000).toISOString(), fresh = new Date(now - 60e3).toISOString()
      expect(prStatusView({ step: 'pr', text: 'x', updated: old }, now)).toMatchObject({ step: 'failed' })
      expect(prStatusView({ step: 'pr', text: 'x', updated: old }, now).text).toMatch(/Approve again/)
      expect(prStatusView({ step: 'pr', text: 'x', updated: fresh }, now)).toEqual({ step: 'pr', text: 'x', updated: fresh })
      expect(prStatusView({ step: 'ready', text: 'x', updated: old }, now).step).toBe('ready')
      expect(prStatusView({ step: 'pr' }, now).step).toBe('pr')
    })
    it('a merge status older than this preview is another wave\'s: no result, no poll', () => {
      const t0 = Date.parse('2026-11-07T12:00:00Z'), at = (min) => new Date(t0 - min * 60e3).toISOString()
      expect(mergeResume({ step: 'released', updated: at(600) }, t0, { created: at(60) })).toBe('none')
      expect(mergeResume({ step: 'released', updated: at(30) }, t0, { created: at(60) })).toBe('result')
      expect(mergeResume({ step: 'released', updated: at(600) }, t0)).toBe('result')
    })
  })
})

import { changedSinceApproval, changesToApprove } from '../../src/dev_preview_rules.ts'

describe('wave 34: approved rows keep their approval when the ref moves', () => {
  const r = (key, over = {}) => ({ key, branch: 'w/' + key, title: key, requires: [], checked: true, ...over })
  it('changedSinceApproval: only an approved, updated row whose ref differs from approvedRef; short shas', () => {
    expect(changedSinceApproval(r('a', { verdict: 'merge', updated: true, approvedRef: 'aaaaaaaa1', ref: 'bbbbbbbb2' }))).toEqual({ from: 'aaaaaaa', to: 'bbbbbbb' })
    expect(changedSinceApproval(r('a', { verdict: 'merge', approvedRef: 'aaaaaaaa1', ref: 'bbbbbbbb2' }))).toBeNull()
    expect(changedSinceApproval(r('a', { verdict: null, updated: true, approvedRef: 'aaaaaaaa1', ref: 'bbbbbbbb2' }))).toBeNull()
    expect(changedSinceApproval(r('a', { verdict: 'merge', updated: true, approvedRef: 'aaaaaaaa1', ref: 'aaaaaaaa1' }))).toBeNull()
    expect(changedSinceApproval(r('a', { verdict: 'merge', updated: true, ref: 'bbbbbbbb2' }))).toBeNull()
  })
  it('changesToApprove counts visible loaded rows with changes since approval', () => {
    const c = { verdict: 'merge', updated: true, approvedRef: 'aaaaaaaa1', ref: 'bbbbbbbb2' }
    expect(changesToApprove([r('a', c), r('b', c), r('c', { ...c, merged: true }), r('d', { ...c, checked: false }), r('e', { verdict: 'merge' })])).toBe(2)
  })
})

describe('fix-conflict launcher (B16)', () => {
  const preview = { id: 'tw261112_1000', baseSha: 'abc1234', worktree: '/wt/preview-x', features: [{ key: 'ai-sub', branch: 'wave36/ai-subscription' }, { key: 'other', branch: 'w/other' }] }
  const call = async (over = {}, { method = 'POST', body = { id: preview.id, key: 'ai-sub' } } = {}) => {
    const written = {}, launched = [], merged = []
    const route = fixConflictRoute({
      loopback: () => true, preview: () => preview, devlog: () => '/devlog/wave42', readBody: async () => body,
      mergeTree: async (...a) => { merged.push(a); return 'tree-sha\nCONFLICT (content): Merge conflict in a.ts\n' },
      write: (f, t) => { written[f] = t }, launch: async (f, task) => { launched.push([f, task]); return { window: '4711' } }, ...over,
    })
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b ? JSON.parse(b) : null } }
    await route({ method }, res)
    return { res, written, launched, merged }
  }
  it('writes the brief (branch, base, merge-tree output, rules) and launches the Sonnet session with the task; answers 202 with the brief path and window', async () => {
    const { res, written, launched, merged } = await call()
    expect(res.statusCode).toBe(202)
    expect(res.body).toEqual({ started: true, brief: '/devlog/wave42/conflict-ai-sub.txt', window: '4711' })
    expect(merged).toEqual([['/wt/preview-x', 'abc1234', 'wave36/ai-subscription']])
    const brief = written['/devlog/wave42/conflict-ai-sub.txt']
    for (const part of ['wave36/ai-subscription', 'abc1234', 'Merge conflict in a.ts', 'NEVER: push, touch main', 'fallback ladder']) expect(brief).toContain(part)
    expect(launched).toEqual([['/devlog/wave42/conflict-ai-sub.txt', 'fix the conflict of ai-sub']])
  })
  it('only POST from loopback, only for a row of this preview; a launcher failure is a 500 with its reason and nothing is hidden', async () => {
    expect((await call({}, { method: 'GET' })).res.statusCode).toBe(405)
    expect((await call({ loopback: () => false })).res.statusCode).toBe(403)
    for (const body of [{ id: preview.id, key: 'nope' }, { id: 'tw1', key: 'ai-sub' }, null]) expect((await call({}, { body })).res.statusCode).toBe(400)
    const bad = await call({ launch: async () => { throw new Error('another trustweb session is active: pi261112a (ACTIVE)') } })
    expect(bad.res.statusCode).toBe(500)
    expect(bad.res.body.error).toMatch(/another trustweb session is active/)
    expect((await call({}, { body: { id: preview.id, key: '../../etc/x' } })).res.statusCode).toBe(400)
  })
  // Review wave 42: pi_new_session.sh exits 3 when another session of the project is active; that is a refusal, not a server fault.
  it('a busy project (launcher exit 3) is a 409 with one sentence, not a 500', async () => {
    const busy = await call({ launch: async () => { throw launchError({ code: 3, stdout: 'refused: another session of trustweb is ACTIVE: pi261112a\n' }) } })
    expect(busy.res.statusCode).toBe(409)
    expect(busy.res.body.error).toMatch(/^Another pi session of this project is active \(pi261112a\)\. Finish or close it, then press again\.$/)
    const other = await call({ launch: async () => { throw launchError({ code: 1, stderr: 'boom\nlast line' }) } })
    expect(other.res.statusCode).toBe(500)
    expect(other.res.body.error).toBe('last line')
  })
})

describe('fix-conflict brief folder (review wave 42)', () => {
  const WOT = '/u/web-of-trust'
  const has = (...dirs) => (p) => dirs.includes(p)
  it('the newest wave of trustweb-ops/DEVLOG, found from a preview worktree and from the primary repo; never the stale web-of-trust/DEVLOG', () => {
    const ops = `${WOT}/Code/trustweb-ops/DEVLOG`
    expect(opsDevlogRoot(`${WOT}/Code/worktrees/preview-tw261112_1520/apps/trustweb`, has(ops, `${WOT}/DEVLOG`))).toBe(ops)
    expect(opsDevlogRoot(`${WOT}/Code/primary-repo/apps/trustweb`, has(ops))).toBe(ops)
  })
  it('TW_DEVLOG wins; no ops folder anywhere: null (the route then answers 500, nothing is written)', () => {
    expect(opsDevlogRoot('/x/apps/trustweb', has(), '/tmp/devlog')).toBe('/tmp/devlog')
    expect(opsDevlogRoot('/x/apps/trustweb', has())).toBeNull()
  })
})
