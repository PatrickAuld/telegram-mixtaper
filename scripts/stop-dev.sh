#!/bin/bash

echo "🛑 Stopping Telegram Mixtaper development environment..."

# Stop Docker Compose services
if docker-compose ps | grep -q "Up"; then
    echo "🐳 Stopping Docker containers..."
    docker-compose down
else
    echo "ℹ️  No running containers found"
fi

echo "✅ Development environment stopped"
echo ""
echo "💡 To restart, run: ./scripts/start-dev.sh"