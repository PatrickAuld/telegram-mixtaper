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
- `pytest>=8.0.0` - Testing framework
- `pytest-asyncio>=0.23.0` - Async test support

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

### Local Development Setup

#### Quick Start (Recommended)
```bash
# One-command setup with Docker Compose
./scripts/setup-dev.sh

# Set your environment variables (see section 2 below)
export TELEGRAM_BOT_TOKEN="your_bot_token"
export SPOTIFY_CLIENT_ID="your_client_id"
# ... other required env vars

# Start the bot
./scripts/start-dev.sh
```

#### 1. Set up Virtual Environment
```bash
# Create virtual environment
python3 -m venv .venv

# Activate virtual environment
# On macOS/Linux:
source .venv/bin/activate
# On Windows:
# .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

#### 1.5. Redis Setup (Docker Compose)
```bash
# Start Redis with Docker Compose (recommended)
docker-compose up -d redis

# Or start with Redis GUI for debugging
./scripts/redis-gui.sh

# Check Redis is running
docker-compose ps
```

#### 2. Environment Configuration

**Using .env file (Recommended):**
```bash
# Copy the template and edit with your values
cp .env.template .env

# Edit .env with your actual credentials
# nano .env  # or use your preferred editor
```

**Manual Environment Variables:**
```bash
export TELEGRAM_BOT_TOKEN="your_bot_token_from_botfather"
export SPOTIFY_CLIENT_ID="your_spotify_client_id"
export SPOTIFY_CLIENT_SECRET="your_spotify_client_secret"
export SPOTIFY_USER_ID="your_spotify_username"
export SPOTIFY_PLAYLIST_ID="your_target_playlist_id"
export USE_POLLING="true"  # Essential for local development
export REDIS_URL="redis://localhost:6379"  # Local Redis instance
export TELEGRAM_ERROR_CHANNEL="your_error_channel_id"  # Optional
```

#### 3. Telegram Bot Setup for Local Testing

**Create a Test Bot:**
1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` and follow prompts
3. Copy the bot token to `TELEGRAM_BOT_TOKEN`
4. Send `/setprivacy` to BotFather and set to **Disabled** (allows bot to read all messages)

**Create a Test Channel:**
1. Create a new Telegram channel (public or private)
2. Add your test bot as administrator with "Post Messages" permission
3. Send a message with a Spotify link to test functionality

**Get Channel ID for Error Reporting:**
```bash
# Send a message to your bot, then visit:
https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
# Look for "chat":{"id": -123456789} in the response
```

#### 4. Spotify Setup & OAuth Token Generation

**Step 1: Create Spotify App**
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app (any name/description)
3. Note the Client ID and Client Secret
4. Create a test playlist and note its ID from the URL

**Step 2: Generate OAuth Tokens**

The bot requires Spotify OAuth tokens to add tracks to playlists. Use the working OAuth token scripts:

**🚀 Recommended: Working OAuth Scripts**

**Option 1: Python OAuth Script (Primary)**
```bash
# Use the proven working Python script
python get_oauth_tokens.py

# This script handles:
# - Automatic ngrok tunnel setup with proper cleanup
# - Clear redirect URI instructions for Spotify app configuration
# - Browser-based OAuth authorization flow
# - Automatic token extraction and .env file updates
# - Resolves common OAuth redirect URI mismatch issues
```

**Option 2: Shell Script Wrapper (Streamlined)**
```bash
# Use the working shell script for simplified execution
./get_oauth_tokens.sh

# Streamlined wrapper that calls the Python script
# with optimal settings for reliable token generation
```

**✅ Advantages of these scripts:**
- No redirect URI mismatch errors
- Proper ngrok tunnel coordination
- Reliable environment variable handling  
- Automatic .env file token persistence
- Tested and proven to work

**🔧 Legacy Option: Manual Mode (if needed)**
```bash
# Step 1: Add permanent redirect URI to Spotify app
# Go to Spotify app → Settings → Redirect URIs
# Add: http://localhost:8080/callback

# Step 2: Get authorization URL
source .venv/bin/activate
SPOTIFY_REDIRECT_URI='http://localhost:8080/callback' python get_spotify_tokens.py

# Step 3: Open the provided URL in browser, authorize the app
# You'll be redirected to: http://localhost:8080/callback?code=...

# Step 4: Use the full redirect URL to get tokens
AUTHORIZATION_URL='http://localhost:8080/callback?code=...' python get_spotify_tokens.py
```

**🛠️ Docker Environment (using container)**

