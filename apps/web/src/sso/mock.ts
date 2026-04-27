import {
  signState,
  verifyState,
  type InitiateInput,
  type SsoProvider,
  type SsoUserProfile,
  type VerifyInput,
} from "./provider.js";

// Dev SSO provider. Skips the IdP roundtrip — authorize() returns a URL on
// /api/v1/sso/mock-callback that hands back a deterministic profile keyed by
// the connection id. Used in tests + local dev so SSO routes are exercised
// without WorkOS keys.
export class MockSsoProvider implements SsoProvider {
  readonly name = "mock";
  private readonly secret = process.env.SSO_MOCK_SECRET ?? "dev-mock-secret-1234567890";

  async authorize(input: InitiateInput): Promise<{ url: string; state: string }> {
    const state = signState(`${input.orgId}:${input.connectionId}`, this.secret);
    const url = `${input.redirectUri}?code=mock-code&state=${encodeURIComponent(state)}`;
    return { url, state };
  }

  async verify(input: VerifyInput): Promise<SsoUserProfile> {
    const v = verifyState(input.state, this.secret);
    if (!v) throw new Error("invalid_state");
    const [orgId, connectionId] = v.payload.split(":");
    return {
      email: `mock-${connectionId}@${orgId}.test`,
      firstName: "Mock",
      lastName: "User",
      externalId: `mock-${connectionId}`,
      trusted: true,
    };
  }
}
