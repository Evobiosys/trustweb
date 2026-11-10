// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 41: a synthetic Obsidian vault of 20 notes (no real person): 8 people (People/, Contacts/, Notes/), 12 other notes (one is a template), plus .obsidian/workspace.json (not a note). Path -> text. */
export const VAULT = 'Greenhouse'

export const NOTES = {
  'People/Alma Brandt.md': '---\nname: Alma Brandt\nemail: alma.brandt@example.org\nphone: "+43 660 000 0001"\naliases: [Almi, A. Brandt]\ntags: [person, family]\n---\n# Alma\nCousin, lives in Graz. Plays cello. Birthday in May.\n',
  'People/Bruno Cesar.md': '---\nname: Bruno Cesar\nemails:\n  - bruno@example.org\n  - b.cesar@example.net\ntags:\n  - person\n  - garden\n---\nNeighbour, shares the tool shed. See [[Garden plan]].\n',
  'People/Chiara Dolan.md': 'Met at the seed swap 2025. Works on soil biology. #person #garden/soil\n',
  'People/Family/Dmitri Evers.md': '---\ntags: person\n---\nUncle Dmitri. Wine maker.\n',
  'Contacts/Elif Farkas.md': '---\nname: Elif Farkas\nphone: +43 660 000 0005\norg: Seed Library\n---\nRuns the seed library.\n',
  'Contacts/Fabio Gruber.md': 'Mechanic. Number in the phone.\n',
  'Notes/Greta Hollis.md': '---\ntype: person\naliases: Gret\n---\nOld school friend.\n',
  'Notes/Hugo Ivanov.md': '---\ntags: [person]\n---\nColleague from the co-op. Talks about [[Greta Hollis]].\n',
  'Projects/Garden plan.md': '# Garden plan\nWith [[Bruno Cesar]] and [[Chiara Dolan|Chiara]]. Beds north side. #garden #plan\n',
  'Projects/Seed swap.md': 'Date: spring. Invite [[Elif Farkas]], [[Alma Brandt]] and [[Almi]]. #events\n',
  'Projects/Cello night.md': 'Alma plays, [[Alma Brandt#Music]] brings the stands.\n',
  'Daily/2026-11-01.md': 'Called [[Fabio Gruber]] about the car. #todo\n',
  'Daily/2026-11-02.md': 'Dinner with [[Dmitri Evers]] and [[Hugo Ivanov]].\n```\n#not-a-tag in code\n```\n',
  'Daily/2026-11-03.md': 'Nothing about people today. ![[photo.png]] [[report.pdf]]\n',
  'Ideas/Compost.md': '# Compost\nHot compost needs nitrogen. #garden/soil\n',
  'Ideas/Reading list.md': '- [[Compost]]\n- Soil book\n',
  'Journal/Autumn.md': 'Autumn walk with [[Greta Hollis]].\n',
  'Journal/Winter.md': 'Planning: ask [[Bruno Cesar]] for the ladder.\n',
  'Journal/Spring.md': 'First seedlings. Ask [[Elif Farkas]] about the seeds.\n',
  'Templates/Person.md': '---\ntags: [person]\n---\n{{name}}\n',
  '.obsidian/workspace.json': '{"main":{}}',
}
export const NOTE_COUNT = Object.keys(NOTES).filter((p) => p.endsWith('.md') && !p.startsWith('.obsidian/')).length
