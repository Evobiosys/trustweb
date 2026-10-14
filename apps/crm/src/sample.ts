/**
 * Fictional sample data in TrustWeb's shape, so the CRM has something to show
 * before a real record exists. Nobody here is a real person; every name,
 * place and handle is invented. Dates are relative to `now` so the timeline
 * reads naturally whenever it is opened.
 */
import type { AppState, NoteLine, Person } from '../../trustweb/src/model'
import { Audience, Channel, LineStatus, LogOutcome, Ring, Tag } from '../../trustweb/src/model'
import type { CrmState } from './model'
import { Section } from './placement'
import { ContactPointKind, InteractionKind, Stage } from './model'

const DAY = 86_400_000

function line(id: string, text: string, tag: Tag, audience: Audience, notedAt: number, checkedAt = notedAt): NoteLine {
  return { id, text, tag, audience, status: LineStatus.Current, notedAt, checkedAt }
}

export function samplePeople(now: number): Person[] {
  return [
    {
      id: 'p-lena', name: 'Lena Hofbauer', context: 'Repair café in Ottakring', ring: Ring.Close, metAt: now - 400 * DAY,
      peerId: 'peer-lena',
      channels: { [Channel.Signal]: 'https://signal.me/#eu/lena-sample', [Channel.Matrix]: '@lena:example.org' },
      lines: [
        line('l-lena-1', 'Runs the tool library, has a spare 3D printer to lend', Tag.Resource, Audience.FriendsOfFriends, now - 390 * DAY, now - 20 * DAY),
        line('l-lena-2', 'Looking for a treasurer for the association', Tag.Looking, Audience.Friends, now - 12 * DAY),
      ],
    },
    {
      id: 'p-tomas', name: 'Tomás Reiter', context: 'Co-working day in Graz', ring: Ring.Friend, metAt: now - 150 * DAY,
      peerId: 'peer-tomas',
      channels: { [Channel.WhatsApp]: '+436641234567', [Channel.Telegram]: 'tomas_sample' },
      lines: [
        line('l-tomas-1', 'Wants to pilot a seed-sharing app with two farms in Styria', Tag.Opportunity, Audience.Friends, now - 140 * DAY),
        line('l-tomas-2', 'Good at grant budgets', Tag.Talent, Audience.FriendsOfFriends, now - 140 * DAY, now - 40 * DAY),
      ],
    },
    {
      id: 'p-aisha', name: 'Aisha Berger', context: 'Climate hackathon, Vienna', ring: Ring.Friend, metAt: now - 90 * DAY,
      channels: { [Channel.Delta]: 'aisha@example.org' },
      lines: [
        line('l-aisha-1', 'Offers two evenings a month of UX review', Tag.Offer, Audience.FriendsOfFriends, now - 85 * DAY),
        line('l-aisha-2', 'Thinking about moving to Linz next spring', Tag.Note, Audience.OnlyMe, now - 30 * DAY),
      ],
    },
    {
      id: 'p-benedikt', name: 'Benedikt Auer', context: 'Introduced by Lena at the repair café', ring: Ring.Acquaintance, metAt: now - 60 * DAY,
      channels: { [Channel.Messenger]: 'benedikt.sample' },
      lines: [
        line('l-ben-1', 'Has a van, happy to help with a move', Tag.Resource, Audience.Friends, now - 58 * DAY),
      ],
    },
    {
      id: 'p-marta', name: 'Marta Kovač', context: 'Panel on cooperative housing, Salzburg', ring: Ring.Acquaintance, metAt: now - 45 * DAY,
      lines: [
        line('l-marta-1', 'Looking for a venue for a 40-person workshop in autumn', Tag.Looking, Audience.FriendsOfFriends, now - 44 * DAY),
        line('l-marta-2', 'Opportunity: a municipal call for commons projects closes in two months', Tag.Opportunity, Audience.Friends, now - 10 * DAY),
      ],
    },
    {
      id: 'p-jonas', name: 'Jonas Pichler', context: 'Neighbour, met at the house meeting', ring: Ring.Close, metAt: now - 700 * DAY,
      channels: { [Channel.Signal]: '+436601112233' },
      lines: [
        line('l-jonas-1', 'Can translate German to Slovene', Tag.Talent, Audience.FriendsOfFriends, now - 600 * DAY, now - 5 * DAY),
      ],
    },
    {
      id: 'p-noor', name: 'Noor Steiner', context: 'Keynote on open hardware at Ars Electronica', ring: Ring.Intending, metAt: now + 20 * DAY,
      lines: [],
    },
  ]
}

