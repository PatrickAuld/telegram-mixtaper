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
   * Get album information from Spotify
   */
  async getAlbumInfo(albumId, accessToken) {
    try {
      const response = await fetch(`${this.baseURL}/albums/${albumId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Spotify API error: ${response.status} - ${response.statusText}`);
      }

      const album = await response.json();
      
      // Extract relevant information
      return {
        id: album.id,
        name: album.name,
        artists: album.artists.map(artist => artist.name),
        type: 'album',
        track_count: album.total_tracks,
        release_date: album.release_date,
        artwork_url: album.images && album.images.length > 0 
          ? album.images[0].url 
          : null,
        external_urls: album.external_urls,
        genres: album.genres || []
      };

    } catch (error) {
      console.error(`Error getting album info for ${albumId}:`, error);
      return null;
    }
  }

  /**
   * Get playlist information from Spotify
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
        throw new Error(`Spotify API error: ${response.status} - ${response.statusText}`);
      }

      const playlist = await response.json();
      
      // Extract relevant information
      return {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        type: 'playlist',
        owner: playlist.owner.display_name,
        track_count: playlist.tracks.total,
        public: playlist.public,
        collaborative: playlist.collaborative,
        artwork_url: playlist.images && playlist.images.length > 0 
          ? playlist.images[0].url 
          : null,
        external_urls: playlist.external_urls,
        followers: playlist.followers?.total || 0
      };

    } catch (error) {
      console.error(`Error getting playlist info for ${playlistId}:`, error);
      return null;
    }
  }

  /**
   * Add tracks to a Spotify playlist
   * @param {string[]} trackUris - Array of Spotify track URIs
   * @param {string} accessToken - User or bot access token
   * @param {object} env - Environment variables
   * @param {string} spotifyUserId - Optional Spotify user ID for logging attribution
   */
  async addTracksToPlaylist(trackUris, accessToken, env, spotifyUserId = null) {
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
      const attribution = spotifyUserId ? ` (added by ${spotifyUserId})` : '';
      console.log(`Successfully added ${trackUris.length} tracks to playlist${attribution}`);

      return result;

    } catch (error) {
      console.error('Error adding tracks to playlist:', error);
      throw error;
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