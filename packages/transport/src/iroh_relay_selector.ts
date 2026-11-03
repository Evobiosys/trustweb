// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// IrohRelaySelector — remembers which iroh relays recently failed and orders
// candidate relays so healthy ones are tried first (docs/IROH-RELAY.md,
// "Relay selection and failover").
//
// Pure and deterministic: no I/O, no timers; the clock is injectable. A relay
// that fails is put into cooldown for cooldownMs * 2^(failures-1), capped at
// maxCooldownMs; a success forgets it entirely. A cooling-down relay is never
// dropped, only moved to the back, so a fully degraded set is still tried.
//
// Relay health is local sender-side state about relay operators, not about
// peers or their answers; it has no bearing on the uniform PASS schedule (I3).

export interface IrohRelaySelectorOptions {
  /** Clock in ms since epoch. Defaults to Date.now. */
  now?: () => number;
  /** Cooldown after the first consecutive failure. Defaults to 60 s. */
  cooldownMs?: number;
  /** Upper bound for the doubled cooldown. Defaults to 15 min. */
  maxCooldownMs?: number;
}

export const DEFAULT_RELAY_COOLDOWN_MS = 60_000;
export const DEFAULT_RELAY_MAX_COOLDOWN_MS = 15 * 60_000;

interface RelayHealth {
  failures: number;
  cooledUntil: number;
}

export class IrohRelaySelector {
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly health = new Map<string, RelayHealth>();

  constructor(opts: IrohRelaySelectorOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.cooldownMs = opts.cooldownMs ?? DEFAULT_RELAY_COOLDOWN_MS;
    this.maxCooldownMs = opts.maxCooldownMs ?? DEFAULT_RELAY_MAX_COOLDOWN_MS;
  }

  /** De-duplicated candidates: healthy relays in the given order, then cooling-down ones in the given order. */
  order(candidates: string[]): string[] {
    const unique = [...new Set(candidates)];
    const healthy: string[] = [];
    const cooling: string[] = [];
    for (const url of unique) (this.isCoolingDown(url) ? cooling : healthy).push(url);
    return [...healthy, ...cooling];
  }

  reportSuccess(url: string): void {
    this.health.delete(url);
  }

  reportFailure(url: string): void {
    const failures = (this.health.get(url)?.failures ?? 0) + 1;
    const backoff = Math.min(this.cooldownMs * 2 ** (failures - 1), this.maxCooldownMs);
    this.health.set(url, { failures, cooledUntil: this.now() + backoff });
  }

  isCoolingDown(url: string): boolean {
    const h = this.health.get(url);
    return h !== undefined && this.now() < h.cooledUntil;
  }

  /** Every relay with recorded failures, for the local audit log (I6). cooledUntil is null once the cooldown has elapsed. */
  snapshot(): Array<{ url: string; failures: number; cooledUntil: number | null }> {
    return [...this.health].map(([url, h]) => ({
      url,
      failures: h.failures,
      cooledUntil: this.isCoolingDown(url) ? h.cooledUntil : null,
    }));
  }
}
