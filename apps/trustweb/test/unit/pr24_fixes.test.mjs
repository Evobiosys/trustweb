/** PR #24 review (R3, R4, R9): main.ts is not importable, so these read its source for the three guards. */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const main = readFileSync(path.join(import.meta.dirname, '../../src/main.ts'), 'utf8')
const body = (name) => main.slice(main.indexOf(`function ${name}(`)).split(/\n}\n/)[0]

describe('profile and agreements guards in main.ts', () => {
  it('R3: the profile is not sent at connect; only the owner\'s tap calls sendProfileTo', () => {
    expect(body('sendHelloTo')).not.toContain('sendProfileTo')
    expect([...main.matchAll(/sendProfileTo\(/g)]).toHaveLength(2) // the definition and the tap
    expect(main).toContain("onclick: () => sendProfileTo(peer)")
    expect(main).not.toMatch(/profileShare|profileSent/)
  })
  it('R4: sendProfileTo refuses demo persona, solo and demo accounts, as sendHelloTo does', () => {
    expect(body('sendProfileTo')).toMatch(/^function sendProfileTo[^\n]*\n  if \(noSendTo\(peer\)\) return/)
    expect(body('sendHelloTo')).toContain('noSendTo(peer)')
    expect(main).toMatch(/const noSendTo = \(peer: Peer\): boolean => isDemoPersona\(persona\) \|\| solo \|\| demoAccounts\(\)/)
  })
  it('wave 20: the automatic zone slice refuses demo phones, honours the Settings switch and is sent from the connect and ring-change hooks only', () => {
    expect(body('autoShareProfile')).toContain('!s.profileAutoOff && !noSendTo(peer)')
    expect(body('autoShareProfile')).toContain('autoSendRank(')
    expect([...main.matchAll(/autoShareProfile\(peer, 'public'\)/g)]).toHaveLength(3) // both onPeerConnected branches + restored invitation
    expect([...main.matchAll(/autoShareToPerson\(/g)]).toHaveLength(6) // changeRing, both add sheets, the curator, the two scanner-side connects (Jakob 21:42)
  })
  it('R9: incoming agreement texts are dropped for reach-out senders', () => {
    expect(body('onAgreementText')).toContain('!mayAnswerRequest(peer, person)')
  })
})
