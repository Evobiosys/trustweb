export function readyToGo(answers: { status: number; serverStarted?: number }[], since: number): boolean
export function ciDiagnostics(jobs: string[], log: string): string
export function ghBin(env: Record<string, string | undefined>, exists: (path: string) => boolean): string | null
export function diagnosticsFor(pr: string, bin: string | null, run: (bin: string, args: string[]) => Promise<string>): Promise<string>
export const MERGE_DONE: string[]
export function mergeStatusFile(cache: string, branch: string): string
export function approveMergeRoute(o: {
  loopback: (req: unknown) => boolean; branch: () => string; cache: string; ops: string; wt: string
  exists: (file: string) => boolean; read: (file: string) => string; spawn: (cmd: string, args: string[]) => void; now?: () => number
}): (req: { method?: string }, res: { statusCode: number; setHeader(k: string, v: string): void; end(body?: string): void }) => void
