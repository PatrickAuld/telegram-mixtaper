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
      // Mock KV store using local storage (in memory for dev)
      SPOTIFY_TOKENS: new MockKVStore()
    };
  }

  /**
   * Extract Spotify track URLs from text
   */
  extractSpotifyLinks(text) {
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
  async processSpotifyLinks(spotifyLinks, message) {
    try {
      console.log(`Processing ${spotifyLinks.length} Spotify links...`);

      // Get track URIs for playlist
      const trackUris = spotifyLinks.map(link => `spotify:track:${link.trackId}`);
      
      // Add tracks to playlist
      const accessToken = await this.spotifyTokenManager.getAccessToken();
      await this.spotifyAPI.addTracksToPlaylist(trackUris, accessToken, this.spotifyTokenManager.env);
      console.log(`✅ Added ${trackUris.length} tracks to playlist`);
      
      // Send track info for each link
      for (const link of spotifyLinks) {
        try {
          const trackInfo = await this.spotifyAPI.getTrackInfo(link.trackId, accessToken);
          if (trackInfo) {
            await this.telegramBot.sendTrackInfo(trackInfo, message);
            console.log(`✅ Sent track info for: ${trackInfo.name}`);
          }
        } catch (error) {
          console.error(`❌ Error processing track ${link.trackId}:`, error.message);
        }
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
      const spotifyLinks = this.extractSpotifyLinks(message.text);
      
      if (spotifyLinks.length === 0) {
        return;
      }
      
      console.log(`🎵 Found ${spotifyLinks.length} Spotify links:`, spotifyLinks.map(l => l.trackId));
      
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