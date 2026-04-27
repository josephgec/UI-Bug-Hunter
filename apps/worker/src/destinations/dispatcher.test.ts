import { describe, expect, it } from "vitest";
import { autoDispatchAllowed } from "./routing.js";

describe("autoDispatchAllowed", () => {
  it("returns false when destination has no autoSeverity set", () => {
    expect(autoDispatchAllowed(null, "critical")).toBe(false);
  });
  it("includes the threshold severity itself", () => {
    expect(autoDispatchAllowed("high", "high")).toBe(true);
  });
  it("includes everything more severe than the threshold", () => {
    expect(autoDispatchAllowed("medium", "high")).toBe(true);
    expect(autoDispatchAllowed("medium", "critical")).toBe(true);
  });
  it("excludes everything less severe than the threshold", () => {
    expect(autoDispatchAllowed("high", "medium")).toBe(false);
    expect(autoDispatchAllowed("critical", "high")).toBe(false);
  });
  it("returns false on invalid threshold strings", () => {
    expect(autoDispatchAllowed("nonsense", "high")).toBe(false);
  });
});
