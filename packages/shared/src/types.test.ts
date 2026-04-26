import { describe, expect, it } from "vitest";
import {
  BUG_CATEGORIES,
  ReportedBugSchema,
  ScanJobSchema,
  SEVERITIES,
  VIEWPORTS,
} from "./types.js";

describe("type schemas", () => {
  it("BUG_CATEGORIES, SEVERITIES, VIEWPORTS are stable enums", () => {
    expect(BUG_CATEGORIES).toEqual([
      "visual_layout",
      "functional",
      "content",
      "accessibility",
    ]);
    expect(SEVERITIES).toEqual(["critical", "high", "medium", "low"]);
    expect(VIEWPORTS).toEqual(["mobile", "tablet", "desktop"]);
  });

  describe("ReportedBugSchema", () => {
    it("accepts a valid finding", () => {
      const r = ReportedBugSchema.parse({
        category: "visual_layout",
        severity: "high",
        confidence: 0.85,
        title: "Hero text overflows",
        description: "On mobile, hero h1 clips inside its container.",
      });
      expect(r.reproductionSteps).toEqual([]);
    });
    it("rejects confidence outside [0,1]", () => {
      expect(() =>
        ReportedBugSchema.parse({
          category: "visual_layout",
          severity: "high",
          confidence: 1.5,
          title: "x",
          description: "y",
        }),
      ).toThrow();
    });
    it("rejects unknown category", () => {
      expect(() =>
        ReportedBugSchema.parse({
          category: "design_critique",
          severity: "high",
          confidence: 0.5,
          title: "x",
          description: "y",
        }),
      ).toThrow();
    });
    it("rejects empty title or description", () => {
      expect(() =>
        ReportedBugSchema.parse({
          category: "content",
          severity: "low",
          confidence: 0.7,
          title: "",
          description: "ok",
        }),
      ).toThrow();
    });
  });

  describe("ScanJobSchema", () => {
    it("defaults viewport to desktop", () => {
      const r = ScanJobSchema.parse({
        scanId: "s1",
        projectId: "p1",
        url: "https://example.com",
      });
      expect(r.viewport).toBe("desktop");
    });
    it("rejects non-URL", () => {
      expect(() =>
        ScanJobSchema.parse({
          scanId: "s1",
          projectId: "p1",
          url: "notaurl",
        }),
      ).toThrow();
    });
  });
});
