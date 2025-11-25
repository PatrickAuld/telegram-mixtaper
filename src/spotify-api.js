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
   * Get all track IDs from an album
   */
  async getAlbumTracks(albumId, accessToken) {
    try {
      const response = await fetch(`${this.baseURL}/albums/${albumId}/tracks?limit=50`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Spotify API error: ${response.status} - ${response.statusText}`);
      }

      const data = await response.json();
      const trackIds = data.items.map(track => track.id);

      // Handle pagination if album has more than 50 tracks
      let nextUrl = data.next;
      while (nextUrl) {
        const nextResponse = await fetch(nextUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!nextResponse.ok) break;

        const nextData = await nextResponse.json();
        trackIds.push(...nextData.items.map(track => track.id));
        nextUrl = nextData.next;
      }

      return trackIds;

    } catch (error) {
      console.error(`Error getting album tracks for ${albumId}:`, error);
      return [];
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