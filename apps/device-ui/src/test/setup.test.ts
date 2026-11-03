// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
//
// Regression guard: jest-dom matchers must be registered on the same vitest
// `expect` instance the tests import (see ./setup.ts for why).
import { describe, expect, it } from "vitest";

describe("test setup", () => {
  it("registers jest-dom matchers on this package's expect", () => {
    expect(typeof expect(document.body).toBeInTheDocument).toBe("function");
  });

  it("evaluates a jest-dom matcher", () => {
    const el = document.createElement("p");
    el.textContent = "hello";
    document.body.appendChild(el);
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("hello");
    el.remove();
    expect(el).not.toBeInTheDocument();
  });
});
