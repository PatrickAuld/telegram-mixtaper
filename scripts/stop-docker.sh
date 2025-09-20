#!/bin/bash
set -e

echo "🛑 Stopping Telegram Mixtaper Docker services..."

# Stop bot and associated services
docker-compose --profile bot down

echo "✅ All services stopped!"
echo ""
echo "🔍 To view stopped containers: docker-compose ps -a"
echo "🧹 To remove volumes: docker-compose down --volumes"