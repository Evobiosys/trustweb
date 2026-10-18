/** Network view person menu and canvas sizing (src/network_menu.ts). */
import { canvasScale, isLongPress, menuActions, placeMenu } from '../../src/network_menu.ts'

describe('network menu', () => {
  it('long-presses only when held 600 ms without moving past 8 px', () => {
    expect(isLongPress(599, 0)).toBe(false)
    expect(isLongPress(600, 0)).toBe(true)
    expect(isLongPress(600, 8)).toBe(true)
    expect(isLongPress(600, 9)).toBe(false)
  })

  it('offers pin or unpin by state, then inspect and hide', () => {
    expect(menuActions(false)).toEqual(['pin', 'inspect', 'hide'])
    expect(menuActions(true)).toEqual(['unpin', 'inspect', 'hide'])
  })

  it('keeps the menu inside the canvas', () => {
    expect(placeMenu(10, 20, 100, 90, 300, 400)).toEqual({ x: 10, y: 20 })
    expect(placeMenu(290, 395, 100, 90, 300, 400)).toEqual({ x: 200, y: 310 })
    expect(placeMenu(5, 5, 400, 500, 300, 400)).toEqual({ x: 0, y: 0 })
  })

  it('caps the canvas scale at 4x DPR and 8192 px per side, never below 1', () => {
    expect(canvasScale(2, 400, 600)).toBe(2)
    expect(canvasScale(6, 400, 600)).toBe(4)
    expect(canvasScale(4, 3000, 600)).toBeCloseTo(8192 / 3000)
    expect(canvasScale(0.5, 400, 600)).toBe(1)
  })
})
