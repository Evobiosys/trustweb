export interface Countries { type: 'FeatureCollection'; features: { type: 'Feature'; properties: { NAME: string }; geometry: { type: string; coordinates: unknown } }[] }
export function slimCountries(fc: unknown): Countries
