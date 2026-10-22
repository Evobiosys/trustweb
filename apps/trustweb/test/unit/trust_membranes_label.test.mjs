/** Wave 18: the rings web is named "Trust membranes" where a view is named; the product title stays. */
import { S } from '../../src/strings.ts'
import { HintId } from '../../src/model.ts'

describe('Trust membranes wording', () => {
  it('the web hint explains the rings as trust membranes, also called trust zones', () => {
    expect(S.hintText[HintId.WebTap]).toContain('rings (trust membranes, also called trust zones)')
  })
  it('the screen title stays the product', () => {
    expect(S.webTitle).toBe('Your TrustWeb')
  })
})
