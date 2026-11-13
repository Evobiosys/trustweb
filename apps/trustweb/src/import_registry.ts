// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 import-obsidian-ai (F04): the one list of import sources and the one tag scheme `import:<YYYY-MM-DD>-<source>`. No imports on purpose:
 * the app, the pipeline (import_pipeline.ts) and the MCP server (apps/mcp, plain node) all read it.
 */
export interface RegistrySource { id: string; label: string; /** `file`: the owner picks a file or folder in the app; `candidates`: people handed over directly (MCP, AI). */ kind: 'file' | 'candidates' }

export const IMPORT_SOURCES: readonly RegistrySource[] = [
  { id: 'whatsapp', label: 'WhatsApp', kind: 'file' }, { id: 'linkedin', label: 'LinkedIn', kind: 'file' }, { id: 'vcard', label: 'Phone contacts', kind: 'file' },
  { id: 'google-csv', label: 'Google contacts', kind: 'file' }, { id: 'google-api', label: 'Google contacts', kind: 'candidates' }, { id: 'facebook-json', label: 'Facebook', kind: 'file' },
  { id: 'dex-csv', label: 'Dex', kind: 'file' }, { id: 'generic-csv', label: 'Spreadsheet (CSV)', kind: 'file' }, { id: 'mcp', label: 'MCP server', kind: 'candidates' },
  { id: 'obsidian', label: 'Obsidian vault', kind: 'file' }, { id: 'obsidian-ai', label: 'Obsidian vault (found by AI)', kind: 'candidates' },
]
export const SERVICE_LABEL: Record<string, string> = Object.fromEntries(IMPORT_SOURCES.map((s) => [s.id, s.label]))

export const DEFAULT_IMPORT_NOTE = 'Only focused on people; phone numbers can still be added later (maybe no longer up to date)'

/** A system tag id starts with this; such tags are hidden unless the Tools toggle "show system tags" is on. */
export const SYSTEM_TAG_PREFIX = 'import:'
const SOURCE_SLUG: Record<string, string> = { vcard: 'vcf', 'google-api': 'google', 'facebook-json': 'facebook', 'dex-csv': 'dex', 'generic-csv': 'csv' }

/** `import:<YYYY-MM-DD>-<source>`; several sources in one pass are joined with "+". */
export function importTagId(at: number, sources: readonly string[]): string {
  const names = [...new Set(sources.map((s) => SOURCE_SLUG[s] ?? s))]
  return `${SYSTEM_TAG_PREFIX}${new Date(at).toISOString().slice(0, 10)}-${names.join('+') || 'import'}`
}
