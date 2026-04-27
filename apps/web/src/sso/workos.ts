import {
  signState,
  verifyState,
  type InitiateInput,
  type SsoProvider,
  type SsoUserProfile,
  type VerifyInput,
} from "./provider.js";

// WorkOS SSO provider skeleton. Uses the AuthKit / SSO authorize-and-callback
// flow. Live wiring lands when WORKOS_API_KEY + WORKOS_CLIENT_ID are set in
// production. Until then, methods throw with the env hint so misconfiguration
// can't silently hand traffic to /dev/null.
export class WorkOSSsoProvider implements SsoProvider {
  readonly name = "workos";
  private readonly secret: string;

  constructor() {
    this.secret = process.env.SSO_STATE_SECRET ?? "";
    if (!this.secret) {
      throw new Error("SSO_STATE_SECRET is not set");
    }
  }

  async authorize(input: InitiateInput): Promise<{ url: string; state: string }> {
    const apiKey = process.env.WORKOS_API_KEY;
    const clientId = process.env.WORKOS_CLIENT_ID;
    if (!apiKey || !clientId) {
      throw new Error("WORKOS_API_KEY / WORKOS_CLIENT_ID not set — set SSO_PROVIDER=mock for dev");
    }
    const state = signState(`${input.orgId}:${input.connectionId}`, this.secret);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: input.redirectUri,
      state,
      connection: input.connectionId,
    });
    return {
      url: `https://api.workos.com/sso/authorize?${params.toString()}`,
      state,
    };
  }

  async verify(input: VerifyInput): Promise<SsoUserProfile> {
    if (!verifyState(input.state, this.secret)) {
      throw new Error("invalid_state");
    }
    const apiKey = process.env.WORKOS_API_KEY;
    const clientId = process.env.WORKOS_CLIENT_ID;
    if (!apiKey || !clientId) {
      throw new Error("WORKOS_API_KEY / WORKOS_CLIENT_ID not set");
    }
    const res = await fetch("https://api.workos.com/sso/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: apiKey,
        code: input.code,
        grant_type: "authorization_code",
      }).toString(),
    });
    const json = (await res.json()) as {
      profile?: {
        email: string;
        first_name?: string;
        last_name?: string;
        id: string;
        connection_type?: string;
      };
      error?: string;
    };
    if (!json.profile) throw new Error(json.error ?? "no_profile");
    return {
      email: json.profile.email,
      ...(json.profile.first_name ? { firstName: json.profile.first_name } : {}),
      ...(json.profile.last_name ? { lastName: json.profile.last_name } : {}),
      externalId: json.profile.id,
      trusted: true,
    };
  }
}
