/**
 * Seeded content for the solo split view: two personas on one laptop, each
 * with its own storage record (store.ts) and its own relay identity, paired
 * through the real one-scan connect link.
 *
 * Three demo contexts (DemoContext, chosen by the page's own path -- see
 * solo.ts detectContext()), each its own small, deliberately uncrowded
 * network (5-7 people) with queryable-line variety across different Tag
 * types and rings, so a funder trying the Query flow has several different
 * things to ask about without the "People" list feeling like a phonebook:
 *
 *   - Generic  (demo/):           fictional contacts only, no real people.
 *   - Emergent (emergent-demo/):  fictional Emergent Ventures grantee
 *                                 personas, plus Tyler Cowen at
 *                                 Ring.Intending -- see below.
 *   - Ea       (ea-demo/):        fictional effective-giving/EA conference
 *                                 personas (researcher, fund manager,
 *                                 community organizer, ...), no real people.
 *
 * Maya (holder) always carries the motorbike (the "Motorrad" demo) plus
 * notes that answer the two illustrated examples: a job lead (Example A) and
 * a new fund (Example B). Her spare room is "Only me", to show that a line
 * shared with nobody reads as "no match". This inventory is the same across
 * every context -- the acceptance script (test/e2e/acceptance.mjs) and the
 * matcher regression test (apps/demo/test/trustweb_match.test.ts) both
 * depend on it and neither reads People, so it is safe to vary People freely
 * per context.
 *
 * None of the seeded People lines use the words "motorbike"/"motorcycle" or
 * "Vienna", so they cannot interfere with the acceptance script's existing
 * motorbike ask, or produce a false match against Maya's own "spare room in
 * Vienna" inventory item (Audience.OnlyMe -- it must stay silent to anyone
 * asking). Tomás's second line used to say "flatmate in Vienna" and DID
 * collide with that ask at Ring.Friend; it is gone now, not just renamed --
 * do not add a Vienna-flavoured People line back without re-running the
 * acceptance script's step 4 ("Who has a spare room in Vienna?" must stay
 * silent) against every ring a context uses.
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
 */
import { randomId } from '../../demo/src/crypto'
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
}

export const DEMO_CONTEXTS: readonly DemoContext[] = [DemoContext.Generic, DemoContext.Emergent, DemoContext.Ea]

export function isDemoContext(v: string | null): v is DemoContext {
  return v === DemoContext.Generic || v === DemoContext.Emergent || v === DemoContext.Ea
}

const DAY = 86_400_000

function line(text: string, tag: Tag, audience: Audience, notedAt: number): NoteLine {
  return { id: randomId(8), text, tag, audience, status: LineStatus.Current, notedAt, checkedAt: notedAt }
}

function person(
  name: string, context: string, ring: Ring, metAt: number, lines: NoteLine[] = [],
): Person {
  return { id: randomId(8), name, context, ring, metAt, lines }
}

function genericPeople(now: number): Person[] {
  return [
    person('Lena', 'former colleague', Ring.Friend, now - 400 * DAY, [
      line('We have a new position to fill: head of operations', Tag.Opportunity, Audience.FriendsOfFriends, now - 150 * DAY),
      line('Moving to Lisbon in spring', Tag.Note, Audience.OnlyMe, now - 150 * DAY),
    ]),
    person('Sam', 'EAGx, coffee break', Ring.Acquaintance, now - 90 * DAY, [
      line('Just opened an animal welfare fund', Tag.Resource, Audience.FriendsOfFriends, now - 90 * DAY),
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
      line('Just opened an animal welfare fund', Tag.Resource, Audience.FriendsOfFriends, now - 90 * DAY),
    ]),
    person('Aisha Konaté', 'community organizer, met at a workshop', Ring.Friend, now - 300 * DAY, [
      line('Has a spare guest bed in Lisbon for March', Tag.Offer, Audience.FriendsOfFriends, now - 15 * DAY),
    ]),
    // Real public figure. Ring.Intending only, public role as context, no
    // lines: nothing of his is ever queryable (see module doc above).
    person('Tyler Cowen', 'Economist, Emergent Ventures', Ring.Intending, now, []),
  ]
}

function eaPeople(now: number): Person[] {
  return [
    person('Elena Kovač', 'biosecurity researcher, met at a workshop', Ring.Close, now - 150 * DAY, [
      line('Looking for funding for her biosecurity project', Tag.Looking, Audience.Friends, now - 150 * DAY),
    ]),
    person('Marcus Feldman', 'fund manager at an effective-giving fund', Ring.Acquaintance, now - 90 * DAY, [
      line('Just opened an animal welfare fund', Tag.Resource, Audience.FriendsOfFriends, now - 90 * DAY),
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
  ]
}

function peopleFor(context: DemoContext, now: number): Person[] {
  switch (context) {
    case DemoContext.Emergent: return emergentPeople(now)
    case DemoContext.Ea: return eaPeople(now)
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
        { id: randomId(8), text: 'Motorbike (125cc), can lend it for a weekend', audience: Audience.FriendsOfFriends, included: true, createdAt: now - 20 * DAY },
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
