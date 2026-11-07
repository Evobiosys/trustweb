// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33 contacts-sync: Dex + generic CSV, content detection, e-mail and phone kept through planServices/decide. Synthetic data only. */
import { readFileSync } from 'node:fs'
import { detectFormat, parseFile } from '../../../crm/src/import/detect.ts'
import { autoMap, csvHeaders, parseGenericCsv } from '../../../crm/src/import/generic_csv.ts'
import { toCsv } from '../../src/contacts_export.ts'
import { Ring } from '../../src/model.ts'
import { EMAIL_FIELD } from '../../src/intending_reminder.ts'
import { planServices, commitPlan, pendingProposals, decide } from '../../src/services_import.ts'

const fx = (f) => readFileSync(new URL(`../../../crm/test/fixtures/contacts/${f}`, import.meta.url), 'utf8')
const DEX = 'full_name,first_name,last_name,description,job_title,company,birthday,birthday_year,last_seen_at,dex_email,dex_emails,dex_phone,dex_phones,dex_groups,dex_tags,id,user_id\n'
  + '"Eva Muster",Eva,Muster,Neighbour,Architect,Muster Bau,--05-17,1984,2026-01-02,Eva@Example.at,"eva@example.at;eva.m@example.com","+43 660 5550201","+43 660 5550201;+43 660 5550202","Friends ::: Work","a, b",1,9\n'
  + 'Fritz Probe,Fritz,Probe,,,,,,,,,,,,,2,9\n'
const GENERIC = 'Contact,E-Mail,Mobile,Employer,Date of birth,Comments,Misc\nHanna Test,hanna@example.at,+43 660 5550301,Test GmbH,1990-02-03,hello,x\n'
const NOW = Date.UTC(2026, 10, 7)
const opts = { me: 'Me Owner', now: NOW }
let n = 0
const newId = () => `id${++n}`

describe('detection by content', () => {
  it('Dex export header -> dex-csv, generic header -> generic-csv, Google stays Google, junk stays null', () => {
    expect(detectFormat('a.csv', DEX)).toBe('dex-csv')
    expect(detectFormat('b.csv', GENERIC)).toBe('generic-csv')
    expect(detectFormat('c.csv', fx('google_current.csv'))).toBe('google-csv')
    expect(detectFormat('d.csv', fx('google_legacy.csv'))).toBe('google-csv')
    expect(detectFormat('e.csv', fx('not_google.csv'))).toBeNull()
    expect(detectFormat('f.csv', 'a,b\n1,2')).toBeNull()
  })
})

describe('Dex CSV (headers from getdex.com/docs/workflows/export)', () => {
  it('keeps name, e-mails, phones, company, title, groups/tags, birthday with year', () => {
    const { format, result } = parseFile('dex.csv', DEX)
    expect(format).toBe('dex-csv')
    const [eva, fritz] = result.contacts
    expect(eva).toMatchObject({ name: 'Eva Muster', given: 'Eva', family: 'Muster', org: 'Muster Bau', title: 'Architect', note: 'Neighbour', birthday: '1984-05-17' })
    expect(eva.emails).toEqual(['eva@example.at', 'eva.m@example.com'])
    expect(eva.phones).toEqual(['+43 660 5550201', '+43 660 5550202'])
    expect(eva.labels).toEqual(['Friends', 'Work', 'a', 'b'])
    expect(fritz.name).toBe('Fritz Probe')
  })
})

describe('generic CSV with a column mapping', () => {
  it('auto-maps by header and lets the owner fix it', () => {
    expect(csvHeaders(GENERIC)).toEqual(['Contact', 'E-Mail', 'Mobile', 'Employer', 'Date of birth', 'Comments', 'Misc'])
    const m = autoMap(csvHeaders(GENERIC))
    expect(m).toEqual(['name', 'email', 'phone', 'org', 'birthday', 'note', null])
    const c = parseGenericCsv(GENERIC, 'g.csv').contacts[0]
    expect(c).toMatchObject({ name: 'Hanna Test', org: 'Test GmbH', birthday: '1990-02-03', note: 'hello', emails: ['hanna@example.at'], phones: ['+43 660 5550301'] })
    const fixed = [...m]
    fixed[6] = 'labels'
    expect(parseGenericCsv(GENERIC, 'g.csv', fixed).contacts[0].labels).toEqual(['x'])
  })
  it('builds the name from first + last and falls back to e-mail; skips empty rows', () => {
    const r = parseGenericCsv('First name,Surname,Email\nAnna,Gruber,a@example.at\n,,only@example.at\n,,\n', 'x.csv')
    expect(r.contacts.map((c) => c.name)).toEqual(['Anna Gruber', 'only@example.at'])
    expect(r.skipped).toBe(0)
  })
})

