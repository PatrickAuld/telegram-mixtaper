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
Key dependencies from `requirements.txt`:
- `python-telegram-bot==10.1.0` - Telegram bot framework (⚠️ LEGACY VERSION)
- `spotipy==2.4.4` - Spotify Web API wrapper
- `redis==2.10.6` - Redis client for token storage

### ⚠️ Modernization Notes
The current codebase uses python-telegram-bot v10.1.0, which is significantly outdated. The latest version (v22.3+) introduced major breaking changes:
- **Async/await required**: The library is now fully async (requires code rewrite)
- **Context-based API**: Handler API has changed completely
- **Python 3.9+ required**: Older Python versions no longer supported
- Consider upgrading when development time allows

### Local Development
```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables (create .env file)
export TELEGRAM_BOT_TOKEN="your_bot_token"
export SPOTIFY_CLIENT_ID="your_client_id"
# ... other env vars

# Run the bot
python bot.py
```

### Testing
The bot uses webhook mode for production deployment. For local testing, you may want to switch to polling mode by modifying the `main()` function in `bot.py:93-100`.

## Deployment

Deployed on Heroku with:
- **Procfile**: `web: python bot.py` (updated to modern format)
- **.python-version**: `3.12` (specifies Python version using modern approach)
- **Redis addon**: For token storage
- **Webhook mode**: For efficient message processing

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