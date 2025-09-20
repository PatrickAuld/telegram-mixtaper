#!/bin/bash
set -e

echo "🚀 Setting up Telegram Mixtaper development environment..."

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop and try again."
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "📦 Creating Python virtual environment..."
    python3 -m venv .venv
fi

# Activate virtual environment
echo "🔄 Activating virtual environment..."
source .venv/bin/activate

# Install dependencies
echo "📚 Installing Python dependencies..."
pip install -r requirements.txt

# Start Redis with Docker Compose
echo "🐳 Starting Redis container..."
docker-compose up -d redis

# Wait for Redis to be ready
echo "⏳ Waiting for Redis to be ready..."
timeout 30 bash -c 'until docker-compose exec redis redis-cli ping | grep -q PONG; do sleep 1; done'

echo ""
echo "✅ Development environment setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Configure your environment variables:"
echo "   cp .env.template .env"
echo "   # Edit .env with your actual Telegram and Spotify credentials"
echo ""
echo "   Or set them manually:"
echo "   export TELEGRAM_BOT_TOKEN='your_bot_token'"
echo "   export SPOTIFY_CLIENT_ID='your_client_id'"
echo "   export SPOTIFY_CLIENT_SECRET='your_client_secret'"
echo "   export SPOTIFY_USER_ID='your_username'"
echo "   export SPOTIFY_PLAYLIST_ID='your_playlist_id'"
echo "   export USE_POLLING='true'"
echo "   export REDIS_URL='redis://localhost:6379'"
echo ""
echo "2. Run the bot:"
echo "   ./scripts/start-dev.sh"
echo ""
echo "3. Run tests:"
echo "   ./scripts/test.sh"
echo ""
echo "4. Stop services when done:"
echo "   ./scripts/stop-dev.sh"
echo ""