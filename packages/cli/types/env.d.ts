// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// apps/trustweb/src/strings.ts (type-only in the model's graph) reads Vite's import.meta.env. The CLI is not built by Vite.
interface ImportMeta {
  readonly env: Record<string, string | undefined>
}
