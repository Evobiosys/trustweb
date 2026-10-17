/** A `#via=<CHANNEL>` link (share_modes.ts): their card opens once the add sheet is closed AND their links have arrived, in either order. */
export function createViaCard() {
  let pending: string | null = null
  let arrived = false
  return {
    /** The ask for their links went out for this person. */
    expect(id: string): void { pending = id; arrived = false },
    /** Their links arrived; true: open the card now. While the add sheet is open it waits for `closed`. */
    contact(id: string, addSheetOpen: boolean): boolean {
      if (pending !== id) return false
      if (addSheetOpen) { arrived = true; return false }
      pending = null
      return true
    },
    /** The add sheet closed; true: their links already arrived, open the card. */
    closed(id: string): boolean {
      if (pending !== id || !arrived) return false
      pending = null
      arrived = false
      return true
    },
  }
}
