// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
//
// Register jest-dom matchers on *this package's* vitest `expect`.
//
// We deliberately do NOT use `import "@testing-library/jest-dom/vitest"`:
// jest-dom 6.9.1 declares no peer dependency on vitest, so under pnpm's
// isolated layout its internal `import { expect } from "vitest"` resolves by
// walking up to the hoisted `node_modules/.pnpm/node_modules/vitest`, which can
// be a different copy/version (the workspace also locks vitest 3.2.7 and
// 5.0.4) than the 2.1.9 that runs these tests. The matchers then land on the
// wrong `expect` ("Invalid Chai property: toBeInTheDocument"). Importing
// `expect` here resolves against device-ui's own vitest. The matching type
// augmentation lives in ./jest-dom.d.ts for the same reason.
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers);
