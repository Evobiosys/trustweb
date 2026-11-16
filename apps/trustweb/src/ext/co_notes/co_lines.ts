// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 (feed-hopes): the bottom line of my block in a hopes-and-wishes note. Pure and DOM-free. */
import { indent, insertAfter, tree, type CoDoc, type CoPerson } from './co_doc'
import { ensureMine } from './co_desires'

/** Makes sure my block ends in an empty line of mine and returns its id: an empty last line is reused, so Enter never piles up blank lines. New lines start at 'me' (I9). */
export function bottomLine(doc: CoDoc, me: CoPerson, at: number): { doc: CoDoc; id: string } {
  const head = ensureMine(doc, me, at)
  const mine = tree(head.doc).filter((r) => r.depth === 1 && r.by.did === me.did)
  const last = mine[mine.length - 1]
  if (last && !last.text.trim()) return { doc: head.doc, id: last.id }
  const ins = insertAfter(head.doc, last?.id ?? head.id, '', me, at, { share: 'me' })
  return { doc: last ? ins.doc : indent(ins.doc, ins.id, me), id: ins.id }
}
