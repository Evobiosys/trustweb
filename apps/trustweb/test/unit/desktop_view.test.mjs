/** Wave 18: which face a device opens on (src/desktop_view.ts): the Desk on a wide browser tab unless the device chose the phone version. */
import { desktopView } from '../../src/desktop_view.ts'

describe('desktopView', () => {
  it('absent choice on a wide browser tab -> desk', () => expect(desktopView(null, true, false, false)).toBe('desk'))
  it("stored 'desk' -> desk", () => expect(desktopView('desk', true, false, false)).toBe('desk'))
  it("stored 'phone' -> phone", () => expect(desktopView('phone', true, false, false)).toBe('phone'))
  it('garbage stored value reads as absent', () => expect(desktopView('x', true, false, false)).toBe('desk'))
  it('embedded frame -> phone', () => expect(desktopView(null, true, true, false)).toBe('phone'))
  it('installed app -> phone', () => expect(desktopView('desk', true, false, true)).toBe('phone'))
  it('narrow viewport -> phone', () => expect(desktopView('desk', false, false, false)).toBe('phone'))
})
