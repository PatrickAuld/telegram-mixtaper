# Telegram Mixtaper

A modern Telegram bot running on **Cloudflare Workers** that monitors channels for Spotify links and automatically adds them to a specified Spotify playlist. Perfect for collaborative music discovery in group chats!

## 🚀 **Now Running on Cloudflare Workers!**

The bot has been migrated from Python/Heroku to **Cloudflare Workers** for better performance, lower costs, and automatic scaling.

### Benefits of the Migration
- **🌍 Global Edge Network**: Runs closer to users worldwide  
- **⚡ Lightning Fast**: <1ms cold starts vs ~10s on Heroku
- **💰 Cost Effective**: 100K requests/day free vs $7/month minimum
- **🔧 Zero Maintenance**: No server management required
- **📈 Auto Scaling**: Handles traffic spikes seamlessly

## Architecture

This bot consists of four main JavaScript modules:

- **src/worker.js** - Main Workers entry point and webhook handler
- **src/spotify-token-manager.js** - OAuth2 token management with Cloudflare KV storage  
- **src/spotify-api.js** - Spotify Web API wrapper with comprehensive methods
- **src/telegram-bot.js** - Telegram Bot API wrapper with rich messaging

### Legacy Python Version
The original Python implementation is preserved in `legacy-python/` directory.

## How It Works

1. **Webhook Processing**: Cloudflare Workers receives Telegram webhooks
2. **Link Detection**: Uses regex to extract Spotify track links: `src/worker.js:84`
3. **OAuth Management**: Automatically refreshes tokens using KV storage
4. **Playlist Updates**: Adds tracks to beginning of Spotify playlists
5. **Track Info**: Posts artwork + metadata as replies to original messages

## Key Features

- **Real-time monitoring**: Processes all messages for Spotify links
- **Rich track info**: Posts artwork, title, artist, and album details
- **Automatic token refresh**: OAuth tokens managed transparently with KV storage
- **Reply-to functionality**: Bot replies to original messages with track info
- **Multiple links support**: Handles multiple Spotify links in single message
- **Error handling**: Comprehensive error handling and fallback mechanisms
- **Global deployment**: Runs on Cloudflare's edge network worldwide

## Environment Variables

### Telegram
- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather
- `TELEGRAM_ERROR_CHANNEL` - Channel ID for error notifications (optional)

### Spotify  
- `SPOTIFY_CLIENT_ID` - Spotify app client ID
- `SPOTIFY_CLIENT_SECRET` - Spotify app client secret
- `SPOTIFY_USER_ID` - Spotify username
- `SPOTIFY_PLAYLIST_ID` - Target playlist ID
- `SPOTIFY_ACCESS_TOKEN` - Initial access token
- `SPOTIFY_REFRESH_TOKEN` - Refresh token for token renewal

### Cloudflare
- `SPOTIFY_TOKENS` - KV namespace binding (configured in wrangler.toml)

## Development

### Two Development Modes

#### 1. Webhook Mode (Cloudflare Workers simulation)
```bash
# Install dependencies
npm install

# Start development server (simulates Workers environment)
npm run dev

# Test health check
curl http://localhost:8788/

# Test webhook with sample data
curl -X POST http://localhost:8788/webhook \
  -H "Content-Type: application/json" \
  -d '{"message":{"message_id":123,"chat":{"id":-123,"title":"Test"},"text":"https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"}}'
```

#### 2. Polling Mode (Real Telegram integration)
```bash
# Start bot with polling (no public endpoint needed)
npm run dev:polling

# The bot will connect to Telegram and listen for real messages
# Send Spotify links in any chat with the bot to test functionality
# Press Ctrl+C to stop
```

**Polling Mode Benefits:**
- ✅ Works with real Telegram messages (no need to simulate)
- ✅ No public endpoint required (works behind firewalls)
- ✅ Perfect for testing actual bot behavior
- ✅ Automatic OAuth token refresh using in-memory storage
- ✅ Full Spotify playlist integration

### OAuth Token Generation

Generate Spotify OAuth tokens using the JavaScript version:

```bash
# Generate OAuth tokens (JavaScript version)
npm run oauth

# Legacy Python version (if needed)
python get_oauth_tokens.py
```

The JavaScript version (`get-oauth-tokens.js`) provides the same functionality as the Python script but with better integration into the Node.js development workflow.

### Dependencies
Updated dependencies from `package.json`:
- `wrangler` - Cloudflare Workers CLI and development tools
- `dotenv` - Environment variable loading for development
- `open` - Cross-platform browser opening for OAuth flow

