#!/bin/bash
set -e

echo "🧪 Running Telegram Mixtaper tests..."

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    echo "❌ Virtual environment not found. Run ./scripts/setup-dev.sh first."
    exit 1
fi

# Activate virtual environment
source .venv/bin/activate

# Start Redis for tests if not running
if ! docker-compose ps redis | grep -q "Up"; then
    echo "🐳 Starting Redis for tests..."
    docker-compose up -d redis
    echo "⏳ Waiting for Redis to be ready..."
    timeout 30 bash -c 'until docker-compose exec redis redis-cli ping | grep -q PONG; do sleep 1; done'
fi

# Set test environment variables
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

echo "🔍 Running unit tests..."
pytest test_bot.py -v

echo ""
echo "📊 Running tests with coverage..."
if pip show pytest-cov >/dev/null 2>&1; then
    pytest test_bot.py --cov=bot --cov=oauth2 --cov=channel_store --cov-report=term-missing
else
    echo "⚠️  pytest-cov not installed. Install with: pip install pytest-cov"
    echo "   Running tests without coverage report..."
    pytest test_bot.py -v
fi

echo ""
echo "✅ All tests completed!"