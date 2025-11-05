/**
 * Telegram Mixtaper - Cloudflare Workers Implementation
 * Monitors Telegram channels for Spotify links and adds them to playlists
 */

import { SpotifyTokenManager } from './spotify-token-manager.js';
import { TelegramBot } from './telegram-bot.js';
import { SpotifyAPI } from './spotify-api.js';
import { CommentManager } from './comment-manager.js';

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
    const text = message.text;

    // Check for slash commands
    if (text.startsWith('/addcomment')) {
      ctx.waitUntil(handleAddCommentCommand(message, env));
      return new Response('OK', { status: 200 });
    }

    const spotifyLinks = extractSpotifyLinks(text);

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
 * Extract Spotify URLs from text (tracks, albums, playlists)
 */
function extractSpotifyLinks(text) {
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
 * Check if a user is in the allowlist
 */
function isUserAllowlisted(userId, env) {
  if (!env.COMMENT_ALLOWLIST) {
    console.log('No COMMENT_ALLOWLIST configured');
    return false;
  }

  const allowlist = env.COMMENT_ALLOWLIST.split(',').map(id => id.trim());
  return allowlist.includes(String(userId));
}

/**
 * Handle /addcomment slash command
 */
async function handleAddCommentCommand(message, env) {
  try {
    const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
    const userId = message.from?.id;
    const chatId = message.chat.id;

    // Check if user is allowlisted
    if (!isUserAllowlisted(userId, env)) {
      console.log(`User ${userId} not allowlisted for adding comments`);
      await telegramBot.sendMessage(chatId, '❌ You are not authorized to add comments.', {
        reply_to_message_id: message.message_id
      });
      return;
    }

    // Parse command: /addcomment <comment text>
    const text = message.text;
    const commentText = text.replace('/addcomment', '').trim();

    if (!commentText) {
      await telegramBot.sendMessage(chatId, '❌ Please provide comment text.\n\nUsage: /addcomment <your comment>', {
        reply_to_message_id: message.message_id
      });
      return;
    }

    // Add comment to database
    const commentManager = new CommentManager(env);
    const comment = await commentManager.addComment(commentText, userId);

    // Get stats
    const stats = await commentManager.getStats();

    await telegramBot.sendMessage(
      chatId,
      `✅ Comment added successfully!\n\n` +
      `📝 Comment: "${commentText}"\n` +
      `🔢 ID: ${comment.id}\n\n` +
      `📊 Stats: ${stats.unused} unused, ${stats.used} used, ${stats.total} total`,
      { reply_to_message_id: message.message_id }
    );

    console.log(`Comment added by user ${userId}: ${comment.id}`);

  } catch (error) {
    console.error('Error handling /addcomment command:', error);

    try {
      const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
      await telegramBot.sendMessage(
        message.chat.id,
        `❌ Error adding comment: ${error.message}`,
        { reply_to_message_id: message.message_id }
      );
    } catch (sendError) {
      console.error('Failed to send error message:', sendError);
    }
  }
}

/**
 * Process Spotify links - add tracks to playlist and send content info
 */
async function processSpotifyLinks(spotifyLinks, message, env) {
  try {
    const tokenManager = new SpotifyTokenManager(env);
    const spotifyAPI = new SpotifyAPI(tokenManager);
    const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
    const accessToken = await tokenManager.getAccessToken();
    
    // Separate tracks for playlist addition
    const trackLinks = spotifyLinks.filter(link => link.type === 'track');
    
    // Add tracks to playlist if any exist
    if (trackLinks.length > 0) {
      const trackUris = trackLinks.map(link => `spotify:track:${link.id}`);
      await spotifyAPI.addTracksToPlaylist(trackUris, accessToken, env);
      console.log(`Added ${trackUris.length} tracks to playlist`);
    }
    
    // Send info for each Spotify item (tracks, albums, playlists) - only if echo is enabled
    const echoEnabled = env.SPOTIFY_ECHO_ENABLED === 'true';

    if (echoEnabled) {
      const commentManager = new CommentManager(env);
      const commentProbability = parseFloat(env.COMMENT_PROBABILITY) || 0.0;

      for (const link of spotifyLinks) {
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
            // Check if we should add a comment
            let commentText = null;
            if (commentManager.shouldAddComment(commentProbability)) {
              const comment = await commentManager.getAndUseComment();
              if (comment) {
                commentText = comment.text;
                console.log(`Using comment: ${comment.id}`);
              } else {
                console.log('No unused comments available');
              }
            }

            await telegramBot.sendSpotifyInfo(contentInfo, link.type, message, commentText);
            console.log(`Sent ${link.type} info for: ${contentInfo.name}${commentText ? ' (with comment)' : ''}`);
          }
        } catch (error) {
          console.error(`Error processing ${link.type} ${link.id}:`, error);
        }
      }
    } else {
      console.log(`Skipped sending Spotify info (SPOTIFY_ECHO_ENABLED=${env.SPOTIFY_ECHO_ENABLED})`);
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