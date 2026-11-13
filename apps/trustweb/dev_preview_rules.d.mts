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
export function jobQueue<T>(exec: (args: string[]) => Promise<T>): { run(args: string[]): Promise<T>; size(): number }
export function conflictBrief(o: { id: string; key: string; branch: string; baseSha: string; worktree: string; mergeTree: string }): string
export function fixConflictRoute(o: {
  loopback: (req: unknown) => boolean
  preview: () => { id: string; baseSha: string; worktree: string; features: { key: string; branch: string }[] }
  devlog: () => string
  readBody: (req: unknown) => Promise<{ id?: string; key?: string } | null>
  mergeTree: (worktree: string, baseSha: string, branch: string) => Promise<string>
  write: (file: string, text: string) => void
  launch: (file: string, task: string) => Promise<{ window?: string }>
}): (req: { method?: string }, res: { statusCode: number; setHeader(k: string, v: string): void; end(body?: string): void }) => Promise<void>
/** Review wave 42: the launcher's failure; exit code 3 (another session of the project active) -> `busy` (409). */
export function launchError(e: unknown): Error & { busy?: true }
/** Review wave 42: trustweb-ops/DEVLOG found by walking up from `start`; `override` (TW_DEVLOG) wins; null when none. */
export function opsDevlogRoot(start: string, exists: (p: string) => boolean, override?: string): string | null
