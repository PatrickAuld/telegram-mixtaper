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
    const spotifyLinks = extractSpotifyLinks(message.text);
    
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
 * Extract Spotify track URLs from text
 */
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

/**
 * Process Spotify links - add to playlist and send track info
 */
async function processSpotifyLinks(spotifyLinks, message, env) {
  try {
    const tokenManager = new SpotifyTokenManager(env);
    const spotifyAPI = new SpotifyAPI(tokenManager);
    const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
    
    // Get track URIs for playlist
    const trackUris = spotifyLinks.map(link => `spotify:track:${link.trackId}`);
    
    // Add tracks to playlist
    const accessToken = await tokenManager.getAccessToken();
    await spotifyAPI.addTracksToPlaylist(trackUris, accessToken, env);
    console.log(`Added ${trackUris.length} tracks to playlist`);
    
    // Send track info for each link
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