import { describe, expect, it } from "vitest";
import { findingDedupHash, scanFingerprint } from "./dedup.js";

describe("findingDedupHash", () => {
  it("returns the same hash for whitespace-only differences", () => {
    const a = findingDedupHash({
      category: "visual_layout",
      title: "Hero text overflows",
      domSnippet: "<h1>Hello world</h1>",
    });
    const b = findingDedupHash({
      category: "visual_layout",
      title: "  Hero  text   overflows ",
      domSnippet: "<h1>Hello   world</h1>",
    });
    expect(a).toBe(b);
  });

  it("returns the same hash regardless of case", () => {
    const a = findingDedupHash({
      category: "visual_layout",
      title: "Hero TEXT overflows",
    });
    const b = findingDedupHash({
      category: "visual_layout",
      title: "hero text overflows",
    });
    expect(a).toBe(b);
  });

  it("returns a different hash for different categories", () => {
    const a = findingDedupHash({ category: "visual_layout", title: "x" });
    const b = findingDedupHash({ category: "accessibility", title: "x" });
    expect(a).not.toBe(b);
  });

  it("treats missing domSnippet identically to empty string", () => {
    const a = findingDedupHash({ category: "content", title: "lorem" });
    const b = findingDedupHash({ category: "content", title: "lorem", domSnippet: "" });
    expect(a).toBe(b);
  });

  it("returns a 32-char prefix of a sha256", () => {
    expect(findingDedupHash({ category: "functional", title: "x" })).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("scanFingerprint", () => {
  it("orders viewports for stability", () => {
    expect(scanFingerprint("https://x.com/", ["mobile", "desktop"])).toBe(
      scanFingerprint("https://x.com/", ["desktop", "mobile"]),
    );
  });
  it("differs for different URLs", () => {
    expect(scanFingerprint("https://x.com/a", ["desktop"])).not.toBe(
      scanFingerprint("https://x.com/b", ["desktop"]),
    );
  });
});
