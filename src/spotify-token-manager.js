/**
 * Spotify Token Manager using Cloudflare KV Storage
 */

export class SpotifyTokenManager {
  constructor(env) {
    this.env = env;
    this.kv = env.SPOTIFY_TOKENS;
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  async getAccessToken() {
    try {
      // Try to get existing token from KV
      const tokenData = await this.kv.get('spotify_oauth', 'json');
      
      if (tokenData && !this.isTokenExpired(tokenData)) {
        console.log('Using existing valid token');
        return tokenData.access_token;
      }
      
      // Token is expired or doesn't exist, need to refresh
      const refreshToken = tokenData?.refresh_token || this.env.SPOTIFY_REFRESH_TOKEN;
      
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }
      
      console.log('Refreshing expired token');
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
   * Refresh the access token using the refresh token
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
      console.log('Stored refreshed token in KV');
      
      return tokens.access_token;
      
    } catch (error) {
      console.error('Error refreshing token:', error);
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