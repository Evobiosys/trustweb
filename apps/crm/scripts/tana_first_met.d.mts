export function dayOf(breadcrumb: string[], created: string): number | null
export function earliest(hits: { breadcrumb?: string[]; created: string; inTrash?: boolean }[]): { metAt: number; context?: string } | null
