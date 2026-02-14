/**
 * Telegram Mixtaper - Cloudflare Workers Implementation
 * Monitors Telegram channels for Spotify links and adds them to playlists
 */

import { SpotifyTokenManager } from "./spotify-token-manager.js";
import { TelegramBot } from "./telegram-bot.js";
import { SpotifyAPI } from "./spotify-api.js";
import { extractYouTubeMusicLinks, getYouTubeMusicTrackInfo } from "./youtube-music.js";
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
  }
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

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Spotify linked</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        margin: 0;
        padding: 32px 16px;
        background: #0b0b0c;
        color: #f4f4f5;
      }
      .card {
        max-width: 560px;
        margin: 0 auto;
        background: #111114;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 1.5rem;
        line-height: 1.2;
      }
      p {
        margin: 0 0 16px;
        line-height: 1.5;
        color: rgba(244, 244, 245, 0.85);
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 999px;
        background: rgba(29, 185, 84, 0.12);
        border: 1px solid rgba(29, 185, 84, 0.35);
        margin: 12px 0 18px;
        font-weight: 600;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #1db954;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 10px;
      }
      a.btn {
        display: inline-block;
        text-decoration: none;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #f4f4f5;
      }
      a.btn:hover {
        background: rgba(255, 255, 255, 0.10);
      }
      .fine {
        font-size: 0.9rem;
        color: rgba(244, 244, 245, 0.65);
        margin-top: 16px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Spotify linked</h1>
      <div class="pill"><span class="dot"></span>Success</div>
      <p>
        You can close this tab and go back to Telegram.
      </p>
      <p class="fine">
        Tip: to unlink later, DM the bot and run <code>/unlink</code>.
      </p>
    </div>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Avoid caching OAuth results.
      "Cache-Control": "no-store",
    },
  });
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
function getAdminAllowlist(env) {
  const raw = String(env.ADMIN_TELEGRAM_USER_IDS ?? "").trim();
  const ids = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return new Set(ids);
}

function isoDay(d = new Date()) {
  // YYYY-MM-DD in UTC
  return d.toISOString().slice(0, 10);
}

function userDailyKey(telegramUserId, day) {
  return `metrics:user:${telegramUserId}:${day}`;
}

function userSummaryKey(telegramUserId) {
  return `metrics:user:${telegramUserId}:summary`;
}

function userLastLinksKey(telegramUserId) {
  return `metrics:user:${telegramUserId}:last_links`;
}

async function recordUserSubmissions({ env, telegramUserId, links }) {
  const kv = env.SPOTIFY_TOKENS;
  const day = isoDay();
  const now = new Date().toISOString();

  const spotifyCount = links.filter((l) => l.kind === "spotify").length;
  const youtubeCount = links.filter((l) => l.kind === "youtube").length;

  const dailyKey = userDailyKey(telegramUserId, day);
  const daily = (await kv.get(dailyKey, "json")) || {
    day,
    total: 0,
    spotify: 0,
    youtube: 0,
    updated_at: now,
  };

  daily.total += links.length;
  daily.spotify += spotifyCount;
  daily.youtube += youtubeCount;
  daily.updated_at = now;

  await kv.put(dailyKey, JSON.stringify(daily), { expirationTtl: 90 * 24 * 3600 });

  const summaryKey = userSummaryKey(telegramUserId);
  const summary = (await kv.get(summaryKey, "json")) || {
    total: 0,
    spotify: 0,
    youtube: 0,
    first_seen_at: now,
    updated_at: now,
  };

  summary.total += links.length;
  summary.spotify += spotifyCount;
  summary.youtube += youtubeCount;
  summary.updated_at = now;

  await kv.put(summaryKey, JSON.stringify(summary));

  const lastKey = userLastLinksKey(telegramUserId);
  const last = (await kv.get(lastKey, "json")) || { links: [] };

  const newEntries = links.map((l) => ({
    at: now,
    kind: l.kind,
    url: l.url,
  }));

  last.links = [...newEntries, ...(last.links || [])].slice(0, 20);

  await kv.put(lastKey, JSON.stringify(last), { expirationTtl: 90 * 24 * 3600 });
}

