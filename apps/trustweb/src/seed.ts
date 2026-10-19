/**
 * Seeded content for the solo split view: two personas on one laptop, each
 * with its own storage record (store.ts) and its own relay identity, paired
 * through the real one-scan connect link.
 *
 * Four demo contexts (DemoContext, chosen by the page's own path or its
 * ?for= parameter -- see solo.ts detectContext()), each its own small, deliberately uncrowded
 * network (5-7 people) with queryable-line variety across different Tag
 * types and rings, so a funder trying the Query flow has several different
 * things to ask about without the "People" list feeling like a phonebook:
 *
 *   - Generic  (demo/):           fictional contacts only, no real people (Jakob, the
 *                                 owner, aside: see the end of this comment).
 *   - Emergent (emergent-demo/):  fictional Emergent Ventures grantee
 *                                 personas, plus Tyler Cowen at
 *                                 Ring.Intending -- see below.
 *   - Ea       (ea-demo/):        fictional effective-giving/EA conference
 *                                 personas (researcher, fund manager,
 *                                 community organizer, ...), no real people.
 *   - Otf      (demo/?for=otf):   fictional internet-freedom personas (journalist,
 *                                 digital-rights lawyer, security trainer, exiled
 *                                 blogger, press-freedom NGO), no real people; for
 *                                 Open Technology Fund reviewers (2026-10-19). Its
 *                                 "Only me" line (a driver at the border) is the
 *                                 probe that stays silent, like Maya's spare room.
 *
 * Maya (holder) always carries two things she can lend or offer, Loudspeakers
 * and "Couch when you are in Vienna" (wave 5, owner 2026-10-07: things beyond
 * housing; they replaced the motorbike), plus notes that answer the two
 * illustrated examples: a job lead (Example A) and a new fund (Example B).
 * Her spare room is "Only me", to show that a line shared with nobody reads
 * as "no match". This inventory is the same across every context -- the
 * acceptance script (test/e2e/acceptance.mjs) and the matcher regression test
 * (apps/demo/test/trustweb_match.test.ts) both depend on it and neither reads
 * People, so it is safe to vary People freely per context.
 *
 * None of the seeded People lines use the words "loudspeaker"/"speaker",
 * "couch"/"room", "visiting" or "Vienna", so they cannot interfere with the
 * acceptance script's loudspeakers ask, or produce a false match against
 * Maya's own OnlyMe spare room. Because "room" and "couch" are one synonym
 * group (lexicon.ts), a room ask in Vienna now surfaces the couch line, never
 * the OnlyMe room: the probe that proves the room stays silent is one only
 * that line answers ("a place for visiting friends"; see trustweb_match.test.ts,
 * which also proves the probe WOULD match the room if it were not OnlyMe).
 * Do not add a Vienna/room/visiting People line without re-running both.
 *
 * Tyler Cowen sits at Ring.Intending: someone Maya plans to meet, not yet in
 * her web. Per model.ts, audienceAdmits() returns false for that ring
 * regardless of a line's audience, and in any case he carries no `lines` at
 * all, so nothing about him is ever queryable. His `context` is a public
 * role description only (no invented private information), and the person
 * sheet shows that role instead of a fabricated "Met ..." line (see main.ts
 * personSheet).
 *
 * William MacAskill was removed from every context in demo-edit-2, then
 * reintroduced ea-demo-ONLY in demo-edit-3 (2026-09-27, owner request),
 * same Ring.Intending / no-lines / public-role-only pattern as Tyler Cowen
 * above -- see eaPeople() below. Do not add him to generic or emergent, and
 * do not add a third real person anywhere without the owner asking for it.
 *
 * Jakob (the owner himself) is in every context since 2026-10-07 13:19 ("include
 * this as a demo for the inventory in the demo embedded, with my data that I
 * have chosen to share publicly, the one allowed in advance as dummy data"):
 * Ring.Friend, carrying exactly the ten lines in demo_inventory_public.ts and
 * nothing else of his; they are marked dummy like all seeded content (markDemo,
 * dummyIds). They use no motorbike/Vienna wording, so the acceptance asks stay
 * unaffected.
 */
