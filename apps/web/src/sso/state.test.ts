import { describe, expect, it } from "vitest";
import { signState, verifyState } from "./provider.js";

describe("SSO state token", () => {
  const secret = "test-secret-123456";

  it("signs and verifies a payload", () => {
    const token = signState("orgA:connB", secret);
    const v = verifyState(token, secret);
    expect(v?.payload).toBe("orgA:connB");
    expect(v?.nonce).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rejects a tampered signature", () => {
    const token = signState("orgA:connB", secret);
    const tampered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(verifyState(tampered, secret)).toBeNull();
  });

  it("rejects when verified with the wrong secret", () => {
    const token = signState("orgA:connB", secret);
    expect(verifyState(token, "different-secret-1234567")).toBeNull();
  });

  it("rejects malformed state strings", () => {
    expect(verifyState("not.a.token.with.too.many.parts", secret)).toBeNull();
    expect(verifyState("only-one-part", secret)).toBeNull();
    expect(verifyState("", secret)).toBeNull();
  });

  it("two signatures of the same payload differ (fresh nonce)", () => {
    const a = signState("orgA:connB", secret);
    const b = signState("orgA:connB", secret);
    expect(a).not.toBe(b);
  });
});
