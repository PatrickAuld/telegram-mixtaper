/**
 * Spotify per-user OAuth helpers.
 *
 * We use the standard Authorization Code flow (confidential client), since the
 * worker has access to SPOTIFY_CLIENT_SECRET.
 */

function requireEnv(env, key) {
  const val = env[key];
  if (!val) throw new Error(`${key} is required`);
  return val;
}

function base64UrlEncode(bytes) {
  // bytes: Uint8Array
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  // btoa expects binary string
  return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function createStateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function spotifyAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  scopes,
}) {
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", scopes.join(" "));
  // Helpful for switching accounts.
  url.searchParams.set("show_dialog", "true");
  return url.toString();
}

export async function exchangeCodeForTokens({ env, code, redirectUri }) {
  const clientId = requireEnv(env, "SPOTIFY_CLIENT_ID");
  const clientSecret = requireEnv(env, "SPOTIFY_CLIENT_SECRET");

  const authHeader = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token exchange failed: ${res.status} - ${text}`);
  }

  return /** @type {{access_token:string, refresh_token:string, expires_in:number, scope?:string, token_type?:string}} */ (
    await res.json()
  );
}

export const SPOTIFY_USER_SCOPES = [
  // So the add-to-playlist operation shows as the user.
  "playlist-modify-public",
  "playlist-modify-private",
];
