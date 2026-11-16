// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 web-rings-polish (Jakob item 20): right click / long press on a person bubble opens this SMALL menu (three rows), the single press keeps the big overlay. Pure rows; web_view.ts draws them. */
import type { Person } from './model'
import { S } from './strings'

export const PERSON_MENU_ROWS = ['tag', 'hide', 'open'] as const
export type PersonMenuRow = (typeof PERSON_MENU_ROWS)[number]

export const personMenuRows = (_p: { id: string }): { id: PersonMenuRow; label: string }[] =>
  PERSON_MENU_ROWS.map((id) => ({ id, label: S.personMenu[id] }))

/** Wave 44: the name under a beyond bubble (empty when either side keeps it anonymous) and its tooltip ("via Lena"). */
export const beyondLabel = (p: Pick<Person, 'name' | 'anonymous'>, viaName: string): { text: string; title: string } => ({ text: p.anonymous === true ? '' : p.name, title: S.beyondVia(viaName) })
