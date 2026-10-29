import { LinkChange, changePrimaryName } from '../../src/link_change.ts'
import { ClaimError } from '../../src/connect_code.ts'

const names = (name, aliases = [], locked = []) => ({ name, aliases, locked })
function run(raw, { held = names('japossert'), confirm = true, outcome } = {}) {
  const log = { confirm: [], claim: [] }
  const p = changePrimaryName({
    names: held,
    raw,
    confirm: async (from, to) => { log.confirm.push([from, to]); return confirm },
    claim: async (n) => { log.claim.push(n); return outcome ?? { ok: true, names: names(n) } },
  })
  return p.then((r) => ({ r, log }))
}

describe('changePrimaryName', () => {
  it('cancel: asks once, sends nothing', async () => {
    const { r, log } = await run('Jakob.P', { confirm: false })
    expect(r).toEqual({ kind: LinkChange.Cancelled })
    expect(log.confirm).toEqual([['japossert', 'jakob.p']])
    expect(log.claim).toEqual([])
  })
  it('confirm: claims the cleaned name as the PRIMARY (not an alias)', async () => {
    const { r, log } = await run('  Jakob.P ')
    expect(r.kind).toBe(LinkChange.Done)
    expect(log.claim).toEqual(['jakob.p'])
  })
  it('the server refusing is passed on', async () => {
    const { r } = await run('taken', { outcome: { ok: false, error: ClaimError.Taken } })
    expect(r).toEqual({ kind: LinkChange.Refused, error: ClaimError.Taken })
  })
  it('the same name changes nothing and asks nothing', async () => {
    const { r, log } = await run('japossert')
    expect(r).toEqual({ kind: LinkChange.Same })
    expect(log.confirm).toEqual([])
    expect(log.claim).toEqual([])
  })
  it('a bad name is refused before any question', async () => {
    const { r, log } = await run('a!')
    expect(r).toEqual({ kind: LinkChange.Bad })
    expect(log.confirm).toEqual([])
  })
  it('a locked main name cannot be replaced from here', async () => {
    const { r, log } = await run('other', { held: names('japossert', [], ['japossert']) })
    expect(r).toEqual({ kind: LinkChange.Locked })
    expect(log.confirm).toEqual([])
    expect(log.claim).toEqual([])
  })
  it('no name held yet: nothing to lose, still asks', async () => {
    const { r, log } = await run('fresh', { held: names('') })
    expect(r.kind).toBe(LinkChange.Done)
    expect(log.confirm).toEqual([['', 'fresh']])
  })
})

describe('the rename warning (username-hold)', () => {
  it('says the old name stays blocked for 2 years and its links stop now; never "anyone can claim"', async () => {
    const { S } = await import('../../src/strings.ts')
    const text = S.unLinkSure('ada', 'bob')
    expect(text).toContain('Your old name stays blocked for 2 years; links with it stop working now.')
    expect(text).not.toMatch(/anyone can/i)
  })
})
