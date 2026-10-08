/**
 * The three Advanced choices of wave 6b (owner 2026-10-08: "one unified link and then the dropdown ... I can choose only molly or only
 * trustweb"). Wave 6e replaced them by the six ShareMode ids of share_modes.ts (pins, a remembered choice, WhatsApp); these ids stay so
 * the 6b names still resolve, and share_modes.ts fromConnectMode() maps them: Both -> TrustWebSignal, OnlyMolly -> OnlySignal,
 * OnlyTrustWeb -> OnlyTrustWeb. Nothing else reads them.
 */
export enum ConnectMode {
  Both = 'both',
  OnlyMolly = 'molly',
  OnlyTrustWeb = 'trustweb',
}

export const CONNECT_MODES: readonly ConnectMode[] = [ConnectMode.Both, ConnectMode.OnlyMolly, ConnectMode.OnlyTrustWeb]

export function isConnectMode(v: unknown): v is ConnectMode {
  return CONNECT_MODES.includes(v as ConnectMode)
}
