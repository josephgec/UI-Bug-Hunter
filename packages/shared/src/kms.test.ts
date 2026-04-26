import { describe, expect, it } from "vitest";
import { LocalKmsProvider } from "./kms.js";

describe("LocalKmsProvider", () => {
  it("round-trips a small UTF-8 plaintext", async () => {
    const kms = new LocalKmsProvider("test-passphrase-1234");
    const blob = await kms.encrypt(Buffer.from("hello world"));
    const back = await kms.decrypt(blob);
    expect(back.toString("utf8")).toBe("hello world");
  });

  it("produces different ciphertexts for the same plaintext (fresh IV)", async () => {
    const kms = new LocalKmsProvider("test-passphrase-1234");
    const a = await kms.encrypt(Buffer.from("identical"));
    const b = await kms.encrypt(Buffer.from("identical"));
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("rejects ciphertext tampering via the auth tag", async () => {
    const kms = new LocalKmsProvider("test-passphrase-1234");
    const blob = await kms.encrypt(Buffer.from("secret"));
    // Flip a bit in the ciphertext.
    const tampered = Buffer.from(blob.ciphertext);
    tampered[0] = tampered[0]! ^ 0x01;
    await expect(
      kms.decrypt({ ciphertext: tampered, iv: blob.iv, keyId: blob.keyId }),
    ).rejects.toThrow();
  });

  it("rejects an unknown keyId", async () => {
    const kms = new LocalKmsProvider("test-passphrase-1234");
    const blob = await kms.encrypt(Buffer.from("x"));
    await expect(
      kms.decrypt({ ciphertext: blob.ciphertext, iv: blob.iv, keyId: "rotated-v2" }),
    ).rejects.toThrow(/unknown keyId/);
  });

  it("rejects a too-short passphrase", () => {
    expect(() => new LocalKmsProvider("short")).toThrow(/at least 16/);
  });

  it("two providers with different passphrases cannot decrypt each other's data", async () => {
    const a = new LocalKmsProvider("aaaaaaaaaaaaaaaa");
    const b = new LocalKmsProvider("bbbbbbbbbbbbbbbb");
    const blob = await a.encrypt(Buffer.from("x"));
    await expect(b.decrypt(blob)).rejects.toThrow();
  });
});
