import { getKms } from "@ubh/shared";

export interface CredentialPlaintext {
  kind: "HEADER" | "COOKIE" | "BASIC_AUTH";
  data: Record<string, string | undefined>;
}

export async function encryptCredentialPlaintext(
  pt: CredentialPlaintext,
): Promise<{ ciphertext: Buffer; iv: Buffer; keyId: string }> {
  const kms = getKms();
  const json = JSON.stringify(pt.data);
  return kms.encrypt(Buffer.from(json, "utf8"));
}
