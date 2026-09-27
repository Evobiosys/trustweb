/**
 * Seeded content for the solo split view (solo.html): two personas on one
 * laptop, each with its own storage record (store.ts) and its own relay
 * identity, paired through the real one-scan connect link. Names and details
 * are fictional, like the mockups', except Tyler Cowen and William MacAskill
 * (see below) who are real public figures shown only at the "Intending to
 * connect" tier with no notes and no queryable lines.
 *
 * Maya (holder) carries the motorbike (the "Motorrad" demo) plus notes that
 * answer the two illustrated examples: a job lead (Example A) and a new fund
 * (Example B). Her spare room is "Only me", to show that a line shared with
 * nobody reads as "no match".
 *
 * The rest of Maya's web is populated fictional contacts across the three
 * connected rings, so the "Web" screen and "People" list feel like a real,
 * lived-in network rather than a three-person fixture. A few carry a second,
 * clearly queryable line ("open to research roles", "hiring a frontend
 * engineer", a spare guest bed) so a funder trying the Query flow on Jonas's
 * phone has more than one thing to ask about. None of the new lines use the
 * words "motorbike"/"motorcycle" or "Vienna", so they cannot interfere with
 * the acceptance script's existing motorbike and spare-room-in-Vienna asks.
 *
 * Tyler Cowen and William MacAskill sit at Ring.Intending: someone Maya
 * plans to meet, not yet in her web. Per model.ts, audienceAdmits() returns
 * false for that ring regardless of a line's audience, and in any case they
 * carry no `lines` at all, so nothing about them is ever queryable. Their
 * `context` is a public role description only (no invented private
 * information), and the person sheet shows that role instead of a fabricated
 * "Met ..." line (see main.ts personSheet).
 */
import { randomId } from '../../demo/src/crypto'
import { Audience, LineStatus, Ring, Tag } from './model'
import type { AppState, NoteLine } from './model'

export enum Persona {
  Holder = 'holder',
  Seeker = 'seeker',
}

const DAY = 86_400_000

function line(text: string, tag: Tag, audience: Audience, notedAt: number): NoteLine {
  return { id: randomId(8), text, tag, audience, status: LineStatus.Current, notedAt, checkedAt: notedAt }
}

export function seedState(persona: Persona, now: number): AppState {
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
      people: [
        {
          id: randomId(8), name: 'Lena', context: 'former colleague', ring: Ring.Friend, metAt: now - 400 * DAY,
          lines: [
            line('We have a new position to fill: head of operations', Tag.Opportunity, Audience.FriendsOfFriends, now - 150 * DAY),
            line('Moving to Lisbon in spring', Tag.Note, Audience.OnlyMe, now - 150 * DAY),
          ],
        },
        {
          id: randomId(8), name: 'Sam', context: 'EAGx, coffee break', ring: Ring.Acquaintance, metAt: now - 90 * DAY,
          lines: [
            line('Just opened an animal welfare fund', Tag.Resource, Audience.FriendsOfFriends, now - 90 * DAY),
          ],
        },
        {
          id: randomId(8), name: 'Tomás', context: 'caught up at a meetup', ring: Ring.Close, metAt: now - 800 * DAY,
          lines: [
            line('Looking for funding for his biosecurity project', Tag.Looking, Audience.Friends, now - 150 * DAY),
            line('Looking for a flatmate in Vienna', Tag.Looking, Audience.Friends, now - 240 * DAY),
          ],
        },
        {
          id: randomId(8), name: 'Noah Bergström', context: 'AI safety postdoc, met at a reading group', ring: Ring.Close, metAt: now - 500 * DAY,
          lines: [
            line('Open to research roles once his postdoc ends this winter', Tag.Looking, Audience.Friends, now - 40 * DAY),
          ],
        },
        {
          id: randomId(8), name: 'Ingrid Halvorsen', context: 'science journalist', ring: Ring.Close, metAt: now - 620 * DAY,
          lines: [
            line('Working on a piece about decentralized identity, wants sources', Tag.Note, Audience.Friends, now - 10 * DAY),
          ],
        },
        {
          id: randomId(8), name: 'Jasmin Öztürk', context: 'ops lead at a climate-tech startup', ring: Ring.Acquaintance, metAt: now - 60 * DAY,
          lines: [
            line('Hiring a frontend engineer for her climate-tech startup', Tag.Opportunity, Audience.FriendsOfFriends, now - 20 * DAY),
          ],
        },
        {
          id: randomId(8), name: 'Aisha Konaté', context: 'community organizer, met at a workshop', ring: Ring.Friend, metAt: now - 300 * DAY,
          lines: [
            line('Has a spare guest bed in Lisbon for March', Tag.Offer, Audience.FriendsOfFriends, now - 15 * DAY),
          ],
        },
        {
          id: randomId(8), name: 'Felix Novak', context: 'grantmaker, occasional coffee chats', ring: Ring.Acquaintance, metAt: now - 200 * DAY,
          lines: [
            line('Knows a strong candidate for a comms role', Tag.Talent, Audience.FriendsOfFriends, now - 5 * DAY),
          ],
        },
        {
          id: randomId(8), name: 'Rhea Meszaros', context: 'independent researcher', ring: Ring.Friend, metAt: now - 130 * DAY,
          lines: [],
        },
        // Real public figures. Ring.Intending only, public role as context,
        // no lines: nothing of theirs is queryable (see module doc above).
        {
          id: randomId(8), name: 'Tyler Cowen', context: 'Economist, Emergent Ventures', ring: Ring.Intending, metAt: now,
          lines: [],
        },
        {
          id: randomId(8), name: 'William MacAskill', context: 'Philosopher, effective altruism', ring: Ring.Intending, metAt: now,
          lines: [],
        },
      ],
    }
  }
  return {
    v: 1,
    me: { id: 'jonas-' + randomId(6), displayName: 'Jonas' },
    peers: [],
    log: [],
    notificationsOn: false,
    inventory: [],
    people: [],
  }
}
