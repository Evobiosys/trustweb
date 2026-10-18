export function readyToGo(answers: { status: number; serverStarted?: number }[], since: number): boolean
export function ciDiagnostics(jobs: string[], log: string): string
export function ghBin(env: Record<string, string | undefined>, exists: (path: string) => boolean): string | null
export function diagnosticsFor(pr: string, bin: string | null, run: (bin: string, args: string[]) => Promise<string>): Promise<string>
