/**
 * Google / YouTube OAuth helpers.
 *
 * We use YouTube Data API scopes so we can later add tracks (videos) to a
 * playlist on behalf of the user.
 */

export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube"];

export async function createStateToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function youtubeAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  scopes,
}) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scopes.join(" "));

  // Critical: request refresh token.
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");

  u.searchParams.set("state", state);
  return u.toString();
}

export async function exchangeCodeForTokens({ env, code, redirectUri }) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${text}`);
  }

  return await res.json();
}
