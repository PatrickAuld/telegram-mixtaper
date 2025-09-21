/**
 * Spotify Web API wrapper for Cloudflare Workers
 */

export class SpotifyAPI {
  constructor(tokenManager) {
    this.tokenManager = tokenManager;
    this.baseURL = 'https://api.spotify.com/v1';
  }

  /**
   * Get track information from Spotify
   */
  async getTrackInfo(trackId, accessToken) {
    try {
      const response = await fetch(`${this.baseURL}/tracks/${trackId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Spotify API error: ${response.status} - ${response.statusText}`);
      }

      const track = await response.json();
      
      // Extract relevant information
      return {
        id: track.id,
        name: track.name,
        artists: track.artists.map(artist => artist.name),
        album: track.album.name,
        artwork_url: track.album.images && track.album.images.length > 0 
          ? track.album.images[0].url 
          : null,
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
        throw new Error('SPOTIFY_PLAYLIST_ID not configured');
      }

      // Add tracks to the beginning of the playlist
      const response = await fetch(`${this.baseURL}/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          uris: trackUris,
          position: 0  // Add to beginning of playlist
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
      console.error('Error adding tracks to playlist:', error);
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
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
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
      console.error('Error getting playlist info:', error);
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
        throw new Error('SPOTIFY_PLAYLIST_ID not configured');
      }

      // Get playlist tracks (first 50 items)
      const response = await fetch(`${this.baseURL}/playlists/${playlistId}/tracks?limit=50&fields=items(track(id))`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn(`Failed to check playlist tracks: ${response.status}`);
        return {}; // Return empty object if check fails, proceed with adding
      }

      const data = await response.json();
      const existingTrackIds = new Set(
        data.items
          .filter(item => item.track && item.track.id)
          .map(item => item.track.id)
      );

      // Return object indicating which tracks already exist
      const duplicates = {};
      trackIds.forEach(trackId => {
        duplicates[trackId] = existingTrackIds.has(trackId);
      });

      return duplicates;

    } catch (error) {
      console.error('Error checking tracks in playlist:', error);
      return {}; // Return empty object on error, proceed with adding
    }
  }

  /**
   * Get user's Spotify profile (for verification)
   */
  async getUserProfile(accessToken) {
    try {
      const response = await fetch(`${this.baseURL}/me`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
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
      console.error('Error getting user profile:', error);
      return null;
    }
  }
}