/**
 * "Sign In with LinkedIn using OpenID Connect". The basic OIDC product only
 * exposes identity claims (sub, name, email, picture, locale) — NOT work
 * history / education / skills, which are gated behind LinkedIn partner
 * programs. So this bootstraps the account + pre-fills identity; résumé content
 * still comes from the upload + mentor call.
 */
const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET ?? "";
const REDIRECT_URI =
  process.env.LINKEDIN_REDIRECT_URI ?? "http://localhost:3000/api/auth/linkedin/callback";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const SCOPE = "openid profile email";

export function linkedinConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    scope: SCOPE,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`LinkedIn token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("LinkedIn token response missing access_token");
  return json.access_token;
}

export interface LinkedInUser {
  sub: string; // stable LinkedIn member id
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  locale?: string;
}

export async function fetchUserinfo(accessToken: string): Promise<LinkedInUser> {
  const res = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`LinkedIn userinfo ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as LinkedInUser;
  if (!json.sub) throw new Error("LinkedIn userinfo missing sub");
  return json;
}
