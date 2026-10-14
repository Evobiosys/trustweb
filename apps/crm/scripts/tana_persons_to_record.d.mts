export function convert(index: unknown[], nodes: Record<string, string>): {
  record: import('../../trustweb/src/model').AppState
  stats: { persons: number; lines: number; withoutFields: number }
}
