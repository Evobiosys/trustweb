/** Wave 18: the rings web is named "Trust membranes" where a view is named; the product title stays. */
import { S } from '../../src/strings.ts'
import { HintId } from '../../src/model.ts'

describe('Trust zones wording', () => {
  it('the web hint explains the rings as trust zones', () => {
    expect(S.hintText[HintId.WebTap]).toContain('rings (trust zones)')
  })
  it('the screen title stays the product', () => {
    expect(S.webTitle).toBe('TrustZones')
  })
})
