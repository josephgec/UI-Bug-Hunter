import { describe, expect, it } from "vitest";
import { findingsAtOrAbove, formatPrComment } from "./format";
import type { Finding } from "./types";

const finding = (over: Partial<Finding>): Finding => ({
  id: "f1",
  category: "visual_layout",
  severity: "medium",
  confidence: 0.8,
  title: "Hero overlap",
  description: "Sticky nav overlaps hero h1",
  ...over,
});

describe("findingsAtOrAbove", () => {
  it("includes the threshold severity itself", () => {
    const out = findingsAtOrAbove(
      [finding({ severity: "high" }), finding({ severity: "medium" })],
      "high",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe("high");
  });
  it("includes everything above the threshold", () => {
    const out = findingsAtOrAbove(
      [
        finding({ severity: "critical" }),
        finding({ severity: "high" }),
        finding({ severity: "medium" }),
        finding({ severity: "low" }),
      ],
      "medium",
    );
    expect(out.map((f) => f.severity)).toEqual(["critical", "high", "medium"]);
  });
});

describe("formatPrComment", () => {
  it("renders a green summary when no findings cross the threshold", () => {
    const body = formatPrComment({
      apiUrl: "https://api.test",
      scans: [{ scanId: "s1", targetUrl: "https://example.com", findings: [finding({ severity: "low" })] }],
      threshold: "high",
      failed: 0,
    });
    expect(body).toContain("✅");
    expect(body).toContain("https://example.com");
  });

  it("renders a red summary with up-to-five flagged inline", () => {
    const findings = [
      finding({ id: "1", severity: "critical", title: "Cart broken" }),
      finding({ id: "2", severity: "high", title: "Login 500s" }),
      finding({ id: "3", severity: "high", title: "Submit dead" }),
      finding({ id: "4", severity: "high", title: "Image 404" }),
      finding({ id: "5", severity: "high", title: "Z-index" }),
      finding({ id: "6", severity: "high", title: "Sixth one" }),
    ];
    const body = formatPrComment({
      apiUrl: "https://api.test",
      scans: [{ scanId: "s1", targetUrl: "https://example.com", findings }],
      threshold: "high",
      failed: 6,
    });
    expect(body).toContain("❌");
    expect(body).toContain("Cart broken");
    expect(body).toContain("Login 500s");
    expect(body).toContain("…and 1 more above threshold.");
    expect(body).not.toContain("Sixth one");
  });

  it("collapses below-threshold findings into a <details> grouped by category", () => {
    const findings = [
      finding({ id: "1", severity: "low", category: "accessibility", title: "alt missing" }),
      finding({ id: "2", severity: "low", category: "accessibility", title: "label missing" }),
      finding({ id: "3", severity: "medium", category: "content", title: "lorem ipsum" }),
    ];
    const body = formatPrComment({
      apiUrl: "https://api.test",
      scans: [{ scanId: "s1", targetUrl: "https://example.com", findings }],
      threshold: "high",
      failed: 0,
    });
    expect(body).toContain("<details><summary>3 finding(s) below high");
    expect(body).toContain("**accessibility** (2)");
    expect(body).toContain("**content** (1)");
  });

  it("links each scan back to the dashboard", () => {
    const body = formatPrComment({
      apiUrl: "https://api.test",
      scans: [{ scanId: "abc", targetUrl: "https://example.com", findings: [] }],
      threshold: "high",
      failed: 0,
    });
    expect(body).toContain("https://api.test/scans/abc");
  });
});