import { randomId } from '../../demo/src/crypto'
import { JAKOB_DEMO_CONTEXT, JAKOB_DEMO_NAME, JAKOB_PUBLIC_LINES, PUBLIC_LINE_DEFAULT_AUDIENCE } from './demo_inventory_public'
import { Audience, LineStatus, Ring, Tag } from './model'
import type { AppState, NoteLine, Person } from './model'

export enum Persona {
  Holder = 'holder',
  Seeker = 'seeker',
  /** Added with "Add a device" on the side-by-side page (2026-10-05). */
  Third = 'third',
  Fourth = 'fourth',
}

export const PERSONAS: readonly Persona[] = [Persona.Holder, Persona.Seeker, Persona.Third, Persona.Fourth]

export function isPersona(v: string | null): v is Persona {
  return v !== null && (PERSONAS as readonly string[]).includes(v)
}

/** The display name each demo persona's phone carries. */
export const PERSONA_NAMES: Record<Persona, string> = {
  [Persona.Holder]: 'Maya',
  [Persona.Seeker]: 'Jonas',
  [Persona.Third]: 'Sam',
  [Persona.Fourth]: 'Lena',
}

export enum DemoContext {
  Generic = 'generic',
  Emergent = 'emergent',
  Ea = 'ea',
  Otf = 'otf',
}

export const DEMO_CONTEXTS: readonly DemoContext[] = [DemoContext.Generic, DemoContext.Emergent, DemoContext.Ea, DemoContext.Otf]

export function isDemoContext(v: string | null): v is DemoContext {
  return v !== null && (DEMO_CONTEXTS as readonly string[]).includes(v)
}

const DAY = 86_400_000

/**
 * Texts of things an EARLIER build seeded into Maya's inventory and this build no longer does (wave 5 item i: the motorbike).
 * A demo phone seeded before still holds them, and dummyIds recognises seeded things by text, so "Start clean", "Dismiss them" and
 * the carry-over keep treating them as dummy content. Append here whenever a seeded thing is removed or renamed; never delete an entry.
 */
export const RETIRED_SEED_ITEM_TEXTS: readonly string[] = ['Motorbike (125cc), can lend it for a weekend']

function line(text: string, tag: Tag, audience: Audience, notedAt: number): NoteLine {
  return { id: randomId(8), text, tag, audience, status: LineStatus.Current, notedAt, checkedAt: notedAt }
}

function person(
  name: string, context: string, ring: Ring, metAt: number, lines: NoteLine[] = [],
): Person {
  return { id: randomId(8), name, context, ring, metAt, lines }
}

/** The owner's public demo lines as a person (see the module doc): one place, so every context shows the same ten. */
function jakobPerson(now: number): Person {
  return person(JAKOB_DEMO_NAME, JAKOB_DEMO_CONTEXT, Ring.Friend, now - 120 * DAY,
    JAKOB_PUBLIC_LINES.map((l) => line(l.text, l.tag, l.audience ?? PUBLIC_LINE_DEFAULT_AUDIENCE, now - 30 * DAY)))
}

function genericPeople(now: number): Person[] {
  return [
    person('Lena', 'former colleague', Ring.Friend, now - 400 * DAY, [
      line('We have a new position to fill: head of operations', Tag.Opportunity, Audience.FriendsOfFriends, now - 150 * DAY),
      line('Moving to Lisbon in spring', Tag.Note, Audience.OnlyMe, now - 150 * DAY),
    ]),
    person('Sam', 'EAGx, coffee break', Ring.Acquaintance, now - 90 * DAY, [
      line('Just opened a small fund for open-source tools', Tag.Resource, Audience.FriendsOfFriends, now - 90 * DAY),
    ]),
    person('Tomás', 'caught up at a meetup', Ring.Close, now - 800 * DAY, [
      line('Looking for funding for his biosecurity project', Tag.Looking, Audience.Friends, now - 150 * DAY),
    ]),
    person('Jasmin Öztürk', 'ops lead at a climate-tech startup', Ring.Acquaintance, now - 60 * DAY, [
      line('Hiring a frontend engineer for her climate-tech startup', Tag.Opportunity, Audience.FriendsOfFriends, now - 20 * DAY),
    ]),
    person('Aisha Konaté', 'community organizer, met at a workshop', Ring.Friend, now - 300 * DAY, [
      line('Has a spare guest bed in Lisbon for March', Tag.Offer, Audience.FriendsOfFriends, now - 15 * DAY),
    ]),
    person('Felix Novak', 'grantmaker, occasional coffee chats', Ring.Acquaintance, now - 200 * DAY, [
      line('Knows a strong candidate for a comms role', Tag.Talent, Audience.FriendsOfFriends, now - 5 * DAY),
    ]),
    jakobPerson(now),
  ]
}

