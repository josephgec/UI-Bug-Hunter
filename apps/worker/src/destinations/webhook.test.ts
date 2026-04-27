import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookDestinationProvider, WebhookConfigSchema } from "./webhook.js";

describe("WebhookDestinationProvider", () => {
  const provider = new WebhookDestinationProvider();

  it("test() rejects malformed config without making a network call", async () => {
    const r = await provider.test({});
    expect(r).toEqual({ ok: false, error: "invalid_config" });
  });

  it("test() accepts a valid config without pinging the URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await provider.test({
      url: "https://example.com/hook",
      secret: "long-enough-secret",
    });
    expect(r).toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  describe("send()", () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
      // @ts-expect-error overriding global fetch for the test
      globalThis.fetch = fetchMock;
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("posts a JSON body with a sha256 HMAC signature", async () => {
      const config = { url: "https://example.com/hook", secret: "the-shared-secret" };
      const finding = {
        id: "f1",
        category: "visual_layout" as const,
        severity: "high" as const,
        confidence: 0.9,
        title: "Hero overlap",
        description: "Sticky nav overlaps hero",
        screenshotUrl: null,
        scanId: "s1",
        projectName: "Acme",
        targetUrl: "https://example.com",
        dashboardUrl: "https://app.uibughunter.dev/scans/s1",
      };
      const r = await provider.send(config, finding);
      expect(r.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
      const args = fetchMock.mock.calls[0]![1] as RequestInit;
      const body = args.body as string;
      const headers = args.headers as Record<string, string>;
      const expected = `sha256=${createHmac("sha256", config.secret).update(body).digest("hex")}`;
      expect(headers["x-ubh-signature"]).toBe(expected);
      const parsed = JSON.parse(body);
      expect(parsed.kind).toBe("finding");
      expect(parsed.finding.id).toBe("f1");
    });

    it("returns ok=false when the receiver returns a non-2xx", async () => {
      fetchMock.mockResolvedValueOnce(new Response("nope", { status: 502, statusText: "Bad Gateway" }));
      const r = await provider.send(
        { url: "https://example.com/hook", secret: "shared-secret" },
        {
          id: "f", category: "functional", severity: "low", confidence: 0.5,
          title: "x", description: "y", screenshotUrl: null, scanId: "s", projectName: "p",
          targetUrl: "https://example.com", dashboardUrl: "https://app/scans/s",
        },
      );
      expect(r.ok).toBe(false);
      expect(r.error).toContain("502");
    });
  });

  it("schema rejects too-short secret", () => {
    expect(() =>
      WebhookConfigSchema.parse({ url: "https://example.com", secret: "short" }),
    ).toThrow();
  });
});
