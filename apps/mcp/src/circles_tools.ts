// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-circles-view (MCP parity): circles_layout reads what the Circles view draws: one circle per tag, with who holds it and the circle's size.
 * Adding or removing a person is add_tag / remove_tag (a drop on a circle does exactly that). Group nesting lives in the app's tag list, not in the record: holders here are direct.
 */
import { readFileSync } from 'node:fs'
import { circleSize } from '../../trustweb/src/circles_model.ts'
import type { Tool } from './protocol.ts'

type Rec = { people: { id: string; name: string; ring: string; deleted_at?: string; fields?: Record<string, unknown> }[] }

export function circlesTools(o: { file: string }): Tool[] {
  return [{
    name: 'circles_layout', description: 'The Circles view: every tag as a circle, in tag-name order, with the people who hold it (ids and names) and the circle size in px. A person can sit in several circles.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    run: () => {
      const r = JSON.parse(readFileSync(o.file, 'utf8')) as Rec
      const circles = new Map<string, { id: string; name: string }[]>()
      for (const p of r.people) {
        if (p.deleted_at !== undefined || p.ring === 'none') continue
        for (const [tag, v] of Object.entries(p.fields ?? {})) if (String(v) === 'true') circles.set(tag, [...(circles.get(tag) ?? []), { id: p.id, name: p.name }])
      }
      return [...circles].sort(([a], [b]) => a.localeCompare(b)).map(([tag, members]) => ({ tag, people: members.length, size: circleSize(members.length), members }))
    },
  }]
}