async function handleAdminLinkedCommand(message, env) {
  const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);

  const chatType = message.chat?.type;
  const fromId = message.from?.id;

  // DM only to avoid leaking user lists.
  if (chatType && chatType !== "private") {
    await telegramBot.sendMessage(
      message.chat.id,
      "This command only works in a direct message with the bot.",
      { reply_to_message_id: message.message_id },
    );
    return;
  }

  const allow = getAdminAllowlist(env);
  if (!fromId || !allow.has(String(fromId))) {
    // Silent ignore for unauthorized users.
    return;
  }

  const kv = env.SPOTIFY_TOKENS;
  const keys = [];
  let cursor = undefined;

  // Paginate in case the list grows.
  for (let page = 0; page < 20; page++) {
    const res = await kv.list({ prefix: "spotify_user_oauth:", cursor });
    for (const k of res.keys) {
      keys.push(k.name);
    }
    if (!res.list_complete) {
      cursor = res.cursor;
      continue;
    }
    break;
  }

  const ids = keys
    .map((k) => k.replace(/^spotify_user_oauth:/, ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const count = ids.length;
  const preview = ids.slice(0, 50);

  const lines = [
    `Linked Spotify users: ${count}`,
    "",
    ...preview.map((id) => `- ${id}`),
  ];

  if (count > preview.length) {
    lines.push("", `…and ${count - preview.length} more`);
  }

  await telegramBot.sendMessage(message.chat.id, lines.join("\n"), {
    reply_to_message_id: message.message_id,
  });
}

async function handleStatsCommand(message, rawText, env) {
  const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);

  const chatType = message.chat?.type;
  const fromId = message.from?.id;

  // DM only: stats are private.
  if (chatType && chatType !== "private") {
    await telegramBot.sendMessage(
      message.chat.id,
      "Stats are only available in a direct message with the bot.",
      { reply_to_message_id: message.message_id },
    );
    return;
  }

  const parts = rawText.split(/\s+/).filter(Boolean);
  const targetIdRaw = parts[1] ?? null;

  let targetId = fromId ? String(fromId) : null;
  if (targetIdRaw) {
    const allow = getAdminAllowlist(env);
    if (fromId && allow.has(String(fromId))) {
      targetId = targetIdRaw;
    } else {
      // Non-admins can only view their own stats.
      await telegramBot.sendMessage(
        message.chat.id,
        "You can only view your own stats.",
        { reply_to_message_id: message.message_id },
      );
      return;
    }
  }

  if (!targetId) {
    await telegramBot.sendMessage(message.chat.id, "Missing user id.", {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  const kv = env.SPOTIFY_TOKENS;
  const summary = await kv.get(userSummaryKey(targetId), "json");
  const last = await kv.get(userLastLinksKey(targetId), "json");

  const day = isoDay();
  const today = await kv.get(userDailyKey(targetId, day), "json");

  const total = summary?.total ?? 0;
  const spotify = summary?.spotify ?? 0;

  const todayTotal = today?.total ?? 0;
  const todaySpotify = today?.spotify ?? 0;

  const lines = [
    `Stats for ${targetId}`,
    "",
    `Today: ${todayTotal} (spotify ${todaySpotify})`,
    `All time: ${total} (spotify ${spotify})`,
  ];

  const links = (last?.links ?? []).slice(0, 10);
  if (links.length > 0) {
    lines.push("", "Recent:");
    for (const l of links) {
      lines.push(`- [${l.kind}] ${l.url}`);
    }
  }

  await telegramBot.sendMessage(message.chat.id, lines.join("\n"), {
    reply_to_message_id: message.message_id,
    disable_web_page_preview: true,
  });
}

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
    if (text === "/admin_linked") {
      ctx.waitUntil(handleAdminLinkedCommand(message, env));
      return new Response("OK", { status: 200 });
    }

    if (text.startsWith("/stats")) {
      ctx.waitUntil(handleStatsCommand(message, text, env));
      return new Response("OK", { status: 200 });
    }

    if (text === "/link" || text === "/linkspotify") {
      ctx.waitUntil(handleLinkCommand(message, env));
      return new Response("OK", { status: 200 });
    }

    if (text === "/unlink" || text === "/unlinkspotify") {
      ctx.waitUntil(handleUnlinkCommand(message, env));
      return new Response("OK", { status: 200 });
    }

    const spotifyLinks = extractSpotifyLinks(text);
    const ytLinks = extractYouTubeMusicLinks(text);

    if (spotifyLinks.length === 0 && ytLinks.length === 0) {
      return new Response("OK", { status: 200 });
    }

    if (spotifyLinks.length > 0) {
      console.log(`Found ${spotifyLinks.length} Spotify links:`, spotifyLinks);
    }

    if (ytLinks.length > 0) {
      console.log(`Found ${ytLinks.length} YouTube links:`, ytLinks);
    }

    // Process links
    ctx.waitUntil(processLinks({ spotifyLinks, ytLinks }, message, env));

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
 * Process Spotify + YouTube Music links.
 */
async function processLinks({ spotifyLinks, ytLinks }, message, env) {
  try {
    const tokenManager = new SpotifyTokenManager(env);
    const spotifyAPI = new SpotifyAPI(tokenManager);
    const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);

    const telegramUserId = message?.from?.id;

    // Record submission metrics (best effort).
    if (telegramUserId) {
      try {
        await recordUserSubmissions({
          env,
          telegramUserId: String(telegramUserId),
          links: spotifyLinks.map((l) => ({ kind: "spotify", url: l.url })),
        });
      } catch (e) {
        console.error("Failed to record submission metrics:", e);
      }
    }

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

    // Resolve Spotify short links
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

    // Convert YouTube Music links → Spotify tracks
    const ytTrackUris = [];
    for (const link of ytLinks) {
      const info = await getYouTubeMusicTrackInfo(link.url);
      if (!info) {
        console.error(`Could not extract track info from: ${link.url}`);
        continue;
      }

      const match = await spotifyAPI.searchTrack(
        { title: info.title, artist: info.artist },
        accessToken
      );

      if (!match) {
        console.log(`No Spotify match found for: ${info.artist ?? ''} ${info.title}`);
        continue;
      }

      ytTrackUris.push(match.uri);

      // Echo matched Spotify track
      if (echoEnabled) {
        try {
          const contentInfo = await spotifyAPI.getTrackInfo(match.id, accessToken);
          if (contentInfo) {
            await telegramBot.sendSpotifyInfo(contentInfo, "track", message);
          }
        } catch (e) {
          console.error("Error sending Spotify info for YT match:", e);
        }
      }
    }

    if (ytTrackUris.length > 0) {
      await spotifyAPI.addTracksToPlaylist(ytTrackUris, accessToken, env);
      console.log(`Added ${ytTrackUris.length} tracks from YouTube to playlist`);
    }

    // Echo for Spotify items (tracks/albums/playlists)
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
