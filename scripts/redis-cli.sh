#!/bin/bash

echo "🔍 Connecting to Redis CLI..."

# Check if Redis container is running
if ! docker-compose ps redis | grep -q "Up"; then
    echo "❌ Redis container is not running."
    echo "💡 Start it with: ./scripts/setup-dev.sh or docker-compose up -d redis"
    exit 1
fi

echo "📡 Connected to Redis. Type 'exit' to quit."
echo "💡 Useful commands:"
echo "   - KEYS * (list all keys)"
echo "   - HGETALL default.token (view stored Spotify tokens)"
echo "   - KEYS channel_playlist:* (view channel mappings)"
echo ""

# Connect to Redis CLI
docker-compose exec redis redis-cli