function emergentPeople(now: number): Person[] {
  return [
    person('Priya Nair', '17, self-taught ML researcher, Emergent Ventures grant', Ring.Friend, now - 60 * DAY, [
      line('Looking for a mentor in interpretability research', Tag.Looking, Audience.FriendsOfFriends, now - 20 * DAY),
    ]),
    person('Marta Vidal', 'science writer, Emergent Ventures grant for a book on longevity research', Ring.Acquaintance, now - 100 * DAY, [
      line('Writing a book on longevity research, wants expert sources', Tag.Note, Audience.Friends, now - 10 * DAY),
    ]),
    person('Kwame Boateng', 'founder, building an open-data platform, Emergent Ventures grant', Ring.Close, now - 150 * DAY, [
      line('Looking for a technical co-founder', Tag.Looking, Audience.Friends, now - 25 * DAY),
    ]),
    person('Sam', 'EAGx, coffee break', Ring.Acquaintance, now - 90 * DAY, [
      line('Just opened a small fund for open-source tools', Tag.Resource, Audience.FriendsOfFriends, now - 90 * DAY),
    ]),
    person('Aisha Konaté', 'community organizer, met at a workshop', Ring.Friend, now - 300 * DAY, [
      line('Has a spare guest bed in Lisbon for March', Tag.Offer, Audience.FriendsOfFriends, now - 15 * DAY),
    ]),
    // Real public figure. Ring.Intending only, public role as context, no
    // lines: nothing of his is ever queryable (see module doc above).
    person('Tyler Cowen', 'Economist, Emergent Ventures', Ring.Intending, now, []),
    jakobPerson(now),
  ]
}

function eaPeople(now: number): Person[] {
  return [
    person('Elena Kovač', 'biosecurity researcher, met at a workshop', Ring.Close, now - 150 * DAY, [
      line('Looking for funding for her biosecurity project', Tag.Looking, Audience.Friends, now - 150 * DAY),
    ]),
    person('Marcus Feldman', 'fund manager at an effective-giving fund', Ring.Acquaintance, now - 90 * DAY, [
      line('Just opened a small fund for open-source tools', Tag.Resource, Audience.FriendsOfFriends, now - 90 * DAY),
    ]),
    person('Aisha Konaté', 'community organizer, met at a workshop', Ring.Friend, now - 300 * DAY, [
      line('Has a spare guest bed in Lisbon for March', Tag.Offer, Audience.FriendsOfFriends, now - 15 * DAY),
    ]),
    person('Noah Bergström', 'AI safety postdoc, met at a reading group', Ring.Close, now - 500 * DAY, [
      line('Open to research roles once his postdoc ends this winter', Tag.Looking, Audience.Friends, now - 40 * DAY),
    ]),
    person('Jasmin Öztürk', 'ops lead at a climate-tech startup', Ring.Acquaintance, now - 60 * DAY, [
      line('Hiring a frontend engineer for her climate-tech startup', Tag.Opportunity, Audience.FriendsOfFriends, now - 20 * DAY),
    ]),
    person('Felix Novak', 'grantmaker, occasional coffee chats', Ring.Acquaintance, now - 200 * DAY, [
      line('Knows a strong candidate for a comms role', Tag.Talent, Audience.FriendsOfFriends, now - 5 * DAY),
    ]),
    // Real public figure, ea-demo ONLY (see module doc above). Same pattern
    // as Tyler Cowen in emergentPeople(): Ring.Intending, no lines, public
    // role only, nothing about him is ever queryable.
    person('William MacAskill', 'Philosopher, effective altruism', Ring.Intending, now, []),
    jakobPerson(now),
  ]
}

