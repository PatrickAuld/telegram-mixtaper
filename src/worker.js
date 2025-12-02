/**
 * Telegram Mixtaper - Cloudflare Workers Implementation
 * Monitors Telegram channels for Spotify links and adds them to playlists
 */

import { SpotifyTokenManager } from './spotify-token-manager.js';
import { TelegramBot } from './telegram-bot.js';
import { SpotifyAPI } from './spotify-api.js';

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      
      // Health check endpoint
      if (request.method === 'GET' && url.pathname === '/') {
        return new Response(JSON.stringify({
          status: 'ok',
          message: 'Telegram Mixtaper Bot is running',
          timestamp: new Date().toISOString()
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Telegram webhook endpoint
      if (request.method === 'POST' && url.pathname === '/webhook') {
        return await handleTelegramWebhook(request, env, ctx);
      }
      
      // 404 for all other routes
      return new Response('Not Found', { status: 404 });
      
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
};

/**
 * Handle incoming Telegram webhook
 */
async function handleTelegramWebhook(request, env, ctx) {
  try {
    const update = await request.json();
    console.log('Received Telegram update:', JSON.stringify(update));

    // Only process messages with text
    if (!update.message || !update.message.text) {
      return new Response('OK', { status: 200 });
    }

    const message = update.message;
    const text = message.text;

    // Check for /setplaylist command
    if (text.startsWith('/setplaylist')) {
      ctx.waitUntil(handleSetPlaylistCommand(message, env));
      return new Response('OK', { status: 200 });
    }

    const spotifyLinks = extractSpotifyLinks(text);

    if (spotifyLinks.length === 0) {
      return new Response('OK', { status: 200 });
    }

    console.log(`Found ${spotifyLinks.length} Spotify links:`, spotifyLinks);

    // Process Spotify links
    ctx.waitUntil(processSpotifyLinks(spotifyLinks, message, env));

    return new Response('OK', { status: 200 });

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Error', { status: 500 });
  }
}

/**
 * Extract Spotify URLs from text (tracks, albums, playlists)
 * Supports both open.spotify.com and spotify.link short URLs
 */
function extractSpotifyLinks(text) {
  const spotifyLinkRegex = /https?:\/\/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)(\?[^\s]*)?/g;
  const spotifyShortLinkRegex = /https?:\/\/spotify\.link\/([a-zA-Z0-9]+)/g;
  const links = [];
  let match;

  // Extract regular open.spotify.com links
  while ((match = spotifyLinkRegex.exec(text)) !== null) {
    links.push({
      url: match[0],
      type: match[1], // 'track', 'album', or 'playlist'
      id: match[2],
      isShortLink: false
    });
  }

  // Extract spotify.link short links
  while ((match = spotifyShortLinkRegex.exec(text)) !== null) {
    links.push({
      url: match[0],
      shortId: match[1],
      isShortLink: true
    });
  }

  return links;
}

/**
 * Extract Spotify playlist ID from URL or return ID if already in ID format
 */
function extractPlaylistId(input) {
  if (!input) return null;

  // Check if it's already a playlist ID (22 alphanumeric characters)
  if (/^[a-zA-Z0-9]{22}$/.test(input.trim())) {
    return input.trim();
  }

  // Try to extract from Spotify URL
  const playlistRegex = /(?:open\.spotify\.com\/playlist\/|spotify:playlist:)([a-zA-Z0-9]{22})/;
  const match = input.match(playlistRegex);

  return match ? match[1] : null;
}

/**
 * Check if user is an admin in the channel/group
 */
async function isUserAdmin(chatId, userId, botToken) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        user_id: userId
      })
    });

    if (!response.ok) {
      console.error(`Failed to check admin status: ${response.status}`);
      return false;
    }

    const data = await response.json();
    const status = data.result?.status;

    // Admin statuses: creator, administrator
    return status === 'creator' || status === 'administrator';
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

/**
 * Handle /setplaylist command
 */
async function handleSetPlaylistCommand(message, env) {
  const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text;

  try {
    // Extract playlist URL/ID from command
    // Format: /setplaylist <URL or ID>
    const parts = text.split(/\s+/);

    if (parts.length < 2) {
      await telegramBot.sendMessage(
        chatId,
        '❌ Please provide a Spotify playlist URL or ID.\n\n' +
        'Usage: /setplaylist <playlist_url>\n' +
        'Example: /setplaylist https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
        { reply_to_message_id: message.message_id }
      );
      return;
    }

    const playlistInput = parts.slice(1).join(' ').trim();
    const playlistId = extractPlaylistId(playlistInput);

    if (!playlistId) {
      await telegramBot.sendMessage(
        chatId,
        '❌ Invalid Spotify playlist URL or ID.\n\n' +
        'Please provide a valid Spotify playlist URL or a 22-character playlist ID.',
        { reply_to_message_id: message.message_id }
      );
      return;
    }

    // Verify playlist exists by fetching its info
    const tokenManager = new SpotifyTokenManager(env);
    const spotifyAPI = new SpotifyAPI(tokenManager);
    const accessToken = await tokenManager.getAccessToken();
    const playlistInfo = await spotifyAPI.getPlaylistInfo(playlistId, accessToken);

    if (!playlistInfo) {
      await telegramBot.sendMessage(
        chatId,
        '❌ Could not find the specified playlist. Please check the URL/ID and try again.',
        { reply_to_message_id: message.message_id }
      );
      return;
    }

    // Store channel-playlist mapping in KV
    const channelKey = `channel:${chatId}`;
    await env.CHANNEL_PLAYLISTS.put(channelKey, playlistId);

    console.log(`Set playlist ${playlistId} for channel ${chatId}`);

    // Send confirmation
    await telegramBot.sendMessage(
      chatId,
      `✅ Playlist set successfully!\n\n` +
      `📃 <b>${playlistInfo.name}</b>\n` +
      `🎵 ${playlistInfo.tracks.total} tracks\n\n` +
      `All Spotify track links in this ${message.chat.type} will now be added to this playlist.`,
      { reply_to_message_id: message.message_id }
    );

  } catch (error) {
    console.error('Error handling /setplaylist command:', error);
    await telegramBot.sendMessage(
      chatId,
      '❌ An error occurred while setting the playlist. Please try again later.',
      { reply_to_message_id: message.message_id }
    );
  }
}

