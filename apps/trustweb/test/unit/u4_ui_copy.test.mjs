/**
 * Wave 6 (U4 d, e): small pure rules behind the app wiring: the title of an answer card that came back through somebody.
 */
import { answerTitle } from '../../src/hops_view.ts'

describe('answerTitle: who is credited on a card', () => {
  it('own lines: "chose to share"', () => {
    expect(answerTitle('Ben', [{}, { via: undefined }])).toBe('Ben chose to share')
  })
  it('every line came back through them: "passed this on", never "chose to share"', () => {
    expect(answerTitle('Ben', [{ via: ['Ben'] }, { via: ['Ben', 'Cleo'] }])).toBe('Ben passed this on')
  })
  it('a mix keeps "chose to share" (one line is theirs)', () => {
    expect(answerTitle('Ben', [{ via: ['Ben'] }, {}])).toBe('Ben chose to share')
  })
  it('no lines, or a malformed via, never reads as passed on', () => {
    expect(answerTitle('Ben', [])).toBe('Ben chose to share')
    expect(answerTitle('Ben', [{ via: 'Ben' }, { via: [7, null] }])).toBe('Ben chose to share')
  })
})
