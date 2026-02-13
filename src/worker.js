/**
 * Telegram Mixtaper - Cloudflare Workers Implementation
 * Monitors Telegram channels for Spotify links and adds them to playlists
 */

import { SpotifyTokenManager } from "./spotify-token-manager.js";
import { TelegramBot } from "./telegram-bot.js";
import { SpotifyAPI } from "./spotify-api.js";
import {
  createStateToken,
  exchangeCodeForTokens,
  spotifyAuthorizeUrl,
  SPOTIFY_USER_SCOPES,
} from "./spotify-user-auth.js";

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Health check endpoint
      if (request.method === "GET" && url.pathname === "/") {
        return new Response(
          JSON.stringify({
            status: "ok",
            message: "Telegram Mixtaper Bot is running",
            timestamp: new Date().toISOString(),
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Spotify OAuth endpoints (per Telegram user)
      if (request.method === "GET" && url.pathname === "/spotify/link") {
        return await handleSpotifyLinkStart(request, env);
      }

      if (request.method === "GET" && url.pathname === "/spotify/callback") {
        return await handleSpotifyCallback(request, env);
      }

      // Telegram webhook endpoint
      if (request.method === "POST" && url.pathname === "/webhook") {
        return await handleTelegramWebhook(request, env, ctx);
      }

      // 404 for all other routes
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Worker error:", error);
      return new Response(
        JSON.stringify({
          error: "Internal Server Error",
          message: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
};

async function handleSpotifyLinkStart(request, env) {
  const url = new URL(request.url);
  const telegramUserId = url.searchParams.get("tg_user_id");
  const chatId = url.searchParams.get("chat_id");

  if (!telegramUserId || !chatId) {
    return new Response("Missing tg_user_id or chat_id", { status: 400 });
  }

  const baseUrl = env.PUBLIC_BASE_URL || url.origin;
  const redirectUri = `${baseUrl}/spotify/callback`;

  const tokenManager = new SpotifyTokenManager(env);
  const state = await createStateToken();

  await tokenManager.storeOAuthState(state, {
    telegramUserId,
    chatId,
  });

  const authUrl = spotifyAuthorizeUrl({
    clientId: env.SPOTIFY_CLIENT_ID,
    redirectUri,
    state,
    scopes: SPOTIFY_USER_SCOPES,
  });

  return Response.redirect(authUrl, 302);
}

async function handleSpotifyCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const tokenManager = new SpotifyTokenManager(env);
  const payload = await tokenManager.consumeOAuthState(state);

  if (!payload) {
    return new Response("Invalid or expired state", { status: 400 });
  }

  const baseUrl = env.PUBLIC_BASE_URL || url.origin;
  const redirectUri = `${baseUrl}/spotify/callback`;

  const tokens = await exchangeCodeForTokens({ env, code, redirectUri });

  await tokenManager.setTelegramUserTokens(payload.telegramUserId, tokens);

  // Notify the user back in Telegram.
  try {
    const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
    await telegramBot.sendMessage(
      payload.chatId,
      "✅ Spotify linked. Tracks you submit will be added by your account.",
    );
  } catch (e) {
    console.error("Failed to send Telegram confirmation:", e);
  }

  return new Response(
    "Spotify linked. You can close this tab and go back to Telegram.",
    { status: 200, headers: { "Content-Type": "text/plain" } },
  );
}

async function handleLinkCommand(message, env) {
  const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
  const chatId = message.chat.id;
  const chatType = message.chat?.type;
  const telegramUserId = message.from?.id;

  // Only allow linking via direct messages to avoid leaking the link/token flow
  // to groups/channels.
  if (chatType && chatType !== "private") {
    await telegramBot.sendMessage(
      chatId,
      "For safety, Spotify linking only works in a direct message with the bot. Please DM me and run /link there.",
      { reply_to_message_id: message.message_id },
    );
    return;
  }

  if (!telegramUserId) {
    await telegramBot.sendMessage(
      chatId,
      "Could not identify your Telegram user id.",
      { reply_to_message_id: message.message_id },
    );
    return;
  }

  const baseUrl = env.PUBLIC_BASE_URL;
  if (!baseUrl) {
    await telegramBot.sendMessage(
      chatId,
      "Linking is not configured (PUBLIC_BASE_URL missing).",
      { reply_to_message_id: message.message_id },
    );
    return;
  }

  const linkUrl = new URL("/spotify/link", baseUrl);
  linkUrl.searchParams.set("tg_user_id", String(telegramUserId));
  linkUrl.searchParams.set("chat_id", String(chatId));

  await telegramBot.sendMessage(
    chatId,
    `Link your Spotify account here: ${linkUrl.toString()}`,
    { reply_to_message_id: message.message_id },
  );
}

async function handleUnlinkCommand(message, env) {
  const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
  const chatId = message.chat.id;
  const telegramUserId = message.from?.id;

  if (!telegramUserId) {
    await telegramBot.sendMessage(
      chatId,
      "Could not identify your Telegram user id.",
      { reply_to_message_id: message.message_id },
    );
    return;
  }

  const tokenManager = new SpotifyTokenManager(env);
  await tokenManager.unlinkTelegramUser(String(telegramUserId));

  await telegramBot.sendMessage(
    chatId,
    "✅ Unlinked. The bot will use the default Spotify integration again.",
    { reply_to_message_id: message.message_id },
  );
}

/**
 * Handle incoming Telegram webhook
 */
async function handleTelegramWebhook(request, env, ctx) {
  try {
    const update = await request.json();
    console.log("Received Telegram update:", JSON.stringify(update));

    // Only process messages with text
    if (!update.message || !update.message.text) {
      return new Response("OK", { status: 200 });
    }

    const message = update.message;
    const text = message.text.trim();

    // Commands
    if (text === "/link" || text === "/linkspotify") {
      ctx.waitUntil(handleLinkCommand(message, env));
      return new Response("OK", { status: 200 });
    }

    if (text === "/unlink" || text === "/unlinkspotify") {
      ctx.waitUntil(handleUnlinkCommand(message, env));
      return new Response("OK", { status: 200 });
    }

    const spotifyLinks = extractSpotifyLinks(text);

    if (spotifyLinks.length === 0) {
      return new Response("OK", { status: 200 });
    }

    console.log(`Found ${spotifyLinks.length} Spotify links:`, spotifyLinks);

    // Process Spotify links
    ctx.waitUntil(processSpotifyLinks(spotifyLinks, message, env));

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Error", { status: 500 });
  }
}

/**
 * Extract Spotify URLs from text (tracks, albums, playlists)
 * Supports both open.spotify.com and spotify.link short URLs
 */
function extractSpotifyLinks(text) {
  const spotifyLinkRegex =
    /https?:\/\/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)(\?[^\s]*)?/g;
  const spotifyShortLinkRegex = /https?:\/\/spotify\.link\/([a-zA-Z0-9]+)/g;
  const links = [];
  let match;

  // Extract regular open.spotify.com links
  while ((match = spotifyLinkRegex.exec(text)) !== null) {
    links.push({
      url: match[0],
      type: match[1],
      id: match[2],
      isShortLink: false,
    });
  }

  // Extract spotify.link short links
  while ((match = spotifyShortLinkRegex.exec(text)) !== null) {
    links.push({
      url: match[0],
      shortId: match[1],
      isShortLink: true,
    });
  }

  return links;
}

/**
 * Resolve Spotify short link to full URL
 * Follows redirect from spotify.link to open.spotify.com
 */
async function resolveSpotifyShortLink(shortUrl) {
  try {
    const response = await fetch(shortUrl, {
      method: "HEAD",
      redirect: "manual",
    });

    const location = response.headers.get("location");
    if (location) {
      const match = location.match(
        /https?:\/\/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/,
      );
      if (match) {
        return {
          url: match[0],
          type: match[1],
          id: match[2],
          isShortLink: false,
        };
      }
    }

    console.error(`Failed to resolve short link: ${shortUrl}`);
    return null;
  } catch (error) {
    console.error(`Error resolving short link ${shortUrl}:`, error);
    return null;
  }
}

/**
 * Process Spotify links - add tracks to playlist and send content info
 */
async function processSpotifyLinks(spotifyLinks, message, env) {
  try {
    const tokenManager = new SpotifyTokenManager(env);
    const spotifyAPI = new SpotifyAPI(tokenManager);
    const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);

    const telegramUserId = message?.from?.id;
    let accessToken;

    if (telegramUserId) {
      try {
        accessToken = await tokenManager.getAccessTokenForTelegramUser(
          String(telegramUserId),
        );
      } catch {
        // Not linked.
      }
    }

    if (!accessToken) {
      accessToken = await tokenManager.getAccessToken();
    }

    // Resolve short links to full URLs
    const resolvedLinks = [];
    for (const link of spotifyLinks) {
      if (link.isShortLink) {
        console.log(`Resolving short link: ${link.url}`);
        const resolved = await resolveSpotifyShortLink(link.url);
        if (resolved) {
          resolvedLinks.push(resolved);
        }
      } else {
        resolvedLinks.push(link);
      }
    }

    if (resolvedLinks.length === 0) {
      return;
    }

    const trackLinks = resolvedLinks.filter((link) => link.type === "track");

    if (trackLinks.length > 0) {
      const trackUris = trackLinks.map((link) => `spotify:track:${link.id}`);
      await spotifyAPI.addTracksToPlaylist(trackUris, accessToken, env);
    }

    const echoEnabled = env.SPOTIFY_ECHO_ENABLED === "true";

    if (echoEnabled) {
      for (const link of resolvedLinks) {
        try {
          let contentInfo;

          switch (link.type) {
            case "track":
              contentInfo = await spotifyAPI.getTrackInfo(link.id, accessToken);
              break;
            case "album":
              contentInfo = await spotifyAPI.getAlbumInfo(link.id, accessToken);
              break;
            case "playlist":
              contentInfo = await spotifyAPI.getPlaylistInfo(
                link.id,
                accessToken,
              );
              break;
          }

          if (contentInfo) {
            await telegramBot.sendSpotifyInfo(contentInfo, link.type, message);
          }
        } catch (error) {
          console.error(`Error processing ${link.type} ${link.id}:`, error);
        }
      }
    }
  } catch (error) {
    console.error("Error processing Spotify links:", error);

    if (env.TELEGRAM_ERROR_CHANNEL) {
      try {
        const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
        await telegramBot.sendMessage(
          env.TELEGRAM_ERROR_CHANNEL,
          `Error processing Spotify links: ${error.message}`,
        );
      } catch (telegramError) {
        console.error("Failed to send error to Telegram:", telegramError);
      }
    }
  }
}
