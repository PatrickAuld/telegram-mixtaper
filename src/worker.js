/**
 * Telegram Mixtaper - Cloudflare Workers Implementation
 * Monitors Telegram channels for Spotify links and adds them to playlists
 */

import { SpotifyTokenManager } from './spotify-token-manager.js';
import { TelegramBot } from './telegram-bot.js';
import { SpotifyAPI } from './spotify-api.js';
import { extractYouTubeMusicLinks, getYouTubeMusicTrackInfo } from './youtube-music.js';

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Health check endpoint
      if (request.method === 'GET' && url.pathname === '/') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            message: 'Telegram Mixtaper Bot is running',
            timestamp: new Date().toISOString()
          }),
          {
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Telegram webhook endpoint
      if (request.method === 'POST' && url.pathname === '/webhook') {
        return await handleTelegramWebhook(request, env, ctx);
      }

      // 404 for all other routes
      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error.message
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }
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
    const spotifyLinks = extractSpotifyLinks(message.text);
    const ytLinks = extractYouTubeMusicLinks(message.text);

    if (spotifyLinks.length === 0 && ytLinks.length === 0) {
      return new Response('OK', { status: 200 });
    }

    if (spotifyLinks.length > 0) {
      console.log(`Found ${spotifyLinks.length} Spotify links:`, spotifyLinks);
    }

    if (ytLinks.length > 0) {
      console.log(`Found ${ytLinks.length} YouTube links:`, ytLinks);
    }

    // Process links
    ctx.waitUntil(processLinks({ spotifyLinks, ytLinks }, message, env));

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
      const match = location.match(
        /https?:\/\/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/
      );
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
 * Process Spotify + YouTube Music links.
 */
async function processLinks({ spotifyLinks, ytLinks }, message, env) {
  try {
    const tokenManager = new SpotifyTokenManager(env);
    const spotifyAPI = new SpotifyAPI(tokenManager);
    const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
    const accessToken = await tokenManager.getAccessToken();

    // Resolve Spotify short links
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

    // Add Spotify tracks
    const trackLinks = resolvedLinks.filter((link) => link.type === 'track');
    if (trackLinks.length > 0) {
      const trackUris = trackLinks.map((link) => `spotify:track:${link.id}`);
      await spotifyAPI.addTracksToPlaylist(trackUris, accessToken, env);
      console.log(`Added ${trackUris.length} Spotify tracks to playlist`);
    }

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
      const echoEnabled = env.SPOTIFY_ECHO_ENABLED === 'true';
      if (echoEnabled) {
        try {
          const contentInfo = await spotifyAPI.getTrackInfo(match.id, accessToken);
          if (contentInfo) {
            await telegramBot.sendSpotifyInfo(contentInfo, 'track', message);
          }
        } catch (e) {
          console.error('Error sending Spotify info for YT match:', e);
        }
      }
    }

    if (ytTrackUris.length > 0) {
      await spotifyAPI.addTracksToPlaylist(ytTrackUris, accessToken, env);
      console.log(`Added ${ytTrackUris.length} tracks from YouTube to playlist`);
    }

    // Echo for Spotify items (tracks/albums/playlists)
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
    }
  } catch (error) {
    console.error('Error processing links:', error);

    // Send error to Telegram if error channel is configured
    if (env.TELEGRAM_ERROR_CHANNEL) {
      try {
        const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
        await telegramBot.sendMessage(
          env.TELEGRAM_ERROR_CHANNEL,
          `Error processing links: ${error.message}`
        );
      } catch (telegramError) {
        console.error('Failed to send error to Telegram:', telegramError);
      }
    }
  }
}
