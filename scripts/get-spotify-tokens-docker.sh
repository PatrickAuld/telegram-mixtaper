#!/bin/bash
set -e

echo "🎵 Spotify Token Generator - Docker Mode"
echo "========================================"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Please copy .env.template to .env and configure it."
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if Redis is running
echo "🔍 Checking Redis container..."
if ! docker-compose ps redis | grep -q "Up"; then
    echo "🐳 Starting Redis container..."
    docker-compose up -d redis
    echo "⏳ Waiting for Redis to be ready..."
    sleep 3
fi

echo ""
echo "🚀 Starting Spotify token generation process..."
echo ""

# Function to start ngrok and get URL
start_ngrok() {
    echo "🌐 Starting ngrok tunnel on port 8080..."
    ngrok http 8080 --log=stdout > /tmp/ngrok.log 2>&1 &
    NGROK_PID=$!
    
    # Wait for ngrok to start
    echo "⏳ Waiting for ngrok to establish tunnel..."
    for i in {1..30}; do
        sleep 1
        if curl -s http://localhost:4040/api/tunnels > /dev/null 2>&1; then
            break
        fi
        if [ $i -eq 30 ]; then
            echo "❌ ngrok failed to start within 30 seconds"
            kill $NGROK_PID 2>/dev/null || true
            exit 1
        fi
    done
    
    # Get the public URL
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | python3 -c "import sys, json; data = json.load(sys.stdin); print(data['tunnels'][0]['public_url'] if data['tunnels'] else 'No tunnels')" 2>/dev/null)
    
    if [ "$NGROK_URL" == "No tunnels" ] || [ -z "$NGROK_URL" ]; then
        echo "❌ Failed to get ngrok URL"
        kill $NGROK_PID 2>/dev/null || true
        exit 1
    fi
    
    echo "✅ ngrok tunnel established: $NGROK_URL"
    echo ""
}

# Function to stop ngrok
stop_ngrok() {
    if [ ! -z "$NGROK_PID" ]; then
        echo "🛑 Stopping ngrok tunnel..."
        kill $NGROK_PID 2>/dev/null || true
        pkill -f ngrok 2>/dev/null || true
    fi
}

# Trap to ensure ngrok is stopped on exit
trap stop_ngrok EXIT

# Start ngrok
start_ngrok

# Set redirect URI using ngrok URL
REDIRECT_URI="${NGROK_URL}/callback"

echo "📝 STEP 1: Add this redirect URI to your Spotify app:"
echo "   https://developer.spotify.com/dashboard"
echo "   → Select your app → Settings → Redirect URIs"
echo "   → Add: $REDIRECT_URI"
echo ""

read -p "Press Enter after adding the redirect URI to your Spotify app..."

echo ""
echo "🌐 STEP 2: Getting authorization URL..."
echo ""

# Run the token generator to get the auth URL
AUTH_URL=$(docker-compose run --rm -e SPOTIFY_REDIRECT_URI="$REDIRECT_URI" bot python get_spotify_tokens.py 2>/dev/null | grep "https://accounts.spotify.com" || true)

if [ -z "$AUTH_URL" ]; then
    echo "❌ Failed to get authorization URL. Running in interactive mode..."
    docker-compose run --rm -e SPOTIFY_REDIRECT_URI="$REDIRECT_URI" bot python get_spotify_tokens.py
    stop_ngrok
    exit 1
fi

echo "🔗 Open this URL in your browser:"
echo "============================================================"
echo "$AUTH_URL"
echo "============================================================"
echo ""

# Try to open browser automatically
if command -v open > /dev/null 2>&1; then
    echo "🌐 Opening browser automatically..."
    open "$AUTH_URL"
elif command -v xdg-open > /dev/null 2>&1; then
    echo "🌐 Opening browser automatically..."
    xdg-open "$AUTH_URL"
fi

echo ""
echo "📋 After authorizing, you'll be redirected automatically."
echo "   Leave this terminal open and complete the authorization in your browser."
echo ""

# Start a simple callback server to catch the OAuth redirect
echo "🖥️  Starting local callback server on port 8080..."

# Create a simple Python callback server
cat > /tmp/oauth_server.py << 'EOF'
#!/usr/bin/env python3
import http.server
import socketserver
import urllib.parse
import sys
import threading
import time

class CallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/callback'):
            # Parse the query parameters
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            
            if 'code' in params:
                # Success! Write the authorization URL to a file
                full_url = f"http://localhost:8080{self.path}"
                with open('/tmp/auth_url.txt', 'w') as f:
                    f.write(full_url)
                
                # Send success page
                self.send_response(200)
                self.send_header('Content-type', 'text/html')
                self.end_headers()
                
                html = """
                <!DOCTYPE html>
                <html>
                <head><title>Spotify Authorization Successful</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px; background: #1db954; color: white;">
                    <div style="background: rgba(0,0,0,0.8); padding: 40px; border-radius: 10px; max-width: 500px; margin: 0 auto;">
                        <h1>✅ Authorization Successful!</h1>
                        <p>You can now close this window and return to your terminal.</p>
                        <p>Token generation will continue automatically.</p>
                    </div>
                </body>
                </html>
                """
                self.wfile.write(html.encode())
                
                # Signal to shutdown the server
                threading.Thread(target=lambda: (time.sleep(1), server.shutdown())).start()
            else:
                # Error
                self.send_response(400)
                self.send_header('Content-type', 'text/html')
                self.end_headers()
                html = "<h1>Authorization Failed</h1><p>Please try again.</p>"
                self.wfile.write(html.encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def log_message(self, format, *args):
        pass  # Suppress logs

# Start server
PORT = 8080
with socketserver.TCPServer(("", PORT), CallbackHandler) as server:
    print(f"Callback server started on port {PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
EOF

# Run the callback server in the background
python3 /tmp/oauth_server.py &
CALLBACK_PID=$!

# Function to cleanup callback server
cleanup_callback() {
    if [ ! -z "$CALLBACK_PID" ]; then
        kill $CALLBACK_PID 2>/dev/null || true
    fi
    rm -f /tmp/oauth_server.py /tmp/auth_url.txt 2>/dev/null || true
}

# Update trap to cleanup both ngrok and callback server
trap 'stop_ngrok; cleanup_callback' EXIT

# Wait for authorization (max 5 minutes)
echo "⏳ Waiting for authorization (timeout: 5 minutes)..."
for i in {1..300}; do
    if [ -f /tmp/auth_url.txt ]; then
        REDIRECT_URL=$(cat /tmp/auth_url.txt)
        echo "✅ Authorization received!"
        break
    fi
    sleep 1
    if [ $i -eq 300 ]; then
        echo "❌ Authorization timeout. Please try again."
        cleanup_callback
        stop_ngrok
        exit 1
    fi
done

# Stop the callback server
cleanup_callback

echo ""
echo "🔐 STEP 3: Generating tokens..."
echo ""

# Generate tokens using the redirect URL
docker-compose run --rm -e AUTHORIZATION_URL="$REDIRECT_URL" bot python get_spotify_tokens.py

TOKEN_RESULT=$?

# Stop ngrok now that we're done with OAuth
stop_ngrok

if [ $TOKEN_RESULT -ne 0 ]; then
    echo "❌ Token generation failed!"
    exit 1
fi

echo ""
echo "✅ Token generation complete!"
echo "🔄 Restarting bot to use new tokens..."

# Restart the bot to use new tokens
docker-compose restart bot

echo ""
echo "🎉 All done! Check bot logs:"
echo "   docker-compose logs bot --tail=10"
echo ""