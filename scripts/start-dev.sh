#!/bin/bash
set -e

echo "🚀 Starting Telegram Mixtaper in development mode..."

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    echo "❌ Virtual environment not found. Run ./scripts/setup-dev.sh first."
    exit 1
fi

# Activate virtual environment
source .venv/bin/activate

# Load .env file if it exists
if [ -f ".env" ]; then
    echo "📄 Loading environment variables from .env file..."
    export $(cat .env | grep -v '^#' | grep -v '^$' | xargs)
fi

# Check if Redis is running
if ! docker-compose ps redis | grep -q "Up"; then
    echo "🐳 Starting Redis container..."
    docker-compose up -d redis
    echo "⏳ Waiting for Redis to be ready..."
    timeout 30 bash -c 'until docker-compose exec redis redis-cli ping | grep -q PONG; do sleep 1; done'
fi

# Check required environment variables
required_vars=("TELEGRAM_BOT_TOKEN" "SPOTIFY_CLIENT_ID" "SPOTIFY_CLIENT_SECRET" "SPOTIFY_USER_ID" "SPOTIFY_PLAYLIST_ID")
missing_vars=()

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -ne 0 ]; then
    echo "❌ Missing required environment variables:"
    printf '   %s\n' "${missing_vars[@]}"
    echo ""
    echo "Please set these variables and try again. See CLAUDE.md for details."
    exit 1
fi

# Set default values for optional variables
export USE_POLLING="${USE_POLLING:-true}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

echo "✅ Starting bot with polling mode..."
echo "📡 Redis: $REDIS_URL"
echo "🤖 Bot will monitor all channels for Spotify links"
echo "🎵 Playlist: $SPOTIFY_PLAYLIST_ID"
echo ""
echo "Press Ctrl+C to stop the bot"
echo ""

# Start the bot
python bot.py