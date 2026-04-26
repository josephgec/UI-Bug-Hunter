import { describe, expect, it } from "vitest";
import {
  addDiscovered,
  newFrontier,
  normalizeUrl,
  sameOriginNormalized,
  takeNext,
} from "./crawl.js";

describe("normalizeUrl", () => {
  it("strips fragments", () => {
    expect(normalizeUrl("https://x.com/foo#bar")).toBe("https://x.com/foo");
  });
  it("collapses trailing slash on non-root paths", () => {
    expect(normalizeUrl("https://x.com/foo/")).toBe("https://x.com/foo");
    expect(normalizeUrl("https://x.com/")).toBe("https://x.com/");
  });
  it("sorts query params for stable ordering", () => {
    expect(normalizeUrl("https://x.com/?b=2&a=1")).toBe("https://x.com/?a=1&b=2");
  });
  it("returns the input on bad URL", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("sameOriginNormalized", () => {
  const seed = "https://acme.example/start";
  it("accepts a same-origin absolute URL", () => {
    expect(sameOriginNormalized("https://acme.example/about", seed)).toBe(
      "https://acme.example/about",
    );
  });
  it("resolves a relative URL against the seed origin", () => {
    expect(sameOriginNormalized("/about", seed)).toBe("https://acme.example/about");
  });
  it("rejects a different origin", () => {
    expect(sameOriginNormalized("https://other.example/foo", seed)).toBeNull();
  });
  it("rejects mailto: and tel:", () => {
    expect(sameOriginNormalized("mailto:x@y.z", seed)).toBeNull();
    expect(sameOriginNormalized("tel:+1234", seed)).toBeNull();
  });
  it("rejects subdomain (different host)", () => {
    expect(sameOriginNormalized("https://blog.acme.example/foo", seed)).toBeNull();
  });
  it("strips fragment + dedups via normalizeUrl", () => {
    expect(sameOriginNormalized("https://acme.example/x#hash", seed)).toBe(
      "https://acme.example/x",
    );
  });
});

describe("frontier", () => {
  it("yields the seed on first take", () => {
    const f = newFrontier({ seedUrl: "https://x.com/", maxDepth: 2, maxPages: 10 });
    const next = takeNext(f);
    expect(next).toEqual({ url: "https://x.com/", depth: 0 });
  });

  it("addDiscovered enqueues same-origin only and dedups", () => {
    const f = newFrontier({ seedUrl: "https://x.com/", maxDepth: 2, maxPages: 10 });
    takeNext(f);
    const r = addDiscovered(
      f,
      [
        "https://x.com/a",
        "https://x.com/a", // dup
        "/b",
        "https://other.com/c",
        "javascript:void(0)",
      ],
      0,
      "https://x.com/",
    );
    expect(r.added).toBe(2);
    // /b resolves to https://x.com/b
    const next1 = takeNext(f);
    const next2 = takeNext(f);
    expect(new Set([next1?.url, next2?.url])).toEqual(
      new Set(["https://x.com/a", "https://x.com/b"]),
    );
    expect(takeNext(f)).toBeNull();
  });

  it("respects maxDepth — children of leaves are dropped", () => {
    const f = newFrontier({ seedUrl: "https://x.com/", maxDepth: 1, maxPages: 10 });
    takeNext(f); // depth 0
    addDiscovered(f, ["https://x.com/a"], 0, "https://x.com/"); // depth 1: ok
    takeNext(f);
    const r = addDiscovered(f, ["https://x.com/b"], 1, "https://x.com/"); // depth 2: too deep
    expect(r.added).toBe(0);
    expect(r.rejected).toBe(1);
    expect(takeNext(f)).toBeNull();
  });

  it("respects maxPages by refusing to take more after the cap", () => {
    const f = newFrontier({ seedUrl: "https://x.com/", maxDepth: 5, maxPages: 2 });
    addDiscovered(
      f,
      ["https://x.com/a", "https://x.com/b", "https://x.com/c"],
      0,
      "https://x.com/",
    );
    takeNext(f); // 1 (seed)
    takeNext(f); // 2
    expect(takeNext(f)).toBeNull(); // capped
  });
});
