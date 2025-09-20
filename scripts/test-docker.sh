#!/bin/bash
set -e

echo "🧪 Running tests in Docker container..."

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Please copy .env.template to .env and configure it."
    exit 1
fi

# Start Redis if not running
if ! docker-compose ps redis | grep -q "Up"; then
    echo "🐳 Starting Redis container for tests..."
    docker-compose up -d redis
    echo "⏳ Waiting for Redis to be ready..."
    timeout 30 bash -c 'until docker-compose exec redis redis-cli ping | grep -q PONG; do sleep 1; done'
fi

# Build the bot image
echo "🔨 Building bot Docker image..."
docker-compose build bot

# Run tests in container
echo "🧪 Running tests..."
docker-compose run --rm bot pytest test_bot.py -v

echo "✅ Tests completed!"