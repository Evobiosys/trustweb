import { describe, expect, it } from 'vitest'
import { parseVCard } from '../../src/import/vcard'
import { ContactSource } from '../../src/import/types'
import android from '../fixtures/contacts/android_v21.vcf?raw'
import google from '../fixtures/contacts/google_takeout_v30.vcf?raw'
import icloud from '../fixtures/contacts/icloud_v30.vcf?raw'
import v40 from '../fixtures/contacts/v40.vcf?raw'
import broken from '../fixtures/contacts/broken.vcf?raw'

const files = { 'android_v21.vcf': android, 'google_takeout_v30.vcf': google, 'icloud_v30.vcf': icloud, 'v40.vcf': v40, 'broken.vcf': broken }
const fixture = (name: keyof typeof files) => parseVCard(files[name], name)
const card = (...lines: string[]) => ['BEGIN:VCARD', ...lines, 'END:VCARD'].join('\n')
const one = (...lines: string[]) => parseVCard(card(...lines), 'x.vcf').contacts[0]

describe('fixtures', () => {
  it('android 2.1: quoted-printable umlauts, soft breaks, phone de-dup, phone-only card', () => {
    const r = fixture('android_v21.vcf')
    expect(r.skipped).toBe(0)
    expect(r.contacts).toHaveLength(2)
    const [a, b] = r.contacts
    expect(a).toMatchObject({ source: ContactSource.VCard, file: 'android_v21.vcf', sourceRef: '#1', name: 'Gerhärd Müller', given: 'Gerhärd', family: 'Müller' })
    expect(a.phones).toEqual(['+43 660 5550101'])
    expect(a.emails).toEqual(['gerhard.mueller@example.at'])
    expect(a.note).toBe('Kennengelernt in Grätz, über Anna.')
    expect(b).toMatchObject({ sourceRef: '#2', name: '0660 555 0102' })
  })

  it('google takeout 3.0: escapes, org first component, labels, ORG-only name, no-year birthday', () => {
    const [m, v] = fixture('google_takeout_v30.vcf').contacts
    expect(m).toMatchObject({ sourceRef: 'google-maria-huber', name: 'Maria Huber', org: 'Huber Tischlerei', title: 'Tischlerin', birthday: '1985-03-12', note: 'Line one\nLine two, with comma' })
    expect(m.emails).toEqual(['maria.huber@example.at'])
    expect(m.labels).toEqual(['myContacts', 'Nachbarn'])
    expect(v).toMatchObject({ name: 'Verein Gruenes Graz', birthday: '--07-04', sourceRef: '#2' })
  })

  it('icloud 3.0: grouped properties, big folded PHOTO ignored', () => {
    const r = fixture('icloud_v30.vcf')
    expect(r.contacts).toHaveLength(1)
    expect(r.contacts[0]).toMatchObject({ name: 'Dr. Lukas Berger', phones: ['+43 660 5550122'], emails: ['lukas@example.com'], birthday: '1985-03-12' })
  })

  it('4.0: tel: uri, uid, compact birthday, categories', () => {
    const [c] = fixture('v40.vcf').contacts
    expect(c).toMatchObject({ sourceRef: 'urn:uuid:11111111-2222-3333-4444-555555555555', phones: ['+43-660-5550133'], birthday: '1990-01-01', labels: ['Familie', 'Freunde'] })
  })

  it('broken: unfinished cards and nameless cards skipped, the rest survives', () => {
    const r = fixture('broken.vcf')
    expect(r.contacts.map((c) => c.name)).toEqual(['Valid After Broken'])
    expect(r.skipped).toBe(3)
  })
})

describe('format details', () => {
  it('case-insensitive markers, CRLF, folding, grouping prefix, lower-case params', () => {
    const text = 'begin:vcard\r\nversion:3.0\r\nFN:Anna\r\n  Schmid\r\nitem1.tel;type=cell:+43 660\r\n 5550150\r\nend:vcard\r\n'
    expect(parseVCard(text, 'f').contacts[0]).toMatchObject({ name: 'Anna Schmid', phones: ['+43 6605550150'] })
  })

  it('name fallbacks: FN, N, ORG, email, phone, none', () => {
    expect(one('FN:Fe', 'N:Fa;Gi;;;').name).toBe('Fe')
    expect(one('N:Fa;Gi;Ad;Pre;Suf').name).toBe('Gi Fa')
    expect(one('N:;;;;', 'ORG:Firma;Abt', 'EMAIL:a@example.at').name).toBe('Firma')
    expect(one('EMAIL:A@Example.at', 'TEL:+43 1').name).toBe('a@example.at')
    expect(one('TEL:+43 660 5550199').name).toBe('+43 660 5550199')
    expect(parseVCard(card('TITLE:Nobody'), 'f')).toEqual({ contacts: [], skipped: 1 })
  })

  it('birthday formats', () => {
    const b = (v: string) => one('FN:A', `BDAY:${v}`).birthday
    expect([b('19850312'), b('1985-03-12'), b('--0312'), b('--03-12')]).toEqual(['1985-03-12', '1985-03-12', '--03-12', '--03-12'])
    expect([b('March 12'), b('1985-13-01'), b('')]).toEqual([undefined, undefined, undefined])
  })

  it('uid, else position from 1', () => {
    const r = parseVCard([card('FN:A', 'UID:u1'), card('FN:B')].join('\n'), 'f')
    expect(r.contacts.map((c) => c.sourceRef)).toEqual(['u1', '#2'])
  })

  it('escapes in names and unknown properties are ignored', () => {
    const c = one('FN:Huber\\, Maria', 'X-FOO:bar', 'PHOTO:xxxx')
    expect(c.name).toBe('Huber, Maria')
  })

  it('emails lower-cased and de-duplicated, phones de-duplicated', () => {
    const c = one('FN:A', 'EMAIL:X@Example.at', 'EMAIL:x@example.at', 'TEL:1', 'TEL:1', 'TEL:2')
    expect([c.emails, c.phones]).toEqual([['x@example.at'], ['1', '2']])
  })
})

describe('robustness', () => {
  it('empty string', () => {
    expect(parseVCard('', 'f')).toEqual({ contacts: [], skipped: 0 })
  })

  it('never throws on random bytes', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const bits = ['BEGIN:VCARD', 'END:VCARD', 'TEL;ENCODING=QUOTED-PRINTABLE:=', 'FN;CHARSET=nope;QUOTED-PRINTABLE:=ZZ=C', '\\', ':', ';', '\r', '\n', ' ']
    for (let i = 0; i < 300; i++) {
      let s = ''
      for (let j = 0; j < 200; j++) s += rnd() < 0.3 ? bits[Math.floor(rnd() * bits.length)] : String.fromCharCode(Math.floor(rnd() * 256))
      expect(() => parseVCard(s, 'f')).not.toThrow()
    }
  })

  it('5,000 cards with photos parse under 1 s', () => {
    const photo = 'PHOTO;ENCODING=b;TYPE=JPEG:' + ('A'.repeat(75) + '\r\n ').repeat(40)
    const cards = Array.from({ length: 5000 }, (_, i) => `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Person ${i}\r\n${photo}\r\nEND:VCARD\r\n`)
    const t = performance.now()
    const r = parseVCard(cards.join(''), 'big.vcf')
    expect(performance.now() - t).toBeLessThan(1000)
    expect(r.contacts).toHaveLength(5000)
  })
})