function otfPeople(now: number): Person[] {
  return [
    person('Leyla Haddad', 'investigative journalist, met at a digital-security training', Ring.Close, now - 400 * DAY, [
      line('Looking for a trusted fixer for a reporting trip', Tag.Looking, Audience.Friends, now - 12 * DAY),
    ]),
    person('Daniel Okafor', 'digital-rights lawyer, met at a press-freedom conference', Ring.Acquaintance, now - 120 * DAY, [
      line('Lawyer who advises activists after a device seizure, pro bono', Tag.Offer, Audience.FriendsOfFriends, now - 30 * DAY),
    ]),
    person('Mira Petrova', 'security trainer, met at a newsroom workshop', Ring.Friend, now - 250 * DAY, [
      line('Runs secure-messaging trainings for newsrooms', Tag.Resource, Audience.FriendsOfFriends, now - 45 * DAY),
    ]),
    person('Arash Karimi', 'exiled blogger, met at a digital-rights meetup', Ring.Friend, now - 600 * DAY, [
      line('Can vouch for two translators who work with exile media', Tag.Talent, Audience.FriendsOfFriends, now - 20 * DAY),
      // Shared with nobody: the ask for it stays silent (the "Only me" probe of this context, see the module doc).
      line('Knows a driver who gets people across the border safely', Tag.Note, Audience.OnlyMe, now - 20 * DAY),
    ]),
    person('Sofía Ramírez', 'program officer at a press-freedom NGO', Ring.Acquaintance, now - 90 * DAY, [
      line('Small emergency fund for journalists at risk', Tag.Resource, Audience.FriendsOfFriends, now - 8 * DAY),
    ]),
    jakobPerson(now),
  ]
}

function peopleFor(context: DemoContext, now: number): Person[] {
  switch (context) {
    case DemoContext.Emergent: return emergentPeople(now)
    case DemoContext.Ea: return eaPeople(now)
    case DemoContext.Otf: return otfPeople(now)
    case DemoContext.Generic: default: return genericPeople(now)
  }
}

export function seedState(persona: Persona, now: number, context: DemoContext = DemoContext.Generic): AppState {
  if (persona === Persona.Holder) {
    return {
      v: 1,
      me: { id: 'maya-' + randomId(6), displayName: 'Maya' },
      peers: [],
      log: [],
      notificationsOn: false,
      inventory: [
        { id: randomId(8), text: 'Loudspeakers', audience: Audience.FriendsOfFriends, included: true, createdAt: now - 20 * DAY },
        { id: randomId(8), text: 'Couch when you are in Vienna', audience: Audience.FriendsOfFriends, included: true, createdAt: now - 40 * DAY },
        { id: randomId(8), text: 'Spare room in Vienna, for visiting friends', audience: Audience.OnlyMe, included: true, createdAt: now - 60 * DAY },
      ],
      people: peopleFor(context, now),
    }
  }
  if (persona === Persona.Third) {
    return {
      v: 1,
      me: { id: 'sam-' + randomId(6), displayName: PERSONA_NAMES[Persona.Third] },
      peers: [],
      log: [],
      notificationsOn: false,
      inventory: [
        { id: randomId(8), text: 'Spare desk in a coworking space, Fridays', audience: Audience.FriendsOfFriends, included: true, createdAt: now - 10 * DAY },
      ],
      people: [],
    }
  }
  return {
    v: 1,
    me: { id: (persona === Persona.Fourth ? 'lena-' : 'jonas-') + randomId(6), displayName: PERSONA_NAMES[persona] },
    peers: [],
    log: [],
    notificationsOn: false,
    inventory: [],
    people: [],
  }
}