/**
 * Resolve Spotify short link to full URL
 * Follows redirect from spotify.link to open.spotify.com
 */
async function resolveSpotifyShortLink(shortUrl) {
  try {
    const response = await fetch(shortUrl, {
      method: 'HEAD',
      redirect: 'manual' // Don't follow redirects automatically
    });

    const location = response.headers.get('location');
    if (location) {
      // Parse the redirected URL to extract type and ID
      const match = location.match(/https?:\/\/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/);
      if (match) {
        return {
          url: match[0],
          type: match[1],
          id: match[2],
          isShortLink: false
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
 * Get playlist ID for a channel (channel-specific or default)
 */
async function getPlaylistIdForChannel(chatId, env) {
  try {
    // Try to get channel-specific playlist from KV
    const channelKey = `channel:${chatId}`;
    const channelPlaylistId = await env.CHANNEL_PLAYLISTS.get(channelKey);

    if (channelPlaylistId) {
      console.log(`Using channel-specific playlist: ${channelPlaylistId} for channel ${chatId}`);
      return channelPlaylistId;
    }

    // Fall back to default playlist
    console.log(`Using default playlist: ${env.SPOTIFY_PLAYLIST_ID} for channel ${chatId}`);
    return env.SPOTIFY_PLAYLIST_ID;
  } catch (error) {
    console.error('Error getting playlist for channel:', error);
    // Fall back to default on error
    return env.SPOTIFY_PLAYLIST_ID;
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
    const accessToken = await tokenManager.getAccessToken();

    // Resolve short links to full URLs
    const resolvedLinks = [];
    for (const link of spotifyLinks) {
      if (link.isShortLink) {
        console.log(`Resolving short link: ${link.url}`);
        const resolved = await resolveSpotifyShortLink(link.url);
        if (resolved) {
          resolvedLinks.push(resolved);
          console.log(`Resolved to: ${resolved.type}/${resolved.id}`);
        } else {
          console.error(`Failed to resolve short link: ${link.url}`);
        }
      } else {
        resolvedLinks.push(link);
      }
    }

    if (resolvedLinks.length === 0) {
      console.log('No valid Spotify links to process after resolution');
      return;
    }

    // Separate tracks for playlist addition
    const trackLinks = resolvedLinks.filter(link => link.type === 'track');

    // Add tracks to playlist if any exist
    if (trackLinks.length > 0) {
      // Get playlist ID for this channel
      const playlistId = await getPlaylistIdForChannel(message.chat.id, env);

      const trackUris = trackLinks.map(link => `spotify:track:${link.id}`);
      await spotifyAPI.addTracksToPlaylist(trackUris, accessToken, playlistId);
      console.log(`Added ${trackUris.length} tracks to playlist ${playlistId}`);
    }
    
    // Send info for each Spotify item (tracks, albums, playlists) - only if echo is enabled
    const echoEnabled = env.SPOTIFY_ECHO_ENABLED === 'true';

    if (echoEnabled) {
      for (const link of resolvedLinks) {
        try {
          let contentInfo;

          switch (link.type) {
            case 'track':
              contentInfo = await spotifyAPI.getTrackInfo(link.id, accessToken);
              break;
            case 'album':
              contentInfo = await spotifyAPI.getAlbumInfo(link.id, accessToken);
              break;
            case 'playlist':
              contentInfo = await spotifyAPI.getPlaylistInfo(link.id, accessToken);
              break;
          }

          if (contentInfo) {
            await telegramBot.sendSpotifyInfo(contentInfo, link.type, message);
            console.log(`Sent ${link.type} info for: ${contentInfo.name}`);
          }
        } catch (error) {
          console.error(`Error processing ${link.type} ${link.id}:`, error);
        }
      }
    } else {
      console.log(`Skipped sending Spotify info (SPOTIFY_ECHO_ENABLED=${env.SPOTIFY_ECHO_ENABLED})`);
    }
    
  } catch (error) {
    console.error('Error processing Spotify links:', error);
    
    // Send error to Telegram if error channel is configured
    if (env.TELEGRAM_ERROR_CHANNEL) {
      try {
        const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
        await telegramBot.sendMessage(env.TELEGRAM_ERROR_CHANNEL, `Error processing Spotify links: ${error.message}`);
      } catch (telegramError) {
        console.error('Failed to send error to Telegram:', telegramError);
      }
    }
  }
}