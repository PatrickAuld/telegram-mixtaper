/**
 * YouTube (Google) OAuth Token Manager using Cloudflare KV Storage.
 *
 * NOTE: This reuses the existing SPOTIFY_TOKENS KV binding for storage.
 * If we ever rename the binding, update this class accordingly.
 */

export class YouTubeTokenManager {
  constructor(env) {
    this.env = env;
    this.kv = env.SPOTIFY_TOKENS;
  }

  userTokenKey(telegramUserId) {
    return `youtube_user_oauth:${telegramUserId}`;
  }

  stateKey(state) {
    return `youtube_oauth_state:${state}`;
  }

  async setTelegramUserTokens(telegramUserId, tokenResponse) {
    const expiresAt = Date.now() + tokenResponse.expires_in * 1000;
    const tokenData = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    };

    await this.kv.put(
      this.userTokenKey(telegramUserId),
      JSON.stringify(tokenData),
    );
  }

  async unlinkTelegramUser(telegramUserId) {
    await this.kv.delete(this.userTokenKey(telegramUserId));
  }

  async storeOAuthState(state, payload) {
    // expire after 10 minutes
    await this.kv.put(this.stateKey(state), JSON.stringify(payload), {
      expirationTtl: 10 * 60,
    });
  }

  async consumeOAuthState(state) {
    const key = this.stateKey(state);
    const payload = await this.kv.get(key, "json");
    if (payload) await this.kv.delete(key);
    return payload;
  }
}
