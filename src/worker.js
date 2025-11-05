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

      // OAuth authorize endpoint (redirect to Spotify)
      if (request.method === 'GET' && url.pathname === '/oauth/authorize') {
        return await handleOAuthAuthorize(request, env);
      }

      // OAuth callback endpoint (handle Spotify redirect)
      if (request.method === 'GET' && url.pathname === '/oauth/callback') {
        return await handleOAuthCallback(request, env);
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
    if (text.startsWith('/')) {
      ctx.waitUntil(handleSlashCommand(message, env));
      return new Response('OK', { status: 200 });
    }

    // Check for Spotify links
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
 * Process Spotify links - add tracks to playlist and send content info
 */
async function processSpotifyLinks(spotifyLinks, message, env) {
  try {
    const tokenManager = new SpotifyTokenManager(env);
    const spotifyAPI = new SpotifyAPI(tokenManager);
    const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);

    // Get user's Telegram ID
    const telegramUserId = message.from?.id?.toString();

    // Try to get user's access token, fall back to bot token if user not connected
    const accessToken = await tokenManager.getAccessToken(telegramUserId);

    // Get user token data to check if user is connected
    const userTokenData = telegramUserId ? await tokenManager.getUserTokenData(telegramUserId) : null;

    // Separate tracks for playlist addition
    const trackLinks = spotifyLinks.filter(link => link.type === 'track');

    // Add tracks to playlist if any exist
    if (trackLinks.length > 0) {
      const trackUris = trackLinks.map(link => `spotify:track:${link.id}`);

      // If user has their own tokens, add to their default playlist (or create one)
      // For now, we'll use the bot's playlist but with user's credentials for attribution
      await spotifyAPI.addTracksToPlaylist(trackUris, accessToken, env, userTokenData?.spotify_user_id);

      const attribution = userTokenData ? `by ${userTokenData.spotify_user_id}` : 'by bot';
      console.log(`Added ${trackUris.length} tracks to playlist ${attribution}`);
    }

    // Send info for each Spotify item (tracks, albums, playlists) - only if echo is enabled
    const echoEnabled = env.SPOTIFY_ECHO_ENABLED === 'true';

    if (echoEnabled) {
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
            await telegramBot.sendSpotifyInfo(contentInfo, link.type, message);
            console.log(`Sent ${link.type} info for: ${contentInfo.name}`);
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

/**
 * Handle slash commands from Telegram
 */
async function handleSlashCommand(message, env) {
  try {
    const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
    const tokenManager = new SpotifyTokenManager(env);
    const chatId = message.chat.id;
    const userId = message.from.id.toString();
    const text = message.text.trim();

    // Parse command and arguments
    const parts = text.split(' ');
    const command = parts[0].toLowerCase().split('@')[0]; // Remove bot username if present

    switch (command) {
      case '/connect':
      case '/start':
        await handleConnectCommand(chatId, userId, env, telegramBot, tokenManager);
        break;

      case '/status':
        await handleStatusCommand(chatId, userId, env, telegramBot, tokenManager);
        break;

      case '/disconnect':
        await handleDisconnectCommand(chatId, userId, env, telegramBot, tokenManager);
        break;

      case '/help':
        await handleHelpCommand(chatId, telegramBot);
        break;

      default:
        // Ignore unknown commands
        console.log(`Unknown command: ${command}`);
    }

  } catch (error) {
    console.error('Error handling slash command:', error);
  }
}

/**
 * Handle /connect command - start OAuth flow
 */
async function handleConnectCommand(chatId, userId, env, telegramBot, tokenManager) {
  try {
    // Check if user is already connected
    const existingToken = await tokenManager.getUserTokenData(userId);
    if (existingToken) {
      await telegramBot.sendMessage(chatId,
        `✅ You're already connected to Spotify as <b>${existingToken.spotify_user_id}</b>!\n\n` +
        `Use /disconnect to unlink your account, or /status to see details.`
      );
      return;
    }

    // Generate random state for CSRF protection
    const state = generateRandomState();

    // Store state in KV
    await tokenManager.storeOAuthState(state, userId, chatId.toString());

    // Build authorization URL
    const workerUrl = env.WORKER_URL || 'https://telegram-mixtaper.patrick-auld.workers.dev';
    const redirectUri = `${workerUrl}/oauth/callback`;

    const scopes = [
      'playlist-modify-public',
      'playlist-modify-private',
      'user-read-private',
      'user-read-email'
    ].join(' ');

    const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
      client_id: env.SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes,
      state: state,
      show_dialog: 'true'
    });

    await telegramBot.sendMessage(chatId,
      `🎵 <b>Connect Your Spotify Account</b>\n\n` +
      `Click the link below to authorize this bot to add songs to playlists on your behalf:\n\n` +
      `<a href="${authUrl}">Connect to Spotify</a>\n\n` +
      `This will allow songs you share to be attributed to your Spotify account!`
    );

  } catch (error) {
    console.error('Error in connect command:', error);
    await telegramBot.sendMessage(chatId,
      `❌ Error starting connection process. Please try again later.`
    );
  }
}

/**
 * Handle /status command - show connection status
 */
async function handleStatusCommand(chatId, userId, env, telegramBot, tokenManager) {
  try {
    const tokenData = await tokenManager.getUserTokenData(userId);

    if (!tokenData) {
      await telegramBot.sendMessage(chatId,
        `❌ <b>Not Connected</b>\n\n` +
        `You haven't connected your Spotify account yet.\n\n` +
        `Use /connect to link your Spotify account and get credit for the songs you share!`
      );
      return;
    }

    const connectedDate = new Date(tokenData.created_at).toLocaleDateString();
    const isExpired = tokenManager.isTokenExpired(tokenData);

    await telegramBot.sendMessage(chatId,
      `✅ <b>Connected to Spotify</b>\n\n` +
      `<b>Account:</b> ${tokenData.spotify_user_id}\n` +
      `<b>Connected:</b> ${connectedDate}\n` +
      `<b>Status:</b> ${isExpired ? '⚠️ Token expired (will auto-refresh)' : '✅ Active'}\n\n` +
      `Songs you share will be added to playlists using your Spotify account!\n\n` +
      `Use /disconnect to unlink your account.`
    );

  } catch (error) {
    console.error('Error in status command:', error);
    await telegramBot.sendMessage(chatId,
      `❌ Error checking connection status. Please try again later.`
    );
  }
}

/**
 * Handle /disconnect command - remove user tokens
 */
async function handleDisconnectCommand(chatId, userId, env, telegramBot, tokenManager) {
  try {
    const tokenData = await tokenManager.getUserTokenData(userId);

    if (!tokenData) {
      await telegramBot.sendMessage(chatId,
        `ℹ️ You're not currently connected to Spotify.\n\n` +
        `Use /connect to link your account.`
      );
      return;
    }

    await tokenManager.deleteUserTokens(userId);

    await telegramBot.sendMessage(chatId,
      `✅ <b>Disconnected Successfully</b>\n\n` +
      `Your Spotify account (${tokenData.spotify_user_id}) has been unlinked.\n\n` +
      `You can reconnect anytime using /connect.`
    );

  } catch (error) {
    console.error('Error in disconnect command:', error);
    await telegramBot.sendMessage(chatId,
      `❌ Error disconnecting account. Please try again later.`
    );
  }
}

/**
 * Handle /help command
 */
async function handleHelpCommand(chatId, telegramBot) {
  await telegramBot.sendMessage(chatId,
    `🎵 <b>Telegram Mixtaper Bot</b>\n\n` +
    `I automatically add Spotify links to playlists!\n\n` +
    `<b>Commands:</b>\n` +
    `/connect - Link your Spotify account\n` +
    `/status - Check connection status\n` +
    `/disconnect - Unlink your Spotify account\n` +
    `/help - Show this help message\n\n` +
    `<b>How it works:</b>\n` +
    `1. Connect your Spotify account using /connect\n` +
    `2. Share Spotify track links in this chat\n` +
    `3. Songs are automatically added to the playlist using your account\n` +
    `4. You get credit for the tracks you share!\n\n` +
    `Just paste any Spotify track link and I'll handle the rest!`
  );
}

/**
 * Handle OAuth authorization redirect
 */
async function handleOAuthAuthorize(request, env) {
  try {
    const url = new URL(request.url);
    const state = url.searchParams.get('state');

    if (!state) {
      return new Response('Missing state parameter', { status: 400 });
    }

    // Build authorization URL
    const redirectUri = `${env.WORKER_URL || url.origin}/oauth/callback`;
    const scopes = [
      'playlist-modify-public',
      'playlist-modify-private',
      'user-read-private',
      'user-read-email'
    ].join(' ');

    const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
      client_id: env.SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes,
      state: state,
      show_dialog: 'true'
    });

    // Redirect to Spotify
    return Response.redirect(authUrl, 302);

  } catch (error) {
    console.error('Error in OAuth authorize:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * Handle OAuth callback from Spotify
 */
async function handleOAuthCallback(request, env) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    // Check for errors
    if (error) {
      return new Response(
        `<html><body><h1>Authorization Failed</h1><p>Error: ${error}</p></body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    if (!code || !state) {
      return new Response(
        `<html><body><h1>Invalid Request</h1><p>Missing code or state parameter</p></body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Verify state and get user info
    const tokenManager = new SpotifyTokenManager(env);
    const stateData = await tokenManager.getOAuthState(state);

    if (!stateData) {
      return new Response(
        `<html><body><h1>Invalid State</h1><p>State parameter is invalid or expired</p></body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Exchange code for tokens
    const redirectUri = `${env.WORKER_URL || url.origin}/oauth/callback`;
    const clientId = env.SPOTIFY_CLIENT_ID;
    const clientSecret = env.SPOTIFY_CLIENT_SECRET;
    const authHeader = btoa(`${clientId}:${clientSecret}`);

    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      return new Response(
        `<html><body><h1>Token Exchange Failed</h1><p>Could not get access token</p></body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    const tokens = await tokenResponse.json();

    // Get Spotify user profile
    const spotifyAPI = new SpotifyAPI(tokenManager);
    const userProfile = await spotifyAPI.getUserProfile(tokens.access_token);

    if (!userProfile) {
      return new Response(
        `<html><body><h1>Profile Fetch Failed</h1><p>Could not get Spotify profile</p></body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Store tokens
    await tokenManager.storeUserTokens(
      stateData.telegram_user_id,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in,
      userProfile.id
    );

    // Send success message to Telegram
    const telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
    await telegramBot.sendMessage(stateData.chat_id,
      `✅ <b>Successfully Connected!</b>\n\n` +
      `Your Spotify account (<b>${userProfile.display_name || userProfile.id}</b>) is now linked!\n\n` +
      `Songs you share will now be added to playlists using your account. You'll get credit for the tracks you share!`
    );

    // Return success page
    return new Response(
      `<html>
        <head>
          <title>Spotify Connected</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            h1 { color: #1DB954; }
          </style>
        </head>
        <body>
          <h1>✅ Successfully Connected!</h1>
          <p>Your Spotify account has been linked to the Telegram Mixtaper bot.</p>
          <p>You can close this window and return to Telegram.</p>
        </body>
      </html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );

  } catch (error) {
    console.error('Error in OAuth callback:', error);
    return new Response(
      `<html><body><h1>Error</h1><p>An error occurred: ${error.message}</p></body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

/**
 * Generate random state for OAuth CSRF protection
 */
function generateRandomState() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}