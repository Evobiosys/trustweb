/**
 * The ask action is called "Call into your web" everywhere in the app (wave 5 item k; owner 2026-10-07, as the website says).
 * Walks every string of strings.ts (functions are called with plain arguments).
 */
import { S } from '../../src/strings.ts'

function allStrings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (typeof value === 'function') { try { allStrings(value('x', 1, 2), out) } catch { /* needs other arguments */ } }
  else if (value && typeof value === 'object') for (const v of Object.values(value)) allStrings(v, out)
  return out
}

describe('Call into your web', () => {
  it('names the button, the sheet title, the send button and the settings heading', () => {
    expect(S.webCall).toBe('Call into your web')
    expect(S.queryTitle).toBe('Call into your web')
    expect(S.querySend).toBe('Call into my web')
    expect(S.setQuery).toBe('Calling into your web')
    expect(S.setQueryLabel.call).toBe('Call into your web')
  })
  it('no string still names the action "Ask your web", "Ask my web", "Ask the web" or "Asking your web"', () => {
    const old = /\bask(ing)? (your|my|the) web\b/i
    expect(allStrings(S).filter((s) => old.test(s))).toEqual([])
  })
  it('the empty state and the demo-account copy use the new name', () => {
    expect(S.foundNone).toMatch(/Call into your web/)
    expect(S.demoAcctAllowed('Anna')).toBe('Allowed. Anna can call into your web now.')
    expect(S.demoAcctAllowBody).toMatch(/call into your web/)
  })
})