export function sampleApp(now: number): AppState {
  return {
    v: 1,
    me: { id: 'me', displayName: 'Sample' },
    people: samplePeople(now),
    peers: [
      { id: 'peer-lena', displayName: 'Lena Hofbauer', did: 'did:key:zSampleLena', ring: Ring.Close, connectedAt: now - 380 * DAY },
      { id: 'peer-tomas', displayName: 'Tomás Reiter', did: 'did:key:zSampleTomas', ring: Ring.Friend, connectedAt: now - 120 * DAY },
    ],
    inventory: [
      { id: 'i-1', text: 'A folding bike in good shape', audience: Audience.Friends, included: true, createdAt: now - 200 * DAY },
    ],
    log: [
      { id: 'g-1', at: now - 15 * DAY, from: 'Tomás Reiter', text: 'Who knows a place to print 200 posters cheaply?', outcome: LogOutcome.Shared, peerId: 'peer-tomas' },
      { id: 'g-2', at: now - 3 * DAY, from: 'Lena Hofbauer', text: 'Does anyone have a spare projector for Friday?', outcome: LogOutcome.NoMatch, peerId: 'peer-lena' },
    ],
    notificationsOn: false,
  }
}

export function sampleCrm(now: number): CrmState {
  return {
    v: 1,
    interactions: [
      { id: 'x-1', personId: 'p-lena', at: now - 20 * DAY, kind: InteractionKind.Met, text: 'Coffee after the repair café, talked about the treasurer gap', place: 'Café Weidinger' },
      { id: 'x-2', personId: 'p-tomas', at: now - 40 * DAY, kind: InteractionKind.Call, text: 'Walked through the seed-sharing pilot budget' },
      { id: 'x-3', personId: 'p-aisha', at: now - 8 * DAY, kind: InteractionKind.Message, text: 'Sent her the onboarding screens for review' },
      { id: 'x-4', personId: 'p-marta', at: now - 10 * DAY, kind: InteractionKind.Event, text: 'Both at the commons meetup, she mentioned the municipal call', place: 'Salzburg' },
    ],
    followUps: [
      { id: 'f-1', personId: 'p-lena', text: 'Ask whether Benedikt could be treasurer', dueAt: now - 2 * DAY, createdAt: now - 20 * DAY },
      { id: 'f-2', personId: 'p-marta', text: 'Send the Ottakring hall contact for her workshop', dueAt: now + 5 * DAY, createdAt: now - 10 * DAY },
      { id: 'f-3', personId: 'p-tomas', text: 'Reply on the pilot timeline', dueAt: now - 30 * DAY, createdAt: now - 40 * DAY, doneAt: now - 28 * DAY },
    ],
    stages: {
      'l-tomas-1': Stage.Talking,
      'l-marta-2': Stage.Idea,
      'l-aisha-1': Stage.Agreed,
    },
    curation: {
      byNetwork: {
        'EA community': {
          person: { sections: { haKj_SUXuNqZ: Section.Simple, _aHDRrSrMROz: Section.Simple }, order: [] },
          environment: { sections: {}, order: [] },
        },
      },
      admins: [{ networkId: 'EA community', from: now - DAY, to: now + 30 * DAY }],
    },
    contactPoints: {
      'p-lena': [{ kind: ContactPointKind.Phone, value: '+43 660 000 0001' }, { kind: ContactPointKind.Email, value: 'lena@example.org' }],
      'p-tomas': [{ kind: ContactPointKind.Email, value: 'tomas@example.org' }],
    },
  }
}
