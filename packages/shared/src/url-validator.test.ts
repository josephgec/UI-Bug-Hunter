import { describe, expect, it, vi } from "vitest";
import { validateScanUrl } from "./url-validator.js";

vi.mock("node:dns/promises", () => ({
  default: {
    lookup: vi.fn(async (hostname: string) => {
      // Test fixtures: hostnames map deterministically to IPs.
      const map: Record<string, { address: string; family: number }[]> = {
        "public.example.com": [{ address: "93.184.216.34", family: 4 }],
        "internal.example.com": [{ address: "10.0.0.5", family: 4 }],
        "metadata.example.com": [{ address: "169.254.169.254", family: 4 }],
        "v6public.example.com": [{ address: "2606:2800:220:1::1", family: 6 }],
        "v6private.example.com": [{ address: "fc00::1", family: 6 }],
        "mixed.example.com": [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.5", family: 4 },
        ],
      };
      const result = map[hostname];
      if (!result) throw new Error("ENOTFOUND");
      return result;
    }),
  },
}));

describe("validateScanUrl", () => {
  it("accepts a normal https URL with a public IP", async () => {
    const r = await validateScanUrl("https://public.example.com/path");
    expect(r.ok).toBe(true);
  });

  it("rejects javascript: scheme", async () => {
    const r = await validateScanUrl("javascript:alert(1)");
    expect(r).toEqual({ ok: false, reason: "disallowed_protocol", detail: "javascript:" });
  });

  it("rejects file: scheme", async () => {
    const r = await validateScanUrl("file:///etc/passwd");
    expect(r).toEqual({ ok: false, reason: "disallowed_protocol", detail: "file:" });
  });

  it("rejects garbage strings", async () => {
    const r = await validateScanUrl("not a url at all");
    expect(r).toEqual({ ok: false, reason: "invalid_url" });
  });

  it("rejects literal RFC1918 IPs", async () => {
    expect((await validateScanUrl("http://10.0.0.1")).ok).toBe(false);
    expect((await validateScanUrl("http://192.168.1.1")).ok).toBe(false);
    expect((await validateScanUrl("http://172.16.0.1")).ok).toBe(false);
    expect((await validateScanUrl("http://172.31.255.255")).ok).toBe(false);
  });

  it("accepts IPs just outside RFC1918", async () => {
    const r = await validateScanUrl("http://172.32.0.1");
    expect(r.ok).toBe(true);
  });

  it("rejects loopback v4 and v6", async () => {
    expect((await validateScanUrl("http://127.0.0.1")).ok).toBe(false);
    expect((await validateScanUrl("http://[::1]")).ok).toBe(false);
  });

  it("rejects link-local (incl. cloud metadata) literally", async () => {
    const r = await validateScanUrl("http://169.254.169.254/latest/meta-data/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("metadata_ip");
  });

  it("rejects when DNS resolves to a private IP", async () => {
    const r = await validateScanUrl("http://internal.example.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("private_ip_resolved");
  });

  it("rejects when DNS resolves to the cloud metadata IP", async () => {
    const r = await validateScanUrl("http://metadata.example.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("metadata_ip");
  });

  it("rejects when any one of multiple resolved IPs is private", async () => {
    const r = await validateScanUrl("http://mixed.example.com");
    expect(r.ok).toBe(false);
  });

  it("rejects unique-local IPv6 (fc00::/7)", async () => {
    const r = await validateScanUrl("http://v6private.example.com");
    expect(r.ok).toBe(false);
  });

  it("accepts a public v6 host", async () => {
    const r = await validateScanUrl("http://v6public.example.com");
    expect(r.ok).toBe(true);
  });

  it("rejects when DNS lookup itself fails", async () => {
    const r = await validateScanUrl("http://nx.example.com");
    expect(r).toMatchObject({ ok: false, reason: "dns_failed" });
  });
});
