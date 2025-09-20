#!/bin/bash
set -e

echo "🚀 Starting Telegram Mixtaper with Docker..."

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Please copy .env.template to .env and configure it."
    exit 1
fi

# Check required environment variables in .env
required_vars=("TELEGRAM_BOT_TOKEN" "SPOTIFY_CLIENT_ID" "SPOTIFY_CLIENT_SECRET" "SPOTIFY_USER_ID" "SPOTIFY_PLAYLIST_ID")
missing_vars=()

# Source .env to check variables
export $(cat .env | grep -v '^#' | grep -v '^$' | xargs)

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -ne 0 ]; then
    echo "❌ Missing required environment variables in .env file:"
    printf '   %s\n' "${missing_vars[@]}"
    echo ""
    echo "Please set these variables in .env and try again. See CLAUDE.md for details."
    exit 1
fi

# Build the bot image
echo "🔨 Building bot Docker image..."
docker-compose build bot

# Start Redis and bot services
echo "🐳 Starting Redis and bot containers..."
docker-compose --profile bot up -d

echo "✅ Services started successfully!"
echo "📡 Redis: redis://localhost:6379"
echo "🤖 Bot will monitor all channels for Spotify links"
echo "🎵 Playlist: $SPOTIFY_PLAYLIST_ID"
echo ""
echo "📋 Useful commands:"
echo "  View logs:     docker-compose logs -f bot"
echo "  Stop services: docker-compose --profile bot down"
echo "  Restart bot:   docker-compose restart bot"
echo "  Redis CLI:     ./scripts/redis-cli-docker.sh"
echo ""
echo "Press Ctrl+C to stop all services, or run: docker-compose --profile bot down"

# Follow logs
docker-compose logs -f bot