**Option 0: Simple ngrok Script (Most Reliable)**
```bash
# Simplified approach with manual callback handling
./scripts/simple-spotify-tokens.sh

# What this script does:
# 1. ✅ Starts ngrok tunnel and gets public HTTPS URL
# 2. 📝 Shows exact redirect URI to add to Spotify app  
# 3. 🔗 Generates and opens OAuth authorization URL
# 4. 📋 Prompts you to paste the callback URL manually
# 5. 🔑 Extracts and displays OAuth tokens
# 6. 💾 Automatically saves tokens to .env file
# 7. 🧹 Cleans up ngrok tunnel when done

# Advantages:
# - No port conflicts or callback server issues
# - Exact redirect URI matching prevents OAuth errors
# - Works reliably in all environments
# - Simple manual step ensures proper authorization
```

**Option 1: Streamlined Script with ngrok (Automated)**
```bash
# Use the streamlined Docker script (handles everything including ngrok)
./scripts/get-spotify-tokens-docker.sh

# What this script does:
# 1. ✅ Sets up ngrok tunnel and gets public HTTPS URL
# 2. 📝 Prompts user to add ngrok URL to Spotify app
# 3. 🔗 Opens OAuth authorization URL in browser  
# 4. 🔑 Prints the OAuth access and refresh tokens
# 5. 💾 Automatically saves tokens to .env file
# 6. 🔄 Restarts bot with new tokens
# 7. 🧹 Cleans up ngrok tunnel when done
```

**Option 2: Manual Docker Commands (with ngrok)**
```bash
# Step 1: Start ngrok tunnel
ngrok http 8080 &

# Step 2: Get ngrok URL and add to Spotify app
curl -s http://localhost:4040/api/tunnels | python3 -c "import sys, json; data = json.load(sys.stdin); print(data['tunnels'][0]['public_url'] + '/callback')"

# Step 3: Use ngrok URL for token generation
NGROK_URL="<your_ngrok_url>/callback"
docker-compose run --rm -e SPOTIFY_REDIRECT_URI="$NGROK_URL" bot python get_spotify_tokens.py

# Step 4: Complete OAuth and get tokens
docker-compose exec -e AUTHORIZATION_URL='<redirect_url>' bot python get_spotify_tokens.py

# Step 5: Stop ngrok and restart bot
pkill ngrok
docker-compose restart bot
```

**✅ Token Generation Features:**
- 🌐 **ngrok integration**: Automatic HTTPS redirect URIs for seamless OAuth
- 🔄 **Two modes**: Interactive (auto) and manual (CLI-friendly) 
- 📝 **Auto .env update**: Tokens automatically written to .env file
- 🧪 **Token validation**: Tests connection to Spotify API
- 📋 **Clear instructions**: Step-by-step guidance for both modes
- 🔒 **Secure**: Handles OAuth flow with proper scopes for playlist modification

**Required Scopes:** `playlist-modify-public playlist-modify-private`

After generating tokens, the .env file will be automatically updated with:
```bash
SPOTIFY_ACCESS_TOKEN=BQC4YWxhc2Rmc2RmMjM...
SPOTIFY_REFRESH_TOKEN=AQC8vQES_P4e3uEO2E...
```

#### 5. Running the Bot Locally

**Using Scripts (Recommended):**
```bash
# Start everything (Redis + Bot)
./scripts/start-dev.sh

# Stop everything
./scripts/stop-dev.sh

# Run tests
./scripts/test.sh

# Access Redis CLI for debugging
./scripts/redis-cli.sh

# Open Redis GUI (browser-based)
./scripts/redis-gui.sh
```

**Manual Method:**
```bash
# Start Redis first
docker-compose up -d redis

# Run with polling (recommended for local development)
export USE_POLLING="true"
python bot.py

# The bot will start polling for messages
# Send Spotify links in your test channel to verify functionality
```

#### 6. Testing

**Run Unit Tests:**
```bash
# Using scripts (handles Redis setup automatically)
./scripts/test.sh

# Manual method
pytest test_bot.py -v

# Run specific test class
pytest test_bot.py::TestPlaylistMaker -v

# Run with coverage (install pytest-cov first)
pip install pytest-cov
pytest test_bot.py --cov=bot --cov=oauth2 --cov=channel_store
```

**Manual Testing with Telegram:**
1. Start the bot: `./scripts/start-dev.sh`
2. In your test channel, send messages with Spotify track links:
   ```
   Check out this song: https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
   ```
3. Verify tracks are added to your Spotify playlist
4. Check console logs for any errors
5. Use `./scripts/redis-cli.sh` to inspect stored tokens and data

**Test Different Scenarios:**
- Multiple Spotify links in one message
- Links with query parameters (`?si=xyz`)
- Mixed messages with text and links
- Invalid or non-Spotify links (should be ignored)

#### Development Scripts Reference

