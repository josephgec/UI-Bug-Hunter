import { describe, expect, it } from "vitest";
import { redactPayload, AUDIT_ACTIONS } from "./audit.js";

describe("redactPayload", () => {
  it("redacts top-level password / token / api_key keys", () => {
    expect(
      redactPayload({
        email: "x@y.z",
        password: "p4ssw0rd",
        api_key: "sk_live_xxx",
        token: "abc",
      }),
    ).toEqual({
      email: "x@y.z",
      password: "[redacted]",
      api_key: "[redacted]",
      token: "[redacted]",
    });
  });

  it("redacts nested sensitive keys", () => {
    expect(
      redactPayload({
        config: { authorization: "Bearer x", innocent: 1 },
      }),
    ).toEqual({ config: { authorization: "[redacted]", innocent: 1 } });
  });

  it("redacts inside arrays", () => {
    expect(
      redactPayload({
        creds: [{ secret: "s1" }, { secret: "s2" }],
      }),
    ).toEqual({ creds: [{ secret: "[redacted]" }, { secret: "[redacted]" }] });
  });

  it("is case-insensitive for key matching", () => {
    expect(redactPayload({ API_KEY: "x", PassWord: "p" })).toEqual({
      API_KEY: "[redacted]",
      PassWord: "[redacted]",
    });
  });

  it("preserves non-redactable values", () => {
    expect(redactPayload({ email: "x@y.z", count: 7, active: true, items: [1, 2] })).toEqual({
      email: "x@y.z",
      count: 7,
      active: true,
      items: [1, 2],
    });
  });

  it("handles cycles without exploding", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const out = redactPayload(a) as Record<string, unknown>;
    expect(out.name).toBe("a");
    expect(out.self).toBe("[circular]");
  });

  it("AUDIT_ACTIONS contains stable noun.verb tokens", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });
});
