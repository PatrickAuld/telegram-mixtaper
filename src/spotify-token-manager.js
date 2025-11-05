/**
 * Spotify Token Manager using Cloudflare KV Storage
 * Supports both bot-level tokens and per-user tokens
 */

export class SpotifyTokenManager {
  constructor(env) {
    this.env = env;
    this.kv = env.SPOTIFY_TOKENS;
  }

  /**
   * Get a valid access token for a specific user, refreshing if necessary
   * @param {string|null} telegramUserId - Telegram user ID, or null for bot's default token
   */
  async getAccessToken(telegramUserId = null) {
    // If user ID provided, try to get user's token
    if (telegramUserId) {
      try {
        const userToken = await this.getUserToken(telegramUserId);
        if (userToken) {
          return userToken;
        }
        console.log(`No token found for user ${telegramUserId}, falling back to bot token`);
      } catch (error) {
        console.error(`Error getting user token for ${telegramUserId}:`, error);
      }
    }

    // Fall back to bot's default token
    return await this.getBotAccessToken();
  }

  /**
   * Get bot's default access token (legacy behavior)
   */
  async getBotAccessToken() {
    try {
      // Try to get existing token from KV
      const tokenData = await this.kv.get('spotify_oauth', 'json');

      if (tokenData && !this.isTokenExpired(tokenData)) {
        console.log('Using existing valid bot token');
        return tokenData.access_token;
      }

      // Token is expired or doesn't exist, need to refresh
      const refreshToken = tokenData?.refresh_token || this.env.SPOTIFY_REFRESH_TOKEN;

      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      console.log('Refreshing expired bot token');
      return await this.refreshAccessToken(refreshToken);

    } catch (error) {
      console.error('Error getting access token:', error);

      // Fallback to environment variable token (for initial setup)
      if (this.env.SPOTIFY_ACCESS_TOKEN) {
        console.log('Falling back to environment token');
        return this.env.SPOTIFY_ACCESS_TOKEN;
      }

      throw new Error(`Failed to get access token: ${error.message}`);
    }
  }

  /**
   * Get a specific user's access token, refreshing if necessary
   * @param {string} telegramUserId - Telegram user ID
   * @returns {string|null} Access token or null if user not connected
   */
  async getUserToken(telegramUserId) {
    try {
      const key = `user_token:${telegramUserId}`;
      const tokenData = await this.kv.get(key, 'json');

      if (!tokenData) {
        return null;
      }

      // Check if token is expired
      if (!this.isTokenExpired(tokenData)) {
        console.log(`Using valid token for user ${telegramUserId}`);
        return tokenData.access_token;
      }

      // Token expired, refresh it
      console.log(`Refreshing expired token for user ${telegramUserId}`);
      const newAccessToken = await this.refreshUserToken(telegramUserId, tokenData.refresh_token);
      return newAccessToken;

    } catch (error) {
      console.error(`Error getting user token for ${telegramUserId}:`, error);
      return null;
    }
  }

