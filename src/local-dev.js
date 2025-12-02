#!/usr/bin/env node

/**
 * Local development server using Telegram polling instead of webhooks
 * This allows testing without exposing a public endpoint
 */

import { SpotifyTokenManager } from './spotify-token-manager.js';
import { TelegramBot } from './telegram-bot.js';
import { SpotifyAPI } from './spotify-api.js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class LocalDevBot {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.telegramBot = new TelegramBot(this.botToken);
    this.spotifyTokenManager = new SpotifyTokenManager(this.createMockEnv());
    this.spotifyAPI = new SpotifyAPI(this.spotifyTokenManager);
    this.isRunning = false;
    this.offset = 0;
  }

  createMockEnv() {
    // Create a mock environment object that mimics Cloudflare Workers env
    return {
      SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
      SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
      SPOTIFY_ACCESS_TOKEN: process.env.SPOTIFY_ACCESS_TOKEN,
      SPOTIFY_REFRESH_TOKEN: process.env.SPOTIFY_REFRESH_TOKEN,
      SPOTIFY_PLAYLIST_ID: process.env.SPOTIFY_PLAYLIST_ID,
      SPOTIFY_USER_ID: process.env.SPOTIFY_USER_ID,
      TELEGRAM_ERROR_CHANNEL: process.env.TELEGRAM_ERROR_CHANNEL,
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
      SPOTIFY_ECHO_ENABLED: process.env.SPOTIFY_ECHO_ENABLED,
      // Mock KV stores using local storage (in memory for dev)
      SPOTIFY_TOKENS: new MockKVStore(),
      CHANNEL_PLAYLISTS: new MockKVStore()
    };
  }

  /**
   * Extract Spotify URLs from text (tracks, albums, playlists)
   */
  extractSpotifyLinks(text) {
    const spotifyLinkRegex = /https?:\/\/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)(\?[^\s]*)?/g;
    const links = [];
    let match;

    while ((match = spotifyLinkRegex.exec(text)) !== null) {
      links.push({
        url: match[0],
        type: match[1], // 'track', 'album', or 'playlist'
        id: match[2]
      });
    }

    return links;
  }

  /**
   * Extract Spotify playlist ID from URL or return ID if already in ID format
   */
  extractPlaylistId(input) {
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
  async isUserAdmin(chatId, userId) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/getChatMember`, {
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
   * Get playlist ID for a channel (channel-specific or default)
   */
  async getPlaylistIdForChannel(chatId) {
    try {
      // Try to get channel-specific playlist from KV
      const channelKey = `channel:${chatId}`;
      const channelPlaylistId = await this.spotifyTokenManager.env.CHANNEL_PLAYLISTS.get(channelKey);

      if (channelPlaylistId) {
        console.log(`📝 Using channel-specific playlist: ${channelPlaylistId}`);
        return channelPlaylistId;
      }

      // Fall back to default playlist
      console.log(`📝 Using default playlist: ${this.spotifyTokenManager.env.SPOTIFY_PLAYLIST_ID}`);
      return this.spotifyTokenManager.env.SPOTIFY_PLAYLIST_ID;
    } catch (error) {
      console.error('Error getting playlist for channel:', error);
      // Fall back to default on error
      return this.spotifyTokenManager.env.SPOTIFY_PLAYLIST_ID;
    }
  }

  /**
   * Handle /setplaylist command
   */
  async handleSetPlaylistCommand(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text;

    try {
      // Extract playlist URL/ID from command
      const parts = text.split(/\s+/);

      if (parts.length < 2) {
        await this.telegramBot.sendMessage(
          chatId,
          '❌ Please provide a Spotify playlist URL or ID.\n\n' +
          'Usage: /setplaylist <playlist_url>\n' +
          'Example: /setplaylist https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
          { reply_to_message_id: message.message_id }
        );
        return;
      }

      const playlistInput = parts.slice(1).join(' ').trim();
      const playlistId = this.extractPlaylistId(playlistInput);

      if (!playlistId) {
        await this.telegramBot.sendMessage(
          chatId,
          '❌ Invalid Spotify playlist URL or ID.\n\n' +
          'Please provide a valid Spotify playlist URL or a 22-character playlist ID.',
          { reply_to_message_id: message.message_id }
        );
        return;
      }

      // Verify playlist exists by fetching its info
      const accessToken = await this.spotifyTokenManager.getAccessToken();
      const playlistInfo = await this.spotifyAPI.getPlaylistInfo(playlistId, accessToken);

      if (!playlistInfo) {
        await this.telegramBot.sendMessage(
          chatId,
          '❌ Could not find the specified playlist. Please check the URL/ID and try again.',
          { reply_to_message_id: message.message_id }
        );
        return;
      }

      // Store channel-playlist mapping in KV
      const channelKey = `channel:${chatId}`;
      await this.spotifyTokenManager.env.CHANNEL_PLAYLISTS.put(channelKey, playlistId);

      console.log(`✅ Set playlist ${playlistId} for channel ${chatId}`);

      // Send confirmation
      await this.telegramBot.sendMessage(
        chatId,
        `✅ Playlist set successfully!\n\n` +
        `📃 <b>${playlistInfo.name}</b>\n` +
        `🎵 ${playlistInfo.tracks.total} tracks\n\n` +
        `All Spotify track links in this ${message.chat.type} will now be added to this playlist.`,
        { reply_to_message_id: message.message_id }
      );

    } catch (error) {
      console.error('❌ Error handling /setplaylist command:', error);
      await this.telegramBot.sendMessage(
        chatId,
        '❌ An error occurred while setting the playlist. Please try again later.',
        { reply_to_message_id: message.message_id }
      );
    }
  }

  /**
   * Process Spotify links - add tracks to playlist and send content info
   */
  async processSpotifyLinks(spotifyLinks, message) {
    try {
      console.log(`Processing ${spotifyLinks.length} Spotify links...`);

      // Separate tracks for playlist addition
      const trackLinks = spotifyLinks.filter(link => link.type === 'track');

      // Add tracks to playlist if any exist
      if (trackLinks.length > 0) {
        // Get playlist ID for this channel
        const playlistId = await this.getPlaylistIdForChannel(message.chat.id);

        const trackUris = trackLinks.map(link => `spotify:track:${link.id}`);
        const accessToken = await this.spotifyTokenManager.getAccessToken();
        await this.spotifyAPI.addTracksToPlaylist(trackUris, accessToken, playlistId);
        console.log(`✅ Added ${trackUris.length} tracks to playlist ${playlistId}`);
      }

      // Send info for each Spotify item (tracks, albums, playlists) - only if echo is enabled
      const echoEnabled = this.spotifyTokenManager.env.SPOTIFY_ECHO_ENABLED === 'true';

      if (echoEnabled) {
        const accessToken = await this.spotifyTokenManager.getAccessToken();
        for (const link of spotifyLinks) {
          try {
            let contentInfo;

            switch (link.type) {
              case 'track':
                contentInfo = await this.spotifyAPI.getTrackInfo(link.id, accessToken);
                break;
              case 'album':
                contentInfo = await this.spotifyAPI.getAlbumInfo(link.id, accessToken);
                break;
              case 'playlist':
                contentInfo = await this.spotifyAPI.getPlaylistInfo(link.id, accessToken);
                break;
            }

            if (contentInfo) {
              await this.telegramBot.sendSpotifyInfo(contentInfo, link.type, message);
              console.log(`✅ Sent ${link.type} info for: ${contentInfo.name}`);
            }
          } catch (error) {
            console.error(`❌ Error processing ${link.type} ${link.id}:`, error.message);
          }
        }
      } else {
        console.log(`ℹ️  Skipped sending Spotify info (SPOTIFY_ECHO_ENABLED=${this.spotifyTokenManager.env.SPOTIFY_ECHO_ENABLED})`);
      }

    } catch (error) {
      console.error('❌ Error processing Spotify links:', error);

      // Send error to Telegram if error channel is configured
      if (process.env.TELEGRAM_ERROR_CHANNEL) {
        try {
          await this.telegramBot.sendErrorNotification(this.spotifyTokenManager.env, error, 'Processing Spotify links');
        } catch (telegramError) {
          console.error('❌ Failed to send error to Telegram:', telegramError.message);
        }
      }
    }
  }

  /**
   * Process a single Telegram update
   */
  async processUpdate(update) {
    try {
      console.log('📨 Received update:', update.update_id);

      // Only process messages with text
      if (!update.message || !update.message.text) {
        return;
      }

      const message = update.message;
      const text = message.text;

      // Check for /setplaylist command
      if (text.startsWith('/setplaylist')) {
        console.log('🔧 Processing /setplaylist command');
        await this.handleSetPlaylistCommand(message);
        return;
      }

      const spotifyLinks = this.extractSpotifyLinks(text);

      if (spotifyLinks.length === 0) {
        return;
      }

      console.log(`🎵 Found ${spotifyLinks.length} Spotify links:`, spotifyLinks.map(l => `${l.type}:${l.id}`));

      // Process Spotify links
      await this.processSpotifyLinks(spotifyLinks, message);

    } catch (error) {
      console.error('❌ Error processing update:', error);
    }
  }

  /**
   * Get updates from Telegram using long polling
   */
  async getUpdates() {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.offset}&timeout=30`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(`Telegram API error: ${data.description}`);
      }
      
      return data.result;
      
    } catch (error) {
      console.error('❌ Error getting updates:', error.message);
      return [];
    }
  }

  /**
   * Start the polling loop
   */
  async start() {
    console.log('🚀 Starting Telegram Mixtaper (Local Development Mode)');
    console.log('📡 Using polling mode instead of webhooks');
    
    // Verify bot token works
    try {
      const botInfo = await this.telegramBot.getMe();
      console.log(`✅ Connected as @${botInfo.result.username}`);
    } catch (error) {
      console.error('❌ Failed to connect to Telegram:', error.message);
      return;
    }

    this.isRunning = true;
    
    console.log('👂 Listening for messages with Spotify links...');
    console.log('   Press Ctrl+C to stop');

    while (this.isRunning) {
      try {
        const updates = await this.getUpdates();
        
        for (const update of updates) {
          await this.processUpdate(update);
          this.offset = update.update_id + 1;
        }
        
        // Small delay to prevent hammering the API
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error('❌ Polling error:', error.message);
        // Wait longer on errors to avoid spamming
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Stop the polling loop
   */
  stop() {
    console.log('\n🛑 Stopping bot...');
    this.isRunning = false;
  }
}

/**
 * Mock KV store for local development
 */
class MockKVStore {
  constructor() {
    this.data = new Map();
  }

  async get(key, type = 'text') {
    const value = this.data.get(key);
    if (value === undefined) {
      return null;
    }
    
    if (type === 'json') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    
    return value;
  }

  async put(key, value) {
    this.data.set(key, value);
  }

  async delete(key) {
    return this.data.delete(key);
  }

  async list() {
    return {
      keys: Array.from(this.data.keys()).map(name => ({ name }))
    };
  }
}

// Handle graceful shutdown
function setupGracefulShutdown(bot) {
  const shutdown = () => {
    bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const bot = new LocalDevBot();
  setupGracefulShutdown(bot);
  bot.start().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { LocalDevBot };