### Environment Setup
1. Copy `.env.template` to `.env` and fill in your credentials
2. For production: Configure secrets with `wrangler secret put <NAME>`
3. Update KV namespace IDs in `wrangler.toml`

### Testing
- **Production**: Uses Cloudflare Workers runtime with KV storage
- **Local Development**: Two modes available - webhook simulation or polling
- **Health Check**: GET `/` endpoint returns bot status and timestamp

## Deployment

### Prerequisites
1. Cloudflare account with Workers plan
2. Wrangler CLI: `npm install -g wrangler`
3. KV namespace created: `wrangler kv:namespace create "SPOTIFY_TOKENS"`

### Steps
```bash
# Login to Cloudflare
wrangler login

# Create KV namespace
wrangler kv:namespace create "SPOTIFY_TOKENS"
# Update wrangler.toml with the returned namespace ID

# Set secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put SPOTIFY_CLIENT_ID  
wrangler secret put SPOTIFY_CLIENT_SECRET
wrangler secret put SPOTIFY_ACCESS_TOKEN
wrangler secret put SPOTIFY_REFRESH_TOKEN

# Deploy
npm run deploy
```

### Telegram Webhook Setup
```bash
# Set webhook URL to your Workers deployment
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://telegram-mixtaper.<your-subdomain>.workers.dev/webhook"
```

## Code Structure

### Worker Entry Point (`src/worker.js:10-44`)
- Health check endpoint: `GET /`
- Webhook handler: `POST /webhook`
- Spotify link extraction and processing

### Token Management (`src/spotify-token-manager.js`)
- `getAccessToken()` - Get valid token, refresh if needed
- `refreshAccessToken()` - Handle OAuth token refresh
- `isTokenExpired()` - Check token expiration with buffer
- KV storage integration for persistence

### Spotify Integration (`src/spotify-api.js`)
- `getTrackInfo()` - Retrieve track metadata and artwork
- `addTracksToPlaylist()` - Add tracks to playlist
- `checkTracksInPlaylist()` - Avoid duplicates
- Comprehensive error handling

### Telegram Integration (`src/telegram-bot.js`)
- `sendTrackInfo()` - Post track info with artwork
- `sendPhoto()` - Send photos with captions
- `sendMessage()` - Send text messages
- Reply-to-message functionality

## Common Tasks

### Adding the Bot to a Channel
1. Add bot to Telegram channel as admin with "Post Messages" permission
2. Bot automatically monitors all messages for Spotify links
3. Links are processed and tracks added to playlist immediately
4. Bot replies with track information including artwork

### Monitoring
- Check Cloudflare Workers dashboard for metrics and logs
- Errors sent to designated error channel (if configured)
- Real-time request/response monitoring available

### Troubleshooting
- **Token issues**: KV storage automatically handles token refresh
- **Permission errors**: Ensure bot has admin rights in target channels  
- **Playlist errors**: Verify playlist ID and user permissions in Spotify app
- **Rate limiting**: Built-in delays between multiple track posts

## Cost Analysis

### Cloudflare Workers
- **Free Tier**: 100,000 requests/day
- **KV Storage**: 1GB free, then $0.50/GB/month
- **Paid Plan**: $5/month for 10M requests + KV operations

### Typical Usage (10 requests/day)
- **Monthly Cost**: $0 (well within free tier)
- **Annual Cost**: $0
- **Comparison**: vs $84/year minimum on Heroku

## Security

### Built-in Security Features  
- **Automatic HTTPS**: SSL/TLS encryption by default
- **Request Isolation**: Each request runs in secure isolate
- **Secret Management**: Environment variables encrypted at rest
- **DDoS Protection**: Cloudflare's security layer included

### Best Practices Implemented
- **Secure Token Storage**: OAuth tokens encrypted in KV storage
- **Input Validation**: Proper webhook and message validation
- **Error Sanitization**: No sensitive data exposed in logs
- **Rate Limiting**: Built-in protection against abuse

## Migration Notes

### What Changed
- **Runtime**: Python → JavaScript (Cloudflare Workers)
- **Storage**: Redis → Cloudflare KV  
- **Deployment**: Heroku → Cloudflare Workers
- **Cost**: $7/month minimum → $0 for typical usage
- **Performance**: ~10s cold start → <1ms cold start

### What Stayed the Same
- **All functionality preserved**: Spotify integration, track info posting, playlist management
- **Same environment variables**: Easy migration of configuration
- **Same Telegram behavior**: Identical user experience
- **Same OAuth flow**: Compatible with existing Spotify app setup

The migration to Cloudflare Workers provides significant improvements in performance, cost, and reliability while maintaining all original functionality!

# Important Instruction Reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.

IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.