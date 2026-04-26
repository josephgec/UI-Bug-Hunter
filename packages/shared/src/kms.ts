import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// Provider-agnostic KMS interface used by the credential vault. Phase 2
// ships a local AES-256-GCM provider for dev and a stub AwsKmsProvider — the
// real AWS implementation lands when we deploy out of localhost.
//
// SECURITY: plaintext never leaves this module's call sites. The worker
// decrypts at scan time, hands the bytes to BrowserSession's auth-injection
// path, and discards them. Plaintext is never logged, never sent to the LLM,
// never persisted.
export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  keyId: string;
}

export interface KmsProvider {
  /** Stable identifier for the key currently used for encryption. */
  readonly currentKeyId: string;
  encrypt(plaintext: Buffer): Promise<EncryptedBlob>;
  decrypt(blob: EncryptedBlob): Promise<Buffer>;
}

/**
 * Local provider for development. Derives an AES-256 key from KMS_LOCAL_KEY
 * via scrypt; uses AES-256-GCM with a fresh 12-byte IV per ciphertext. The
 * 16-byte GCM auth tag is appended to the ciphertext.
 *
 * Not suitable for production: the key lives in the .env file. Production
 * uses AwsKmsProvider (or GCP KMS / Azure Key Vault) which performs envelope
 * encryption with a customer-managed key that never leaves the HSM.
 */
export class LocalKmsProvider implements KmsProvider {
  readonly currentKeyId = "local-v1";
  private readonly key: Buffer;

  constructor(passphrase: string) {
    if (passphrase.length < 16) {
      throw new Error("KMS_LOCAL_KEY must be at least 16 characters");
    }
    // scrypt with a fixed salt — the secret is the passphrase. A real
    // implementation would store a salt per-key-rotation.
    this.key = scryptSync(passphrase, "ubh-local-kms-v1", 32);
  }

  async encrypt(plaintext: Buffer): Promise<EncryptedBlob> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: Buffer.concat([ct, tag]),
      iv,
      keyId: this.currentKeyId,
    };
  }

  async decrypt(blob: EncryptedBlob): Promise<Buffer> {
    if (blob.keyId !== this.currentKeyId) {
      // In a multi-key world we'd look up the key by id; the local provider
      // only knows about its current key.
      throw new Error(`unknown keyId: ${blob.keyId}`);
    }
    if (blob.ciphertext.length < 17) throw new Error("ciphertext too short");
    const tag = blob.ciphertext.subarray(blob.ciphertext.length - 16);
    const ct = blob.ciphertext.subarray(0, blob.ciphertext.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", this.key, blob.iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}

/**
 * AWS KMS provider stub. Wired to the same interface so callers don't change.
 * The real implementation will use @aws-sdk/client-kms's envelope-encryption
 * pattern: GenerateDataKey for encryption, Decrypt for retrieval.
 */
export class AwsKmsProvider implements KmsProvider {
  readonly currentKeyId: string;
  constructor(keyId: string) {
    this.currentKeyId = keyId;
  }
  async encrypt(_plaintext: Buffer): Promise<EncryptedBlob> {
    throw new Error("AwsKmsProvider not implemented yet — set KMS_PROVIDER=local for dev");
  }
  async decrypt(_blob: EncryptedBlob): Promise<Buffer> {
    throw new Error("AwsKmsProvider not implemented yet — set KMS_PROVIDER=local for dev");
  }
}

let cached: KmsProvider | null = null;
export function getKms(): KmsProvider {
  if (cached) return cached;
  const kind = (process.env.KMS_PROVIDER ?? "local").toLowerCase();
  if (kind === "local") {
    const key = process.env.KMS_LOCAL_KEY;
    if (!key) {
      throw new Error("KMS_LOCAL_KEY is not set — required for KMS_PROVIDER=local");
    }
    cached = new LocalKmsProvider(key);
  } else if (kind === "aws") {
    const keyId = process.env.AWS_KMS_KEY_ID;
    if (!keyId) throw new Error("AWS_KMS_KEY_ID is not set");
    cached = new AwsKmsProvider(keyId);
  } else {
    throw new Error(`Unknown KMS_PROVIDER: ${kind}`);
  }
  return cached;
}
