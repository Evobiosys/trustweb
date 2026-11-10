// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 ai-edit-chat: "more about this person" (the AI button on a person during import). quickLook is the fast first answer, from
 * this device only (no network, well under a second); askLonger (assistant_body.ts) then asks the person's own AI. The only-me note
 * is shown here but never sent to the AI (general_notes.ts). Pure, no DOM.
 */
import type { ColourTag } from '../../colour_tags'
import { generalNoteOf } from '../../general_notes'
import { normalizeName } from '../../import_curate'
import type { AppState, Person, ServiceRow } from '../../model'
import { S } from '../../strings'

export type LookTarget = { personId: string } | { row: Pick<ServiceRow, 'key' | 'name'> & Partial<Pick<ServiceRow, 'labels' | 'note' | 'emails' | 'phones' | 'org' | 'title'>> }

const tagLine = (p: Person, tags: readonly ColourTag[]): string => tags.filter((t) => String(p.fields?.[t.id]) === 'true').map((t) => `#${t.label ?? t.id}`).join(' ')

function personLines(s: Pick<AppState, 'people'>, p: Person, tags: readonly ColourTag[]): string[] {
  const T = S.assistant.look
  const known = (p.knows ?? []).map((id) => s.people.find((x) => x.id === id)?.name).filter((n): n is string => Boolean(n))
  const note = generalNoteOf(p)
  return [
    `${p.name} · ${S.ringLabel[p.ring] ?? p.ring}`,
    tagLine(p, tags),
    p.context ? `${T.context}: ${p.context}` : '',
    known.length ? `${T.knows}: ${known.slice(0, 8).join(', ')}` : '',
    note ? `${T.note}: ${note.slice(0, 300)}` : '',
    ...(p.sources ?? []).slice(0, 3).map((x) => `${T.from}: ${x.file} (${new Date(x.importedAt).toISOString().slice(0, 10)})`),
  ].filter(Boolean)
}

/** What this device knows, as short lines: ring, tags, context, who they know, the only-me note, where they were imported from. */
export function quickLook(s: Pick<AppState, 'people'>, target: LookTarget, tags: readonly ColourTag[]): string[] {
  const T = S.assistant.look
  if ('personId' in target) {
    const p = s.people.find((x) => x.id === target.personId)
    return p ? personLines(s, p, tags) : [T.none]
  }
  const r = target.row
  const same = s.people.find((p) => p.ring !== 'none' && normalizeName(p.name) === normalizeName(r.name))
  return [
    r.name,
    (r.labels ?? []).map((l) => `#${l}`).join(' '),
    [r.title, r.org].filter(Boolean).join(', '),
    r.note ? `${T.note}: ${r.note.slice(0, 300)}` : '',
    r.emails?.length || r.phones?.length ? T.contact((r.emails ?? []).length, (r.phones ?? []).length) : '',
    same ? T.already(same.name) : T.notYet,
  ].filter(Boolean)
}

/** What the longer answer may tell the AI: name, tags, title and organisation; never e-mail, phone or the only-me note. */
export function lookupQuestion(s: Pick<AppState, 'people'>, target: LookTarget, tags: readonly ColourTag[]): string {
  if ('personId' in target) {
    const p = s.people.find((x) => x.id === target.personId)
    return p ? [p.name, tagLine(p, tags), p.context].filter(Boolean).join(' · ') : ''
  }
  const r = target.row
  return [r.name, (r.labels ?? []).map((l) => `#${l}`).join(' '), [r.title, r.org].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
}
