# Telegram Mixtaper

A Python Telegram bot that monitors channels for Spotify links and automatically adds them to a specified Spotify playlist. Perfect for collaborative music discovery in group chats!

## Architecture

This bot consists of three main components:

- **bot.py** - Main bot logic using python-telegram-bot library
- **oauth2.py** - Custom Spotify OAuth2 handling with token refresh
- **channel_store.py** - Redis-based storage for channel-to-playlist mappings

## How It Works

1. The bot listens to ALL messages in channels it's added to
2. Uses regex to extract Spotify track links from messages: `bot.py:19`
3. Adds found tracks to the configured Spotify playlist via Spotify API
4. Handles OAuth token refresh automatically using Redis storage

## Key Features

- **Real-time monitoring**: Processes all messages for Spotify links
- **Automatic playlist management**: Adds tracks to the beginning of playlists
- **Token persistence**: Uses Redis to store and refresh Spotify OAuth tokens
- **Error handling**: Sends error notifications to a designated Telegram channel
- **Heroku-ready**: Configured with webhook deployment

## Environment Variables

The bot requires these environment variables:

### Telegram
- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather
- `TELEGRAM_ERROR_CHANNEL` - Channel ID for error notifications
- `WEBHOOK_DOMAIN` - Domain for webhook (Heroku app URL)
- `PORT` - Port for webhook (set by Heroku)

### Spotify
- `SPOTIFY_CLIENT_ID` - Spotify app client ID
- `SPOTIFY_CLIENT_SECRET` - Spotify app client secret
- `SPOTIFY_USER_ID` - Spotify username
- `SPOTIFY_PLAYLIST_ID` - Target playlist ID
- `SPOTIFY_ACCESS_TOKEN` - Initial access token
- `SPOTIFY_REFRESH_TOKEN` - Refresh token for token renewal

### Redis
- `REDIS_URL` - Redis connection URL (provided by Heroku Redis addon)

## Development

### Dependencies
Updated dependencies from `requirements.txt`:
- `python-telegram-bot[webhooks]==22.3` - Latest async Telegram bot framework
- `spotipy>=2.24.0` - Updated Spotify Web API wrapper
- `redis>=5.0.0` - Modern Redis client
- `fastapi>=0.104.0` - Fast async web framework for webhooks
- `uvicorn>=0.24.0` - ASGI server for production deployment

### ✅ Modernization Complete
The codebase has been updated to use the latest versions:
- **Python 3.13**: Latest stable Python version
- **python-telegram-bot v22.3**: Latest async library with webhook support
- **FastAPI**: Modern async web framework for webhook handling
- **Updated dependencies**: All packages updated to latest compatible versions

#### Key Changes Made:
- **Async/await patterns**: All bot handlers now use async/await
- **FastAPI webhook server**: Replaced built-in webhook with FastAPI
- **Modern Redis compatibility**: Updated for redis-py 5.0+
- **Improved error handling**: Better async error handling and reporting

### Local Development
```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables (create .env file)
export TELEGRAM_BOT_TOKEN="your_bot_token"
export SPOTIFY_CLIENT_ID="your_client_id"
export USE_POLLING="true"  # For local development
# ... other env vars

# Run the bot (polling mode for local development)
python bot.py
```

### Testing
- **Production**: Uses FastAPI webhook server with uvicorn
- **Local Development**: Set `USE_POLLING=true` to use polling mode instead of webhooks
- **Health Check**: GET `/` endpoint returns bot status

## Deployment

Deployed on Heroku with:
- **Procfile**: `web: uvicorn bot:app --host 0.0.0.0 --port $PORT` (FastAPI + uvicorn)
- **.python-version**: `3.13` (latest Python version)
- **Redis addon**: For token storage
- **FastAPI webhook server**: High-performance async webhook handling

### Heroku Setup
1. Create Heroku app
2. Add Redis addon: `heroku addons:create heroku-redis:mini`
3. Set environment variables in Heroku dashboard
4. Deploy via Git push

## Code Structure

### PlaylistMaker Class (`bot.py:22-50`)
- `get_spotify_links()` - Extracts Spotify URLs using regex
- `find_spotify_links()` - Main message handler that adds tracks to playlist

### OAuth Management (`oauth2.py`)
- `RefreshingSpotifyClientCredentials` - Custom credentials manager
- `RedisTokenStore` - Persistent token storage
- Automatic token refresh when expired

### Channel Storage (`channel_store.py`)
- `ChannelStore` - Maps Telegram channels to Spotify playlists
- Redis-backed storage for scalability

## Common Tasks

### Adding the Bot to a Channel
1. Add bot to Telegram channel as admin
2. Bot will automatically monitor all messages for Spotify links
3. Links are added to the configured playlist immediately

### Monitoring
- Errors are sent to the designated error channel
- Check Heroku logs: `heroku logs --tail`
- Monitor Redis usage in Heroku dashboard

### Troubleshooting
- **Token issues**: Check Spotify token expiration in Redis
- **Permission errors**: Ensure bot has admin rights in target channels
- **Playlist errors**: Verify playlist ID and user permissions

## Security Notes
- Spotify tokens are stored securely in Redis
- No sensitive data logged in application logs
- Bot only processes public channel messages