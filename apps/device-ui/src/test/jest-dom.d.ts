// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
//
// Local copy of what `@testing-library/jest-dom/vitest`'s types do, but resolved
// from device-ui so the augmentation targets the vitest (2.1.x) this package
// actually uses, not whichever copy pnpm hoisted next to jest-dom. See setup.ts.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";
import type { expect } from "vitest";

declare module "vitest" {
  interface Assertion<T = any>
    extends TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, T> {}
  interface AsymmetricMatchersContaining
    extends TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, any> {}
}
