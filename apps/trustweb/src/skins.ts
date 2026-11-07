// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32: the skin registry. A skin changes how a surface looks, never what it shows. Built in only; a store of more skins comes later. Pure, no DOM. */
export type SkinSurface = 'network'

export interface Skin { id: string; name: string; description: string; builtIn: true; applies: readonly SkinSurface[] }

export const DEFAULT_SKIN = 'trustweb'

export const SKINS: readonly Skin[] = [
  { id: 'trustweb', name: 'TrustWeb', description: 'People drawn as on your Web rings: same round dots, ring colours and initials.', builtIn: true, applies: ['network'] },
  { id: 'classic-network', name: 'Classic network', description: 'The plain network look: small coloured dots.', builtIn: true, applies: ['network'] },
]

export const skinsFor = (surface: SkinSurface): Skin[] => SKINS.filter((k) => k.applies.includes(surface))

/** The chosen skin (record key `skin`); nothing stored or an unknown id = the default. */
export function skinOf(s: { skin?: string }): Skin {
  return SKINS.find((k) => k.id === s.skin) ?? SKINS.find((k) => k.id === DEFAULT_SKIN)!
}

/** Stores the choice in the record; the default is stored as absent, an unknown id is ignored. */
export function chooseSkin(s: { skin?: string }, id: string): void {
  if (!SKINS.some((k) => k.id === id)) return
  if (id === DEFAULT_SKIN) delete s.skin
  else s.skin = id
}