describe('services pipeline keeps e-mail and phone', () => {
  it('rows carry emails/phones; Accept writes EMAIL_FIELD, extra e-mails, channels, no overwrite', () => {
    const s = { people: [], serviceImports: [] }
    commitPlan(s, planServices(s, [{ name: 'dex.csv', text: DEX }], opts), 'b1', NOW)
    const [a] = pendingProposals(s, NOW).filter((p) => p.row.name === 'Eva Muster')
    expect(a.row.emails).toEqual(['eva@example.at', 'eva.m@example.com'])
    decide(s, 'b1', a.row.key, { do: 'accept' }, NOW, newId)
    const p = s.people.find((x) => x.name === 'Eva Muster')
    expect(p.fields[EMAIL_FIELD]).toBe('eva@example.at')
    expect(p.fields['email 2']).toBe('eva.m@example.com')
    expect(p.fields.phone).toBe('+43 660 5550201')
    expect(p.fields['phone 2']).toBe('+43 660 5550202')
    expect(p.channels).toEqual({ whatsapp: '+436605550201', signal: '+436605550201' })
    expect(p.fields.organization).toBe('Muster Bau')
    expect(p.fields['job title']).toBe('Architect')
    expect(p.fields.birthday).toBe('1984-05-17')
    expect(p.fields.labels).toBe('Friends, Work, a, b')
    expect(p.sources[0].source).toBe('dex-csv')
  })
  it('an existing person (same name) keeps typed e-mail and channels; empty slots get filled', () => {
    const typed = { id: 'p1', name: 'Eva Muster', ring: Ring.Friend, lines: [], fields: { [EMAIL_FIELD]: 'mine@example.at' }, channels: { whatsapp: '+431111111' } }
    const s = { people: [typed], serviceImports: [] }
    commitPlan(s, planServices(s, [{ name: 'dex.csv', text: DEX }], opts), 'b1', NOW)
    const a = pendingProposals(s, NOW).find((p) => p.row.name === 'Eva Muster')
    decide(s, 'b1', a.row.key, { do: 'accept' }, NOW, newId)
    expect(typed.fields[EMAIL_FIELD]).toBe('mine@example.at')
    expect(typed.fields['email 2']).toBe('eva@example.at')
    expect(typed.channels.whatsapp).toBe('+431111111')
    expect(typed.channels.signal).toBe('+436605550201')
    expect(typed.ring).toBe(Ring.Friend)
  })
  it('matches an existing person by phone or e-mail, not only by name', () => {
    const other = { id: 'p2', name: 'E. Muster', ring: Ring.Friend, lines: [], channels: { whatsapp: '+436605550201' } }
    const plan = planServices({ people: [other], serviceImports: [] }, [{ name: 'dex.csv', text: DEX }], opts)
    expect(plan.rows.find((r) => r.name === 'Eva Muster').dupe).toBe(true)
    expect(plan.rows.find((r) => r.name === 'Fritz Probe').dupe).toBeUndefined()
  })
  it('a Google vCard and CSV keep e-mail and phone too', () => {
    for (const [f, src] of [['google_takeout_v30.vcf', 'vcard'], ['google_current.csv', 'google-csv']]) {
      const plan = planServices({ people: [], serviceImports: [] }, [{ name: f, text: fx(f) }], opts)
      expect(plan.counts[src]).toBeGreaterThan(0)
      expect(plan.rows.some((r) => r.emails?.length)).toBe(true)
      expect(plan.rows.some((r) => r.phones?.length)).toBe(true)
    }
  })
})

describe('export -> import round trip', () => {
  it('my CSV export is read back by the generic importer with the same names, e-mails and phones', () => {
    const p = { id: 'a', name: 'Anna Muster', context: '', ring: 'close', metAt: 0, lines: [], fields: { [EMAIL_FIELD]: 'anna@example.at', 'email 2': 'anna@example.com', phone: '+43 660 5550001', organization: 'Muster Bau' }, channels: {} }
    const text = toCsv([p], { now: NOW, ringLabel: (r) => String(r), lastContact: () => undefined })
    const { format, result } = parseFile('my-web.csv', text)
    expect(format).toBe('generic-csv')
    expect(result.contacts[0]).toMatchObject({ name: 'Anna Muster', emails: ['anna@example.at', 'anna@example.com'], phones: ['+43 660 5550001'], org: 'Muster Bau' })
  })
})
