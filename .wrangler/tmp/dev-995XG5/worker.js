var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/spotify-token-manager.js
var SpotifyTokenManager = class {
  static {
    __name(this, "SpotifyTokenManager");
  }
  constructor(env) {
    this.env = env;
    this.kv = env.SPOTIFY_TOKENS;
  }
  /**
   * Get a valid access token, refreshing if necessary
   */
  async getAccessToken() {
    try {
      const tokenData = await this.kv.get("spotify_oauth", "json");
      if (tokenData && !this.isTokenExpired(tokenData)) {
        console.log("Using existing valid token");
        return tokenData.access_token;
      }
      const refreshToken = tokenData?.refresh_token || this.env.SPOTIFY_REFRESH_TOKEN;
      if (!refreshToken) {
        throw new Error("No refresh token available");
      }
      console.log("Refreshing expired token");
      return await this.refreshAccessToken(refreshToken);
    } catch (error) {
      console.error("Error getting access token:", error);
      if (this.env.SPOTIFY_ACCESS_TOKEN) {
        console.log("Falling back to environment token");
        return this.env.SPOTIFY_ACCESS_TOKEN;
      }
      throw new Error(`Failed to get access token: ${error.message}`);
    }
  }
  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      const clientId = this.env.SPOTIFY_CLIENT_ID;
      const clientSecret = this.env.SPOTIFY_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw new Error("Spotify client credentials not configured");
      }
      const authHeader = btoa(`${clientId}:${clientSecret}`);
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${authHeader}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
      }
      const tokens = await response.json();
      const expiresAt = Date.now() + tokens.expires_in * 1e3;
      const tokenData = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || refreshToken,
        // Use new refresh token if provided
        expires_at: expiresAt,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      await this.kv.put("spotify_oauth", JSON.stringify(tokenData));
      console.log("Stored refreshed token in KV");
      return tokens.access_token;
    } catch (error) {
      console.error("Error refreshing token:", error);
      throw error;
    }
  }
  /**
   * Check if a token is expired (with 60 second buffer)
   */
  isTokenExpired(tokenData) {
    if (!tokenData || !tokenData.expires_at) {
      return true;
    }
    const now = Date.now();
    const expiresAt = tokenData.expires_at;
    const bufferTime = 60 * 1e3;
    return now >= expiresAt - bufferTime;
  }
  /**
   * Initialize tokens in KV from environment variables (for first-time setup)
   */
  async initializeFromEnvironment() {
    try {
      const accessToken = this.env.SPOTIFY_ACCESS_TOKEN;
      const refreshToken = this.env.SPOTIFY_REFRESH_TOKEN;
      if (!accessToken || !refreshToken) {
        throw new Error("Environment tokens not found");
      }
      const expiresAt = Date.now() + 3600 * 1e3;
      const tokenData = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        updated_at: (/* @__PURE__ */ new Date()).toISOString(),
        source: "environment"
      };
      await this.kv.put("spotify_oauth", JSON.stringify(tokenData));
      console.log("Initialized tokens from environment variables");
      return accessToken;
    } catch (error) {
      console.error("Error initializing from environment:", error);
      throw error;
    }
  }
  /**
   * Get current token info (for debugging)
   */
  async getTokenInfo() {
    try {
      const tokenData = await this.kv.get("spotify_oauth", "json");
      if (!tokenData) {
        return { status: "no_token" };
      }
      return {
        status: this.isTokenExpired(tokenData) ? "expired" : "valid",
        expires_at: new Date(tokenData.expires_at).toISOString(),
        updated_at: tokenData.updated_at,
        has_refresh_token: !!tokenData.refresh_token
      };
    } catch (error) {
      return { status: "error", error: error.message };
    }
  }
};

