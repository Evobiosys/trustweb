// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24b feedback-z: the small Zach/Levi wording and cue fixes (strings first, one DOM seam each). */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { S } from '../../src/strings.ts'
import { ICONS } from '../../src/icons.ts'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')
const read = (f) => readFileSync(path.join(SRC, f), 'utf8')

describe('Z6 note input save cue', () => {
  it('has a label and a Save button text', () => {
    expect(S.noteLabel).toBeTruthy()
    expect(S.noteSave).toBe('Save')
    expect(S.noteSaved).toMatch(/phone/)
  })
})

describe('Z7 ask icon', () => {
  it('is a person with a plus, not the wifi arcs, and the fabs use it', () => {
    expect(ICONS.ask).toMatch(/^<svg viewBox="0 0 24 24">/)
    expect(ICONS.ask).toContain('circle')
    expect(ICONS.ask).not.toBe(ICONS.call)
    // wave 25: the fabs draw src/icons/ask_web.ts (two people, "?" badge, arcs)
    expect(read('main.ts')).toMatch(/call \? askWebIcon\(/)
    expect(read('main.ts')).toMatch(/innerHTML = askWebIcon\(/)
  })
})

describe('Z8 fab label', () => {
  it('is larger than 13.5px', () => {
    expect(read('styles.css')).toMatch(/\.fab-two\{[^}]*font-size:16px/)
  })
})

describe('Z9 your answers + required text', () => {
  it('names the row and hints at the missing text', () => {
    expect(S.queryAnswers).toMatch(/^Your answers/)
    expect(S.queryNeedText).toMatch(/question/i)
  })
  it('the row no longer waits for the Feed to be off', () => {
    expect(read('main.ts')).not.toMatch(/!run && !feedOn\(s\) && \(s\.found/)
  })
})

describe('Z10 Record Save', () => {
  it('the local recording is saved, not sent', () => {
    expect(S.recSave).toBe('Save')
    expect(read('main.ts')).toMatch(/roundButton\('send', S\.recSave/)
  })
})

describe('Z15 Signal hint', () => {
  it('chat sheet says to use Signal for longer messages', () => {
    expect(S.chatLongHint).toBe('Use Signal for longer messages')
    expect(read('chat_view.ts')).toContain('S.longHint')
  })
})

describe('L2 who sees the search', () => {
  it('the query sheet states it', () => {
    expect(S.querySees).toMatch(/see/i)
    expect(read('main.ts')).toContain('S.querySees')
  })
})

describe('Z1/Z2 concept copy', () => {
  it('Who can ask separates who may search, whose information, who approves', () => {
    const t = S.cascadeInfo[0]
    expect(t).toMatch(/Who may search/)
    expect(t).toMatch(/Whose information/)
    expect(t).toMatch(/Who approves/)
  })
  it('a line is an item extracted from a note', () => {
    expect(S.cascadeInfo.join(' ')).toMatch(/item extracted from a note/)
    expect(S.cascadeInfo.join(' ')).toMatch(/Lines from a recording or a meeting start as Close friends/)
  })
})

describe('Z12 agreements', () => {
  it('open-ended agreements say so, and the row wraps at 360px', () => {
    expect(S.agrOpenEnded).toBe('no end date')
    expect(read('agreements_view.ts')).toContain('S.agrOpenEnded')
    expect(read('styles.css')).toMatch(/\.agr-row[^{]*\{[^}]*overflow-wrap:anywhere/)
  })
})