  /**
   * Refresh the bot's access token using the refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      const clientId = this.env.SPOTIFY_CLIENT_ID;
      const clientSecret = this.env.SPOTIFY_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error('Spotify client credentials not configured');
      }

      // Prepare Basic Auth header
      const authHeader = btoa(`${clientId}:${clientSecret}`);

      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
      }

      const tokens = await response.json();

      // Calculate expiration time
      const expiresAt = Date.now() + (tokens.expires_in * 1000);

      // Store new tokens in KV
      const tokenData = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || refreshToken, // Use new refresh token if provided
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      };

      await this.kv.put('spotify_oauth', JSON.stringify(tokenData));
      console.log('Stored refreshed bot token in KV');

      return tokens.access_token;

    } catch (error) {
      console.error('Error refreshing token:', error);
      throw error;
    }
  }

  /**
   * Refresh a user's access token
   * @param {string} telegramUserId - Telegram user ID
   * @param {string} refreshToken - User's refresh token
   */
  async refreshUserToken(telegramUserId, refreshToken) {
    try {
      const clientId = this.env.SPOTIFY_CLIENT_ID;
      const clientSecret = this.env.SPOTIFY_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error('Spotify client credentials not configured');
      }

      const authHeader = btoa(`${clientId}:${clientSecret}`);

      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`User token refresh failed: ${response.status} - ${errorText}`);
      }

      const tokens = await response.json();

      // Calculate expiration time
      const expiresAt = Date.now() + (tokens.expires_in * 1000);

      // Update user's token in KV
      const key = `user_token:${telegramUserId}`;
      const existingData = await this.kv.get(key, 'json');

      const tokenData = {
        ...existingData,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || refreshToken,
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      };

      await this.kv.put(key, JSON.stringify(tokenData));
      console.log(`Stored refreshed token for user ${telegramUserId}`);

      return tokens.access_token;

    } catch (error) {
      console.error(`Error refreshing user token for ${telegramUserId}:`, error);
      throw error;
    }
  }

  /**
   * Store user tokens after OAuth
   * @param {string} telegramUserId - Telegram user ID
   * @param {string} accessToken - Spotify access token
   * @param {string} refreshToken - Spotify refresh token
   * @param {number} expiresIn - Token expiration time in seconds
   * @param {string} spotifyUserId - Spotify user ID
   */
  async storeUserTokens(telegramUserId, accessToken, refreshToken, expiresIn, spotifyUserId) {
    try {
      const key = `user_token:${telegramUserId}`;
      const expiresAt = Date.now() + (expiresIn * 1000);

      const tokenData = {
        telegram_user_id: telegramUserId,
        spotify_user_id: spotifyUserId,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      await this.kv.put(key, JSON.stringify(tokenData));
      console.log(`Stored tokens for user ${telegramUserId} (Spotify: ${spotifyUserId})`);

      return true;
    } catch (error) {
      console.error(`Error storing user tokens for ${telegramUserId}:`, error);
      throw error;
    }
  }

  /**
   * Get user token data (for status checks)
   * @param {string} telegramUserId - Telegram user ID
   */
  async getUserTokenData(telegramUserId) {
    try {
      const key = `user_token:${telegramUserId}`;
      const tokenData = await this.kv.get(key, 'json');
      return tokenData;
    } catch (error) {
      console.error(`Error getting user token data for ${telegramUserId}:`, error);
      return null;
    }
  }

  /**
   * Delete user tokens (for disconnect)
   * @param {string} telegramUserId - Telegram user ID
   */
  async deleteUserTokens(telegramUserId) {
    try {
      const key = `user_token:${telegramUserId}`;
      await this.kv.delete(key);
      console.log(`Deleted tokens for user ${telegramUserId}`);
      return true;
    } catch (error) {
      console.error(`Error deleting user tokens for ${telegramUserId}:`, error);
      throw error;
    }
  }

  /**
   * Store OAuth state for verification
   * @param {string} state - Random state string
   * @param {string} telegramUserId - Telegram user ID
   * @param {string} chatId - Telegram chat ID
   */
  async storeOAuthState(state, telegramUserId, chatId) {
    try {
      const key = `oauth_state:${state}`;
      const stateData = {
        telegram_user_id: telegramUserId,
        chat_id: chatId,
        created_at: new Date().toISOString()
      };

      // Store with 10 minute expiration
      await this.kv.put(key, JSON.stringify(stateData), { expirationTtl: 600 });
      console.log(`Stored OAuth state for user ${telegramUserId}`);
      return true;
    } catch (error) {
      console.error('Error storing OAuth state:', error);
      throw error;
    }
  }

  /**
   * Get and delete OAuth state (one-time use)
   * @param {string} state - State string from OAuth callback
   */
  async getOAuthState(state) {
    try {
      const key = `oauth_state:${state}`;
      const stateData = await this.kv.get(key, 'json');

      if (stateData) {
        // Delete after reading (one-time use)
        await this.kv.delete(key);
      }

      return stateData;
    } catch (error) {
      console.error('Error getting OAuth state:', error);
      return null;
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
    const bufferTime = 60 * 1000; // 60 seconds buffer
    
    return now >= (expiresAt - bufferTime);
  }

  /**
   * Initialize tokens in KV from environment variables (for first-time setup)
   */
  async initializeFromEnvironment() {
    try {
      const accessToken = this.env.SPOTIFY_ACCESS_TOKEN;
      const refreshToken = this.env.SPOTIFY_REFRESH_TOKEN;
      
      if (!accessToken || !refreshToken) {
        throw new Error('Environment tokens not found');
      }
      
      // Assume token expires in 1 hour if not specified
      const expiresAt = Date.now() + (3600 * 1000);
      
      const tokenData = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
        source: 'environment'
      };
      
      await this.kv.put('spotify_oauth', JSON.stringify(tokenData));
      console.log('Initialized tokens from environment variables');
      
      return accessToken;
      
    } catch (error) {
      console.error('Error initializing from environment:', error);
      throw error;
    }
  }

  /**
   * Get current token info (for debugging)
   */
  async getTokenInfo() {
    try {
      const tokenData = await this.kv.get('spotify_oauth', 'json');
      
      if (!tokenData) {
        return { status: 'no_token' };
      }
      
      return {
        status: this.isTokenExpired(tokenData) ? 'expired' : 'valid',
        expires_at: new Date(tokenData.expires_at).toISOString(),
        updated_at: tokenData.updated_at,
        has_refresh_token: !!tokenData.refresh_token
      };
      
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }
}