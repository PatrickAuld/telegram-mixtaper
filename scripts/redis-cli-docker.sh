#!/bin/bash
set -e

echo "🔧 Connecting to Redis CLI in Docker container..."

# Check if Redis container is running
if ! docker-compose ps redis | grep -q "Up"; then
    echo "❌ Redis container is not running. Start it first with:"
    echo "   docker-compose up -d redis"
    exit 1
fi

# Connect to Redis CLI
docker-compose exec redis redis-cli