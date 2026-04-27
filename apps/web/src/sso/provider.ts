import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Phase 3 SSO. Provider-agnostic interface (WorkOS by default, with Mock for
// dev). The web app stores connections in SsoConnection — KMS-encrypted —
// and the provider's authorize() / verify() methods translate between our
// state cookies and the IdP's redirect dance.

export interface InitiateInput {
  orgId: string;
  connectionId: string;
  redirectUri: string;
}

export interface VerifyInput {
  code: string;
  state: string;
}

export interface SsoUserProfile {
  email: string;
  firstName?: string;
  lastName?: string;
  /** Provider's stable user id (sub for OIDC, NameID for SAML). */
  externalId: string;
  /** If true, the user came from an SSO connection that lets us provision the user. */
  trusted: boolean;
}

export interface SsoProvider {
  readonly name: string;
  /** Returns a redirect URL the user should be sent to. */
  authorize(input: InitiateInput): Promise<{ url: string; state: string }>;
  /** Verify the IdP's callback and return a user profile. */
  verify(input: VerifyInput): Promise<SsoUserProfile>;
}

let cached: SsoProvider | null = null;

export function getSso(): SsoProvider {
  if (cached) return cached;
  const kind = (process.env.SSO_PROVIDER ?? "mock").toLowerCase();
  if (kind === "workos") {
    const { WorkOSSsoProvider } = require("./workos.js") as typeof import("./workos.js");
    cached = new WorkOSSsoProvider();
  } else {
    const { MockSsoProvider } = require("./mock.js") as typeof import("./mock.js");
    cached = new MockSsoProvider();
  }
  return cached;
}

// State-token helpers used by both providers — HMAC-protected so we can
// detect tampered callbacks before we hit the IdP's API.
export function signState(payload: string, secret: string): string {
  const nonce = randomBytes(8).toString("hex");
  const body = `${payload}.${nonce}`;
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${sig}`;
}

export function verifyState(state: string, secret: string): { payload: string; nonce: string } | null {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [payload, nonce, sig] = parts;
  if (!payload || !nonce || !sig) return null;
  const expected = createHmac("sha256", secret).update(`${payload}.${nonce}`).digest("hex");
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch {
    return null;
  }
  return { payload, nonce };
}
