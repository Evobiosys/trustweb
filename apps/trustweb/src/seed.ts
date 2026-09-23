/**
 * Seeded content for the solo split view (solo.html): two personas on one
 * laptop, each with its own storage record (store.ts) and its own relay
 * identity, paired through the real one-scan connect link. Names and details
 * are fictional, like the mockups'.
 *
 * Maya (holder) carries the motorbike (the "Motorrad" demo) plus notes that
 * answer the two illustrated examples: a job lead (Example A) and a new fund
 * (Example B). Her spare room is "Only me", to show that a line shared with
 * nobody reads as "no match".
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
