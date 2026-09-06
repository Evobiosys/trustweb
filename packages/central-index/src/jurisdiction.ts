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
  };
}
