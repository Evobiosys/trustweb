/** The 6b ids (src/connect_modes.ts) stay and map onto the wave 6e ShareMode ids (src/share_modes.ts); nothing else reads them. */
import { ConnectMode, CONNECT_MODES, isConnectMode } from '../../src/connect_modes.ts'
import { ShareMode, fromConnectMode } from '../../src/share_modes.ts'

describe('the 6b ids', () => {
  it('three ids, still there', () => expect(CONNECT_MODES).toEqual([ConnectMode.Both, ConnectMode.OnlyMolly, ConnectMode.OnlyTrustWeb]))
  it('isConnectMode', () => {
    expect(isConnectMode('both')).toBe(true)
    expect(isConnectMode('nope')).toBe(false)
    expect(isConnectMode(undefined)).toBe(false)
  })
  it('map to the new modes: Both -> TrustWeb+Signal, OnlyMolly -> Only Signal, OnlyTrustWeb -> Only TrustWeb', () => {
    expect(fromConnectMode(ConnectMode.Both)).toBe(ShareMode.TrustWebSignal)
    expect(fromConnectMode(ConnectMode.OnlyMolly)).toBe(ShareMode.OnlySignal)
    expect(fromConnectMode(ConnectMode.OnlyTrustWeb)).toBe(ShareMode.OnlyTrustWeb)
  })
})
