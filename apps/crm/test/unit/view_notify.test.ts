import { describe, expect, it } from 'vitest'
import { View } from '../../src/nav'
import { viewNotifier } from '../../src/view_notify'

describe('viewNotifier', () => {
  it('tells the host the face once per change', () => {
    const seen: string[] = []
    const notify = viewNotifier((face) => seen.push(face))
    for (const v of [View.Classic, View.Classic, View.Desk, View.Desk, View.Classic]) notify(v)
    expect(seen).toEqual(['classic', 'desk', 'classic'])
  })
  it('is a no-op standalone', () => {
    expect(() => viewNotifier(undefined)(View.Desk)).not.toThrow()
  })
})