| Script | Purpose |
|--------|---------|
| `./scripts/setup-dev.sh` | Complete environment setup (venv + Redis) |
| `./scripts/start-dev.sh` | Start bot with Redis in polling mode |
| `./scripts/stop-dev.sh` | Stop all services and containers |
| `./scripts/test.sh` | Run unit tests with coverage |
| `./scripts/redis-cli.sh` | Access Redis command line interface |
| `./scripts/redis-gui.sh` | Start Redis Commander GUI (http://localhost:8081) |
| `python get_oauth_tokens.py` | Generate Spotify OAuth tokens (recommended working script) |
| `./get_oauth_tokens.sh` | Shell wrapper for OAuth token generation |
| `./scripts/get-spotify-tokens-docker.sh` | Docker-friendly Spotify token generation script |

#### Docker Services

- **Redis**: Persistent storage for Spotify tokens and channel mappings
- **Redis Commander**: Web-based GUI for Redis management (optional, started with `--profile tools`)

#### Debugging Tools

**Redis CLI Commands:**
```bash
# View all keys
KEYS *

# Check Spotify tokens
HGETALL default.token

# View channel mappings  
KEYS channel_playlist:*

# Clear all data (for testing)
FLUSHALL
```

**Redis GUI:**
- Start: `./scripts/redis-gui.sh`
- Access: http://localhost:8081
- Features: Browse keys, execute commands, real-time monitoring

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

**Spotify Token Issues:**
- **"Invalid access token" errors**: Run `python get_oauth_tokens.py` to regenerate tokens (recommended)
- **"400 Bad Request" during refresh**: Tokens are corrupted, regenerate with `./get_oauth_tokens.sh`
- **Empty tokens in Redis**: Check that `.env` has `SPOTIFY_ACCESS_TOKEN` and `SPOTIFY_REFRESH_TOKEN`
- **Token generation fails**: Use the working `get_oauth_tokens.py` script which handles redirect URI issues
- **Redirect URI problems**: The `get_oauth_tokens.py` script resolves common OAuth mismatch errors

**ngrok/OAuth Issues:**
- **ngrok tunnel fails**: Check if ngrok is installed (`which ngrok`)
- **Browser doesn't open**: Copy the authorization URL manually
- **"INVALID_CLIENT: Invalid redirect URI"**: Use `./scripts/simple-spotify-tokens.sh` (ensures exact URI matching)
- **Redirect URI mismatch**: Ensure the exact ngrok URL (including `/callback`) is added to Spotify app
- **"Address already in use"**: Try the simplified script to avoid port conflicts
- **Non-interactive mode**: Use manual mode with `SPOTIFY_REDIRECT_URI='http://localhost:8080/callback'`

**General Issues:**
- **Permission errors**: Ensure bot has admin rights in target channels
- **Playlist errors**: Verify playlist ID and user permissions
- **Redis connection errors**: Start Redis with `docker-compose up -d redis`

**Quick Token Reset:**
```bash
# Clear Redis tokens and regenerate with working script
docker-compose exec redis redis-cli DEL default.token
python get_oauth_tokens.py
docker-compose restart bot
```

## Quick Reference: Spotify Token Generation

### 🚀 **Recommended: Working OAuth Scripts**
```bash
# Primary method - tested and reliable
python get_oauth_tokens.py

# Or use the shell wrapper
./get_oauth_tokens.sh

# These scripts handle:
# - ngrok tunnel setup and cleanup
# - Spotify app redirect URI configuration
# - OAuth authorization flow
# - Automatic .env token updates
```

### 🔧 **Alternative: Legacy Scripts**
```bash
source .venv/bin/activate
python get_spotify_tokens.py
# Follow prompts, add ngrok URL to Spotify app, authorize in browser
```

### 🔧 **CLI Setup (Non-Interactive)**
```bash
# 1. Add http://localhost:8080/callback to Spotify app once
# 2. Get auth URL
SPOTIFY_REDIRECT_URI='http://localhost:8080/callback' python get_spotify_tokens.py
# 3. Open URL, authorize, copy full redirect URL
# 4. Get tokens
AUTHORIZATION_URL='http://localhost:8080/callback?code=...' python get_spotify_tokens.py
```

### 🐳 **Docker Environment**
```bash
# Automated script with ngrok (recommended)
./scripts/get-spotify-tokens-docker.sh

# Or manual with ngrok: 
# 1. ngrok http 8080 & 
# 2. Add ngrok URL to Spotify app
# 3. docker-compose run --rm -e SPOTIFY_REDIRECT_URI='<ngrok_url>/callback' bot python get_spotify_tokens.py
# 4. docker-compose exec -e AUTHORIZATION_URL='<redirect_url>' bot python get_spotify_tokens.py
```

### ✅ **Verification**
```bash
# Check tokens are in .env
grep SPOTIFY_ .env

# Restart bot to use new tokens
docker-compose restart bot

# Check bot logs for success
docker-compose logs bot --tail=10
```

## Security Notes
- Spotify tokens are stored securely in Redis
- No sensitive data logged in application logs
- Bot only processes public channel messages