// src/telegram-bot.js
var TelegramBot = class {
  static {
    __name(this, "TelegramBot");
  }
  constructor(botToken) {
    this.botToken = botToken;
    this.baseURL = `https://api.telegram.org/bot${botToken}`;
  }
  /**
   * Send a photo with caption (for track info with artwork)
   */
  async sendPhoto(chatId, photoUrl, caption, options = {}) {
    try {
      const payload = {
        chat_id: chatId,
        photo: photoUrl,
        caption,
        parse_mode: "HTML",
        // Using HTML for better formatting
        ...options
      };
      const response = await fetch(`${this.baseURL}/sendPhoto`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API error: ${response.status} - ${errorText}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Error sending photo:", error);
      throw error;
    }
  }
  /**
   * Send a text message
   */
  async sendMessage(chatId, text, options = {}) {
    try {
      const payload = {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        ...options
      };
      const response = await fetch(`${this.baseURL}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API error: ${response.status} - ${errorText}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Error sending message:", error);
      throw error;
    }
  }
  /**
   * Send track information as a reply to the original message
   */
  async sendTrackInfo(trackInfo, originalMessage) {
    try {
      const chatId = originalMessage.chat.id;
      const messageId = originalMessage.message_id;
      const artists = trackInfo.artists.join(", ");
      const caption = `\u{1F3B5} <b>${trackInfo.name}</b>
\u{1F464} ${artists}
\u{1F4BF} ${trackInfo.album}`;
      if (trackInfo.artwork_url) {
        return await this.sendPhoto(chatId, trackInfo.artwork_url, caption, {
          reply_to_message_id: messageId
        });
      } else {
        return await this.sendMessage(chatId, caption, {
          reply_to_message_id: messageId
        });
      }
    } catch (error) {
      console.error("Error sending track info:", error);
      try {
        const artists = trackInfo.artists.join(", ");
        const fallbackText = `\u{1F3B5} ${trackInfo.name} - ${artists}`;
        return await this.sendMessage(originalMessage.chat.id, fallbackText, {
          reply_to_message_id: originalMessage.message_id
        });
      } catch (fallbackError) {
        console.error("Fallback message also failed:", fallbackError);
        throw error;
      }
    }
  }
  /**
   * Set webhook URL
   */
  async setWebhook(webhookUrl, options = {}) {
    try {
      const payload = {
        url: webhookUrl,
        ...options
      };
      const response = await fetch(`${this.baseURL}/setWebhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to set webhook: ${response.status} - ${errorText}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Error setting webhook:", error);
      throw error;
    }
  }
  /**
   * Get webhook info
   */
  async getWebhookInfo() {
    try {
      const response = await fetch(`${this.baseURL}/getWebhookInfo`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get webhook info: ${response.status} - ${errorText}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Error getting webhook info:", error);
      throw error;
    }
  }
  /**
   * Delete webhook
   */
  async deleteWebhook() {
    try {
      const response = await fetch(`${this.baseURL}/deleteWebhook`, {
        method: "POST"
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete webhook: ${response.status} - ${errorText}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Error deleting webhook:", error);
      throw error;
    }
  }
  /**
   * Get bot information
   */
  async getMe() {
    try {
      const response = await fetch(`${this.baseURL}/getMe`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get bot info: ${response.status} - ${errorText}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Error getting bot info:", error);
      throw error;
    }
  }
  /**
   * Send formatted error message to error channel
   */
  async sendErrorNotification(env, error, context = "") {
    try {
      if (!env.TELEGRAM_ERROR_CHANNEL) {
        console.log("No error channel configured, skipping error notification");
        return;
      }
      const errorMessage = `\u{1F6A8} <b>Bot Error</b>

<b>Context:</b> ${context}
<b>Error:</b> ${error.message}
<b>Time:</b> ${(/* @__PURE__ */ new Date()).toISOString()}`;
      return await this.sendMessage(env.TELEGRAM_ERROR_CHANNEL, errorMessage);
    } catch (notificationError) {
      console.error("Failed to send error notification:", notificationError);
    }
  }
  /**
   * Send multiple track info messages for multiple Spotify links
   */
  async sendMultipleTrackInfo(trackInfoList, originalMessage) {
    const results = [];
    for (const trackInfo of trackInfoList) {
      try {
        const result = await this.sendTrackInfo(trackInfo, originalMessage);
        results.push({ success: true, result });
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to send track info for ${trackInfo.name}:`, error);
        results.push({ success: false, error: error.message, trackInfo });
      }
    }
    return results;
  }
  /**
   * Validate that the message came from Telegram (optional security check)
   */
  validateMessage(message, secretToken = null) {
    if (!message || typeof message !== "object") {
      return false;
    }
    if (!message.message_id || !message.chat) {
      return false;
    }
    if (secretToken) {
    }
    return true;
  }
};

// src/spotify-api.js
var SpotifyAPI = class {
  static {
    __name(this, "SpotifyAPI");
  }
  constructor(tokenManager) {
    this.tokenManager = tokenManager;
    this.baseURL = "https://api.spotify.com/v1";
  }
  /**
   * Get track information from Spotify
   */
  async getTrackInfo(trackId, accessToken) {
    try {
      const response = await fetch(`${this.baseURL}/tracks/${trackId}`, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      });
      if (!response.ok) {
        throw new Error(`Spotify API error: ${response.status} - ${response.statusText}`);
      }
      const track = await response.json();
      return {
        id: track.id,
        name: track.name,
        artists: track.artists.map((artist) => artist.name),
        album: track.album.name,
        artwork_url: track.album.images && track.album.images.length > 0 ? track.album.images[0].url : null,
        external_urls: track.external_urls,
        preview_url: track.preview_url,
        duration_ms: track.duration_ms
      };
    } catch (error) {
      console.error(`Error getting track info for ${trackId}:`, error);
      return null;
    }
  }
  /**
   * Add tracks to a Spotify playlist
   */
  async addTracksToPlaylist(trackUris, accessToken, env) {
    try {
      const playlistId = env.SPOTIFY_PLAYLIST_ID;
      if (!playlistId) {
        throw new Error("SPOTIFY_PLAYLIST_ID not configured");
      }
      const response = await fetch(`${this.baseURL}/playlists/${playlistId}/tracks`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          uris: trackUris,
          position: 0
          // Add to beginning of playlist
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to add tracks to playlist: ${response.status} - ${errorText}`);
      }
      const result = await response.json();
      console.log(`Successfully added ${trackUris.length} tracks to playlist`);
      return result;
    } catch (error) {
      console.error("Error adding tracks to playlist:", error);
      throw error;
    }
  }
  /**
   * Get playlist information
   */
  async getPlaylistInfo(playlistId, accessToken) {
    try {
      const response = await fetch(`${this.baseURL}/playlists/${playlistId}`, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to get playlist info: ${response.status}`);
      }
      const playlist = await response.json();
      return {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        public: playlist.public,
        collaborative: playlist.collaborative,
        tracks: {
          total: playlist.tracks.total
        },
        external_urls: playlist.external_urls,
        images: playlist.images
      };
    } catch (error) {
      console.error("Error getting playlist info:", error);
      return null;
    }
  }
  /**
   * Check if tracks already exist in playlist (to avoid duplicates)
   */
  async checkTracksInPlaylist(trackIds, accessToken, env) {
    try {
      const playlistId = env.SPOTIFY_PLAYLIST_ID;
      if (!playlistId) {
        throw new Error("SPOTIFY_PLAYLIST_ID not configured");
      }
      const response = await fetch(`${this.baseURL}/playlists/${playlistId}/tracks?limit=50&fields=items(track(id))`, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      });
      if (!response.ok) {
        console.warn(`Failed to check playlist tracks: ${response.status}`);
        return {};
      }
      const data = await response.json();
      const existingTrackIds = new Set(
        data.items.filter((item) => item.track && item.track.id).map((item) => item.track.id)
      );
      const duplicates = {};
      trackIds.forEach((trackId) => {
        duplicates[trackId] = existingTrackIds.has(trackId);
      });
      return duplicates;
    } catch (error) {
      console.error("Error checking tracks in playlist:", error);
      return {};
    }
  }
  /**
   * Get user's Spotify profile (for verification)
   */
  async getUserProfile(accessToken) {
    try {
      const response = await fetch(`${this.baseURL}/me`, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to get user profile: ${response.status}`);
      }
      const user = await response.json();
      return {
        id: user.id,
        display_name: user.display_name,
        email: user.email,
        country: user.country,
        followers: user.followers?.total || 0,
        images: user.images
      };
    } catch (error) {
      console.error("Error getting user profile:", error);
      return null;
    }
  }
};

// src/worker.js
var worker_default = {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/") {
        return new Response(JSON.stringify({
          status: "ok",
          message: "Telegram Mixtaper Bot is running",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      if (request.method === "POST" && url.pathname === "/webhook") {
        return await handleTelegramWebhook(request, env, ctx);
      }
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Worker error:", error);
      return new Response(JSON.stringify({
        error: "Internal Server Error",
        message: error.message
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};
async function handleTelegramWebhook(request, env, ctx) {
  try {
    const update = await request.json();
    console.log("Received Telegram update:", JSON.stringify(update));
    if (!update.message || !update.message.text) {
      return new Response("OK", { status: 200 });
    }
    const message = update.message;
    const spotifyLinks = extractSpotifyLinks(message.text);
    if (spotifyLinks.length === 0) {
      return new Response("OK", { status: 200 });
    }
    console.log(`Found ${spotifyLinks.length} Spotify links:`, spotifyLinks);
    ctx.waitUntil(processSpotifyLinks(spotifyLinks, message, env));
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Error", { status: 500 });
  }
}
__name(handleTelegramWebhook, "handleTelegramWebhook");
function extractSpotifyLinks(text) {
  const spotifyLinkRegex = /https?:\/\/open\.spotify\.com\/track\/([a-zA-Z0-9]+)(\?[^\s]*)?/g;
  const links = [];
  let match;
  while ((match = spotifyLinkRegex.exec(text)) !== null) {
    links.push({
      url: match[0],
      trackId: match[1]
    });
  }
  return links;
}
__name(extractSpotifyLinks, "extractSpotifyLinks");
async function processSpotifyLinks(spotifyLinks, message, env) {
  try {
    const tokenManager = new SpotifyTokenManager(env);
    const spotifyAPI = new SpotifyAPI(tokenManager);
    const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
    const trackUris = spotifyLinks.map((link) => `spotify:track:${link.trackId}`);
    const accessToken = await tokenManager.getAccessToken();
    await spotifyAPI.addTracksToPlaylist(trackUris, accessToken, env);
    console.log(`Added ${trackUris.length} tracks to playlist`);
    for (const link of spotifyLinks) {
      try {
        const trackInfo = await spotifyAPI.getTrackInfo(link.trackId, accessToken);
        if (trackInfo) {
          await telegramBot.sendTrackInfo(trackInfo, message);
          console.log(`Sent track info for: ${trackInfo.name}`);
        }
      } catch (error) {
        console.error(`Error processing track ${link.trackId}:`, error);
      }
    }
  } catch (error) {
    console.error("Error processing Spotify links:", error);
    if (env.TELEGRAM_ERROR_CHANNEL) {
      try {
        const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
        await telegramBot.sendMessage(env.TELEGRAM_ERROR_CHANNEL, `Error processing Spotify links: ${error.message}`);
      } catch (telegramError) {
        console.error("Failed to send error to Telegram:", telegramError);
      }
    }
  }
}
__name(processSpotifyLinks, "processSpotifyLinks");

// ../../../.npm/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../.npm/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-xFvP9n/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../.npm/lib/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-xFvP9n/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
