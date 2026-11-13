// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 in-person-e2e: MCP parity for the Meet-in-person code. connect_code shows this phone's code (never the secret); connect_redeem checks a typed code. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const CODE = 'AbCdEfGhIjKlMnOpQrStUv'
const OTHER = 'ZyXwVuTsRqPoNmLkJiHgFe'
const SECRET = 'S'.repeat(43)
const mine = { code: CODE, secret: SECRET, url: 'https://app.trustweb.one/?connect=did%3Apeer%3A2.x&id=1', updatedAt: 1 }

function tools(connectCode) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-mcp-conn-')), 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [], ...(connectCode ? { connectCode } : {}) }))
  return Object.fromEntries(recordTools({ file, write: false }).map((t) => [t.name, t]))
}

describe('connect_code', () => {
  it('gives the code and the code link, never the secret or the long link', () => {
    const out = tools(mine).connect_code.run({})
    expect(out).toEqual({ code: CODE, link: `https://app.trustweb.one/c/${CODE}` })
    expect(JSON.stringify(out)).not.toContain(SECRET)
  })
  it('names a held username', () => {
    expect(tools({ ...mine, name: 'ada' }).connect_code.run({})).toMatchObject({ code: CODE, name: 'ada' })
  })
  it('says there is no code yet instead of failing', () => {
    expect(tools(undefined).connect_code.run({})).toEqual({ code: null, note: 'No code yet: open Meet on the phone once, it makes one.' })
  })
  it('a damaged connectCode counts as none', () => {
    expect(tools({ code: 'short', secret: SECRET, url: 'x', updatedAt: 1 }).connect_code.run({}).code).toBeNull()
  })
})

describe('connect_redeem', () => {
  it('takes a bare code, a /c/ link on an app origin, and gives the link that opens the add sheet', () => {
    const t = tools(mine)
    expect(t.connect_redeem.run({ code: OTHER })).toEqual({ ok: true, code: OTHER, link: `https://app.trustweb.one/c/${OTHER}` })
    expect(t.connect_redeem.run({ code: `https://app.trustintheweb.org/c/${OTHER}` }).code).toBe(OTHER)
    expect(t.connect_redeem.run({ code: `  ${OTHER}\n` }).ok).toBe(true)
  })
  it('refuses with one sentence: empty, another host, not a code, this phone\'s own code', () => {
    const t = tools(mine)
    for (const bad of ['', 'x', `https://evil.example/c/${OTHER}`, 'did:peer:2.abc', CODE]) {
      const out = t.connect_redeem.run({ code: bad })
      expect(out.ok).toBe(false)
      expect(typeof out.error).toBe('string')
      expect(out.error.split(/[.!?]\s/).length).toBeLessThanOrEqual(2)
    }
    expect(t.connect_redeem.run({ code: CODE }).error).toMatch(/your own/i)
  })
  it('never touches the record', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-mcp-conn-')), 'record.json')
    const body = JSON.stringify({ v: 1, people: [], connectCode: mine })
    writeFileSync(file, body)
    const t = Object.fromEntries(recordTools({ file, write: true }).map((x) => [x.name, x]))
    t.connect_redeem.run({ code: OTHER })
    expect(require('node:fs').readFileSync(file, 'utf8')).toBe(body)
  })
})

describe('settings list', () => {
  it('both tools are in the MCP tool list the settings page and TW_MCP_TOOLS use, as read tools', () => {
    for (const n of ['connect_code', 'connect_redeem']) expect(MCP_TOOLS).toContainEqual({ name: n, write: false })
  })
})
