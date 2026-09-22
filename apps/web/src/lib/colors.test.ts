import { describe, expect, it } from "vitest";
import { contrastRatio, readableTextColor } from "./colors";

describe("readableTextColor", () => {
  it("uses dark text on the orange accent", () => {
    expect(readableTextColor("#f97316")).toBe("#1c1917");
    expect(contrastRatio("#f97316", readableTextColor("#f97316"))).toBeGreaterThanOrEqual(4.5);
  });
  it("uses light text on dark tag colors", () => {
    expect(readableTextColor("#1e3a8a")).toBe("#ffffff");
  });
  it("handles short hex colors", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 0);
  });
});