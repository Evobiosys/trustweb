// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39: a synthetic vcf of 30 cards (no real person): 22 distinct names with e-mail + phone (some with CATEGORIES), 2 duplicates, 3 date-named and 3 phone-only junk cards. */
const pad = (n, w = 2) => String(n).padStart(w, '0')
const card = (fn, { email, tel, cats, uid }) => [
  'BEGIN:VCARD', 'VERSION:3.0', `FN:${fn}`, `N:;${fn};;;`, ...(email ? [`EMAIL:${email}`] : []), ...(tel ? [`TEL:${tel}`] : []), ...(cats ? [`CATEGORIES:${cats}`] : []), `UID:${uid}`, 'END:VCARD',
].join('\r\n')

export const NAMES = ['Alma Brandt', 'Bruno Cesar', 'Chiara Dolan', 'Dmitri Evers', 'Elif Farkas', 'Fabio Gruber', 'Greta Hollis', 'Hugo Ivanov', 'Ines Jovanovic', 'Jonas Keller', 'Klara Lindqvist',
  'Luca Moretti', 'Maja Novak', 'Nils Ostrom', 'Olga Petrov', 'Pavel Quast', 'Rosa Sandoval', 'Stefan Tamm', 'Tessa Ulrich', 'Ulf Vogel', 'Vera Wendt', 'Yusuf Zeman']

export function syntheticVcf() {
  const cards = []
  for (let i = 1; i <= 22; i++) {
    const cats = i <= 8 ? 'Minerva' : i <= 12 ? 'Keep Contact' : i <= 14 ? 'Minerva,Family Updated' : ''
    cards.push(card(NAMES[i - 1], { email: `test.${pad(i)}@example.org`, tel: `+43660000${pad(i, 4)}`, cats, uid: `u${i}` }))
  }
  // two duplicates of 01 and 02 (same e-mail, other spelling)
  cards.push(card('Alma Brandtt', { email: 'test.01@example.org', tel: '', cats: 'Minerva', uid: 'd1' }))
  cards.push(card('B. Cesar', { email: 'test.02@example.org', tel: '', cats: '', uid: 'd2' }))
  for (const [i, d] of ['Mar 15, 2020 8:40:21 PM', 'Feb 16, 2020 9:16:33 PM', 'Dec 16, 2019 6:54:22 AM'].entries()) cards.push(card(d, { tel: `+4366011${pad(i, 4)}`, uid: `t${i}` }))
  for (let i = 0; i < 3; i++) cards.push(card(`+43 660 22${pad(i, 4)}`, { tel: `+43 660 22${pad(i, 4)}`, uid: `n${i}` }))
  return cards.join('\r\n') + '\r\n'
}
