#!/bin/bash

echo "🖥️  Starting Redis Commander (GUI)..."

# Check if Redis container is running
if ! docker-compose ps redis | grep -q "Up"; then
    echo "🐳 Starting Redis container first..."
    docker-compose up -d redis
    echo "⏳ Waiting for Redis to be ready..."
    timeout 30 bash -c 'until docker-compose exec redis redis-cli ping | grep -q PONG; do sleep 1; done'
fi

# Start Redis Commander
echo "🚀 Starting Redis Commander..."
docker-compose --profile tools up -d redis-commander

echo ""
echo "✅ Redis Commander is running!"
echo "🌐 Open in browser: http://localhost:8081"
echo ""
echo "💡 Features:"
echo "   - Browse all Redis keys and values"
echo "   - View Spotify tokens and channel mappings"
echo "   - Execute Redis commands"
echo ""
echo "🛑 To stop: ./scripts/stop-dev.sh"