/**
 * The ask action is called "Ask your web" everywhere in the app (Jakob 2026-10-20; before: "Call into your web", wave 5 item k).
 * Walks every string of strings.ts (functions are called with plain arguments).
 */
import { S } from '../../src/strings.ts'

function allStrings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (typeof value === 'function') { try { allStrings(value('x', 1, 2), out) } catch { /* needs other arguments */ } }
  else if (value && typeof value === 'object') for (const v of Object.values(value)) allStrings(v, out)
  return out
}

describe('Ask your web', () => {
  it('names the button, the sheet title, the send button and the settings heading', () => {
    expect(S.webCall).toBe('Ask your web')
    expect(S.queryTitle).toBe('Ask your web')
    expect(S.querySend).toBe('Ask my web')
    expect(S.setQuery).toBe('Asking your web')
    expect(S.setQueryLabel.call).toBe('Ask your web')
  })
  it('no string still names the action "Call into your web", "Call into my web" or "Calling into your web"', () => {
    const old = /\bcall(ing)? into (your|my|the) web\b/i
    expect(allStrings(S).filter((s) => old.test(s))).toEqual([])
  })
  it('the empty state and the demo-account copy use the new name', () => {
    expect(S.foundNone).toMatch(/Ask your web/)
    expect(S.demoAcctAllowed('Anna')).toBe('Allowed. Anna can ask your web now.')
    expect(S.demoAcctAllowBody).toMatch(/ask your web/)
  })
})
