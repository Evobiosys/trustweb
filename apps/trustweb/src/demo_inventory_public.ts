/**
 * Jakob's public demo lines (owner, 2026-10-07 13:19): ten inventory lines he
 * ticked "allow in advance", shown in the demo web as the dummy person
 * "Jakob" (seed.ts) and served by the demo front door (services/trustweb-peer/
 * demo_inventory.json, kept in step by test/unit/demo_inventory_public.test.mjs).
 *
 * The text is verbatim as ticked, typos included ("adapatation", "reliabile"):
 * an edit would make it a different line from the one he allowed. Line 2 holds
 * a server path, kept as ticked (flagged to the owner in the wave-4 report).
 *
 * ONLY these ten lines may sit on that person. His other ticked lines are
 * private and appear nowhere in this repository; test/unit/
 * demo_inventory_public.test.mjs guards that with an allowlist (the real
 * guard) and a digest denylist (the backup). Adding a line here means the
 * owner allowed it in advance: change the test's list in the same commit.
 */
import { Audience, Tag } from './model'
import type { Person } from './model'

export interface PublicDemoLine {
  text: string
  tag: Tag
  /** Who can ask. Absent: the default below (the owner proposes per-line audiences in a later iteration). */
  audience?: Audience
}

/** What a hand-noted line gets in the app when nobody picked (the recording and person-note default). */
export const PUBLIC_LINE_DEFAULT_AUDIENCE: Audience = Audience.Friends

/** The demo person these lines belong to. The context pairs with the name when "Start clean" recognises seeded people. */
export const JAKOB_DEMO_NAME = 'Jakob'
export const JAKOB_DEMO_CONTEXT = 'TrustWeb founder, public demo lines'

/**
 * The seeded owner person (name plus context, as dummyIds matches seeded people). He belongs to the embedded demo
 * web only: a live phone never gets him, neither by "Show demo content" nor by a carry-over from the demo, because a
 * real web would then claim a Ring.Friend tie to a real person that nobody made (review-wave4, 2026-10-07).
 */
export function isPublicDemoPerson(p: Pick<Person, 'name' | 'context'>): boolean {
  return p.name === JAKOB_DEMO_NAME && p.context === JAKOB_DEMO_CONTEXT
}

export const JAKOB_PUBLIC_LINES: readonly PublicDemoLine[] = [
  { text: 'I keep a tech stack doc covering LLM/AI, infrastructure, dev tools, knowledge, and communication channels.', tag: Tag.Note },
  { text: 'I have a tech stack file at /root/resources/tech-stack.md.', tag: Tag.Note },
  { text: "I'm publishing my code on GitHub and if it's big and successful we move to our self-hosted GitLab instance (also because of the multi-nested repos)", tag: Tag.Note },
  { text: "I have found the 'perfect' open-source license - an also-for-SaaS adapatation of the Mozilla license, which I dual-license with AGPL for F-Droid and OSI. And could triple license if someone asks", tag: Tag.Note },
  { text: 'If i try to get revenue with code I make my code AGPL by default, and teams can approach us for only the AMPL/ an also-for-SaaS adapatation of the Mozilla license license.', tag: Tag.Note },
  { text: 'I only use Matrix if verify that its reliabile of their services and have dedicated resources for that', tag: Tag.Note },
  { text: 'I could hold a workshop on the conceptual building blocks of trustweb.', tag: Tag.Offer },
  { text: "I work as a founder, and what I'm founding is the TrustWeb.one", tag: Tag.Note },
  { text: 'I use the Equal Earth over the Mercator projection for global maps', tag: Tag.Note },
  { text: 'I can help you clean up your online presence, making sure everywhere you show up on the web links to your current website.', tag: Tag.Offer },
]
