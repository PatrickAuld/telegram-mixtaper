/**
 * Telegram Bot API wrapper for Cloudflare Workers
 */

export class TelegramBot {
  constructor(botToken) {
    this.botToken = botToken;
    this.baseURL = `https://api.telegram.org/bot${botToken}`;
  }

  /**
   * Send a photo with caption (for track info with artwork)
   */
  async sendPhoto(chatId, photoUrl, caption, options = {}) {
    try {
      const payload = {
        chat_id: chatId,
        photo: photoUrl,
        caption: caption,
        parse_mode: 'HTML', // Using HTML for better formatting
        ...options
      };

      const response = await fetch(`${this.baseURL}/sendPhoto`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API error: ${response.status} - ${errorText}`);
      }

      return await response.json();

    } catch (error) {
      console.error('Error sending photo:', error);
      throw error;
    }
  }

  /**
   * Send a text message
   */
  async sendMessage(chatId, text, options = {}) {
    try {
      const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        ...options
      };

      const response = await fetch(`${this.baseURL}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API error: ${response.status} - ${errorText}`);
      }

      return await response.json();

    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  /**
   * Send track information as a reply to the original message
   */
  async sendTrackInfo(trackInfo, originalMessage) {
    try {
      const chatId = originalMessage.chat.id;
      const messageId = originalMessage.message_id;

      // Format track information
      const artists = trackInfo.artists.join(', ');
      const caption = `🎵 <b>${trackInfo.name}</b>\n👤 ${artists}\n💿 ${trackInfo.album}`;

      if (trackInfo.artwork_url) {
        // Send photo with track info as caption
        return await this.sendPhoto(chatId, trackInfo.artwork_url, caption, {
          reply_to_message_id: messageId
        });
      } else {
        // Send text message if no artwork available
        return await this.sendMessage(chatId, caption, {
          reply_to_message_id: messageId
        });
      }

    } catch (error) {
      console.error('Error sending track info:', error);
      
      // Fallback: try to send just text without photo
      try {
        const artists = trackInfo.artists.join(', ');
        const fallbackText = `🎵 ${trackInfo.name} - ${artists}`;
        
        return await this.sendMessage(originalMessage.chat.id, fallbackText, {
          reply_to_message_id: originalMessage.message_id
        });
      } catch (fallbackError) {
        console.error('Fallback message also failed:', fallbackError);
        throw error;
      }
    }
  }

  /**
   * Send Spotify content information (tracks, albums, playlists) as a reply to the original message
   */
  async sendSpotifyInfo(contentInfo, contentType, originalMessage, comment = null) {
    try {
      const chatId = originalMessage.chat.id;
      const messageId = originalMessage.message_id;

      let caption;

      switch (contentType) {
        case 'track':
          const artists = contentInfo.artists.join(', ');
          caption = `🎵 <b>${contentInfo.name}</b>\n👤 ${artists}\n💿 ${contentInfo.album}`;
          break;

        case 'album':
          const albumArtists = contentInfo.artists.join(', ');
          caption = `💿 <b>${contentInfo.name}</b>\n👤 ${albumArtists}\n📅 ${contentInfo.release_date}\n🎵 ${contentInfo.track_count} tracks`;
          break;

        case 'playlist':
          caption = `📃 <b>${contentInfo.name}</b>\n👤 by ${contentInfo.owner}\n🎵 ${contentInfo.track_count} tracks`;
          if (contentInfo.description) {
            // Truncate description if too long
            const desc = contentInfo.description.length > 100
              ? contentInfo.description.substring(0, 100) + '...'
              : contentInfo.description;
            caption += `\n📝 ${desc}`;
          }
          if (contentInfo.followers > 0) {
            caption += `\n👥 ${contentInfo.followers} followers`;
          }
          break;

        default:
          caption = `🎵 <b>${contentInfo.name}</b>`;
      }

      // Add comment if provided
      if (comment) {
        caption += `\n\n💬 ${comment}`;
      }

      if (contentInfo.artwork_url) {
        // Send photo with content info as caption
        return await this.sendPhoto(chatId, contentInfo.artwork_url, caption, {
          reply_to_message_id: messageId
        });
      } else {
        // Send text message if no artwork available
        return await this.sendMessage(chatId, caption, {
          reply_to_message_id: messageId
        });
      }

    } catch (error) {
      console.error(`Error sending ${contentType} info:`, error);

      // Fallback: try to send just text without photo
      try {
        const fallbackText = `🎵 ${contentInfo.name}`;

        return await this.sendMessage(originalMessage.chat.id, fallbackText, {
          reply_to_message_id: originalMessage.message_id
        });
      } catch (fallbackError) {
        console.error('Fallback message also failed:', fallbackError);
        throw error;
      }
    }
  }

  /**
   * Set webhook URL
   */
  async setWebhook(webhookUrl, options = {}) {
    try {
      const payload = {
        url: webhookUrl,
        ...options
      };

      const response = await fetch(`${this.baseURL}/setWebhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to set webhook: ${response.status} - ${errorText}`);
      }

      return await response.json();

    } catch (error) {
      console.error('Error setting webhook:', error);
      throw error;
    }
  }

  /**
   * Get webhook info
   */
  async getWebhookInfo() {
    try {
      const response = await fetch(`${this.baseURL}/getWebhookInfo`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get webhook info: ${response.status} - ${errorText}`);
      }

      return await response.json();

    } catch (error) {
      console.error('Error getting webhook info:', error);
      throw error;
    }
  }

  /**
   * Delete webhook
   */
  async deleteWebhook() {
    try {
      const response = await fetch(`${this.baseURL}/deleteWebhook`, {
        method: 'POST'
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete webhook: ${response.status} - ${errorText}`);
      }

      return await response.json();

    } catch (error) {
      console.error('Error deleting webhook:', error);
      throw error;
    }
  }

  /**
   * Get bot information
   */
  async getMe() {
    try {
      const response = await fetch(`${this.baseURL}/getMe`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get bot info: ${response.status} - ${errorText}`);
      }

      return await response.json();

    } catch (error) {
      console.error('Error getting bot info:', error);
      throw error;
    }
  }

  /**
   * Send formatted error message to error channel
   */
  async sendErrorNotification(env, error, context = '') {
    try {
      if (!env.TELEGRAM_ERROR_CHANNEL) {
        console.log('No error channel configured, skipping error notification');
        return;
      }

      const errorMessage = `🚨 <b>Bot Error</b>\n\n` +
        `<b>Context:</b> ${context}\n` +
        `<b>Error:</b> ${error.message}\n` +
        `<b>Time:</b> ${new Date().toISOString()}`;

      return await this.sendMessage(env.TELEGRAM_ERROR_CHANNEL, errorMessage);

    } catch (notificationError) {
      console.error('Failed to send error notification:', notificationError);
    }
  }

  /**
   * Send multiple track info messages for multiple Spotify links
   */
  async sendMultipleTrackInfo(trackInfoList, originalMessage) {
    const results = [];
    
    for (const trackInfo of trackInfoList) {
      try {
        const result = await this.sendTrackInfo(trackInfo, originalMessage);
        results.push({ success: true, result });
        
        // Small delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`Failed to send track info for ${trackInfo.name}:`, error);
        results.push({ success: false, error: error.message, trackInfo });
      }
    }
    
    return results;
  }

  /**
   * Validate that the message came from Telegram (optional security check)
   */
  validateMessage(message, secretToken = null) {
    // Basic validation - check required fields
    if (!message || typeof message !== 'object') {
      return false;
    }

    if (!message.message_id || !message.chat) {
      return false;
    }

    // If secret token is provided, validate it
    // Note: This would require additional header validation in the worker
    if (secretToken) {
      // Implementation would depend on Telegram's secret token validation
      // For now, we'll skip this advanced validation
    }

    return true;
  }
}