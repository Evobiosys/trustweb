import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface JurisdictionConfig {
  instanceId: string;
  residency: 'AT' | 'EU';
  operatorContact: string;
  lawfulBasis: string;
  retentionDays: number;
  displayName: string;
  /**
   * Whether this instance may bind a reachable (non-loopback) address.
   *
   * Defaults to false when the config omits it: a jurisdiction file written
   * before this flag existed, or one whose operator never thought about it,
   * stays loopback-only. Turning it on is the operator saying out loud that
   * this deployment is meant to be reachable -- it is not, and must never
   * become, a side effect of any other setting. Withdrawal and clear are
   * signature-verified (B-20 option A), which is what makes a reachable bind
   * defensible at all; see README, "Bind policy".
   */
  allowPublicBind?: boolean;
}

export function loadJurisdiction(name?: string): JurisdictionConfig {
  const jurisdictionName = name || process.env.WOT_CENTRAL_JURISDICTION || 'at';
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const configPath = join(__dirname, '..', 'jurisdictions', `${jurisdictionName}.json`);

  let config: unknown;
  try {
    const rawContent = readFileSync(configPath, 'utf-8');
    config = JSON.parse(rawContent);
  } catch (err) {
    throw new Error(
      `Failed to load jurisdiction config from ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!config || typeof config !== 'object') {
    throw new Error(`Invalid jurisdiction config in ${configPath}: not an object`);
  }

  const obj = config as Record<string, unknown>;

  const requiredFields: (keyof JurisdictionConfig)[] = [
    'instanceId',
    'residency',
    'operatorContact',
    'lawfulBasis',
    'retentionDays',
    'displayName',
  ];

  for (const field of requiredFields) {
    if (!(field in obj)) {
      throw new Error(
        `Invalid jurisdiction config in ${configPath}: missing required field '${field}'`,
      );
    }
  }

  if (obj.residency !== 'AT' && obj.residency !== 'EU') {
    throw new Error(
      `Invalid jurisdiction config in ${configPath}: residency must be 'AT' or 'EU', got '${obj.residency}'`,
    );
  }

  return {
    instanceId: String(obj.instanceId),
    residency: obj.residency as 'AT' | 'EU',
    operatorContact: String(obj.operatorContact),
    lawfulBasis: String(obj.lawfulBasis),
    retentionDays: Number(obj.retentionDays),
    displayName: String(obj.displayName),
    // Absent, null, 'true', 1 -- anything but the boolean true -- reads as
    // false. Same conservative fall-through shape as the demo's mode.ts: an
    // accident must land on the side that adds no exposure.
    allowPublicBind: obj.allowPublicBind === true,
  };
}
