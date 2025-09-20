#!/usr/bin/env python3
"""
Spotify OAuth Token Generator for Telegram Mixtaper Bot

This script automatically sets up ngrok tunnel and handles OAuth callback
to obtain the initial access and refresh tokens needed for the bot to 
modify Spotify playlists on your behalf.
"""

import os
import sys
import time
import subprocess
import threading
import requests
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import spotipy
from spotipy.oauth2 import SpotifyOAuth

# Global variables for callback handling
authorization_code = None
oauth_state = None
callback_received = False

class CallbackHandler(BaseHTTPRequestHandler):
    """HTTP request handler for OAuth callback"""
    
    def do_GET(self):
        global authorization_code, oauth_state, callback_received
        
        # Parse the callback URL
        parsed_url = urlparse(self.path)
        query_params = parse_qs(parsed_url.query)
        
        if 'code' in query_params and 'state' in query_params:
            authorization_code = query_params['code'][0]
            oauth_state = query_params['state'][0]
            callback_received = True
            
            # Send success response
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            
            success_html = """
            <!DOCTYPE html>
            <html>
            <head>
                <title>Spotify Authorization Successful</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #1db954; color: white; }
                    .container { background: rgba(0,0,0,0.8); padding: 40px; border-radius: 10px; max-width: 500px; margin: 0 auto; }
                    h1 { color: #1db954; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>✅ Authorization Successful!</h1>
                    <p>You have successfully authorized the Telegram Mixtaper Bot to access your Spotify account.</p>
                    <p>You can now close this window and return to your terminal.</p>
                    <p>The bot will now be able to add tracks to your playlists!</p>
                </div>
            </body>
            </html>
            """
            self.wfile.write(success_html.encode())
        else:
            # Send error response
            self.send_response(400)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            
            error_html = """
            <!DOCTYPE html>
            <html>
            <head>
                <title>Spotify Authorization Failed</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #e22134; color: white; }
                    .container { background: rgba(0,0,0,0.8); padding: 40px; border-radius: 10px; max-width: 500px; margin: 0 auto; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Authorization Failed</h1>
                    <p>There was an error with the Spotify authorization.</p>
                    <p>Please try running the script again.</p>
                </div>
            </body>
            </html>
            """
            self.wfile.write(error_html.encode())
    
    def log_message(self, format, *args):
        # Suppress default logging
        pass

def start_ngrok_tunnel(port=8888):
    """Start ngrok tunnel and return the public URL"""
    print("🌐 Starting ngrok tunnel...")
    
    try:
        # Start ngrok process
        ngrok_process = subprocess.Popen(
            ['ngrok', 'http', str(port), '--log=stdout'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        # Wait for ngrok to start and get the URL
        max_attempts = 10
        for attempt in range(max_attempts):
            time.sleep(1)
            try:
                # Query ngrok API for tunnel info
                response = requests.get('http://localhost:4040/api/tunnels')
                if response.status_code == 200:
                    tunnels = response.json()['tunnels']
                    for tunnel in tunnels:
                        if tunnel['config']['addr'] == f'http://localhost:{port}':
                            public_url = tunnel['public_url']
                            if public_url.startswith('https://'):
                                print(f"✅ ngrok tunnel established: {public_url}")
                                return ngrok_process, public_url
            except requests.exceptions.ConnectionError:
                if attempt == max_attempts - 1:
                    print("❌ Failed to connect to ngrok API")
                    ngrok_process.terminate()
                    return None, None
                continue
        
        print("❌ Timeout waiting for ngrok tunnel")
        ngrok_process.terminate()
        return None, None
        
    except FileNotFoundError:
        print("❌ ngrok not found. Please install ngrok: https://ngrok.com/download")
        return None, None
    except Exception as e:
        print(f"❌ Error starting ngrok: {e}")
        return None, None

def start_callback_server(port=8888):
    """Start HTTP server for OAuth callback"""
    server = HTTPServer(('localhost', port), CallbackHandler)
    print(f"🖥️  Starting callback server on port {port}...")
    
    # Start server in a separate thread
    server_thread = threading.Thread(target=server.serve_forever)
    server_thread.daemon = True
    server_thread.start()
    
    return server

def get_spotify_tokens():
    """Get Spotify OAuth tokens with playlist modification permissions using ngrok."""
    global authorization_code, oauth_state, callback_received
    
    # Read from environment
    client_id = os.environ.get('SPOTIFY_CLIENT_ID')
    client_secret = os.environ.get('SPOTIFY_CLIENT_SECRET')
    custom_redirect = os.environ.get('SPOTIFY_REDIRECT_URI')
    
    if not client_id:
        print("❌ SPOTIFY_CLIENT_ID environment variable not set")
        return None
    if not client_secret:
        print("❌ SPOTIFY_CLIENT_SECRET environment variable not set")
        return None
    
    print(f"Using Client ID: {client_id}")
    
    # Check if we have a custom redirect URI (manual mode)
    if custom_redirect:
        print(f"Using provided redirect URI: {custom_redirect}")
        return get_tokens_manual_mode(client_id, client_secret, custom_redirect)
    
    # Auto mode with ngrok
    return get_tokens_auto_mode(client_id, client_secret)

def get_tokens_manual_mode(client_id, client_secret, redirect_uri):
    """Get tokens using manual browser copy-paste method"""
    print(f"\n🔧 Manual Mode - Using redirect URI: {redirect_uri}")
    
    # Define required scopes for playlist modification
    scope = "playlist-modify-public playlist-modify-private"
    
    # Create SpotifyOAuth instance
    sp_oauth = SpotifyOAuth(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        scope=scope,
        cache_path=None  # Don't cache, we want fresh tokens
    )
    
    # Get the authorization URL
    auth_url = sp_oauth.get_authorize_url()
    
    print(f"\n🌐 Please open this URL in your browser:")
    print(f"{'='*60}")
    print(auth_url)
    print(f"{'='*60}")
    
    print("\n📋 After authorizing, you'll be redirected to a URL starting with:")
    print(f"{redirect_uri}?code=...")
    print("\n💡 To get tokens, run this script again with the full redirect URL:")
    print("AUTHORIZATION_URL='<paste_full_redirect_url_here>' python get_spotify_tokens.py")
    
    # Check if authorization URL was provided
    auth_response_url = os.environ.get('AUTHORIZATION_URL')
    if not auth_response_url:
        print("\n⏳ Waiting for AUTHORIZATION_URL environment variable...")
        
        # In Docker environment, provide instructions and keep container alive
        if os.path.exists('/.dockerenv'):
            print("\n🐳 Docker Environment Detected!")
            print("To complete token generation:")
            print("1. Open the authorization URL above in your browser")
            print("2. After authorization, run this command in a NEW terminal:")
            print("   docker-compose exec bot bash")
            print("3. Then inside the container run:")
            print("   AUTHORIZATION_URL='<your_redirect_url>' python get_spotify_tokens.py")
            print("\nAlternatively, run from your host machine:")
            print("   docker-compose exec -e AUTHORIZATION_URL='<your_redirect_url>' bot python get_spotify_tokens.py")
            print("\n⏳ Container will stay alive for 10 minutes for you to complete the process...")
            
            # Keep container alive for 10 minutes to allow user to complete OAuth
            import time
            try:
                time.sleep(600)  # 10 minutes
                print("\n⏰ Container timeout reached. Please restart if needed.")
            except KeyboardInterrupt:
                print("\n👋 Container stopped by user.")
            return None
        
        return None
    
    try:
        # Extract the authorization code and get tokens
        code = sp_oauth.parse_response_code(auth_response_url)
        token_info = sp_oauth.get_access_token(code)
        
        if token_info:
            print(f"\n🎉 SUCCESS! Spotify tokens obtained!")
            
            # Test the token
            print("🧪 Testing token...")
            sp = spotipy.Spotify(auth=token_info['access_token'])
            user = sp.current_user()
            print(f"✅ Connected as: {user['display_name']} ({user['id']})")
            
            # Update .env file
            try:
                update_env_file(token_info['access_token'], token_info['refresh_token'])
                print("\n✅ Updated .env file with new tokens!")
            except Exception as e:
                print(f"\n⚠️  Could not update .env file: {e}")
                print(f"SPOTIFY_ACCESS_TOKEN={token_info['access_token']}")
                print(f"SPOTIFY_REFRESH_TOKEN={token_info['refresh_token']}")
            
            return token_info
        else:
            print("❌ Failed to get tokens")
            return None
            
    except Exception as e:
        print(f"❌ Error getting tokens: {e}")
        return None

def get_tokens_auto_mode(client_id, client_secret):
    """Get tokens using automated ngrok tunnel and callback server"""
    global authorization_code, oauth_state, callback_received
    
    print("\n🤖 Auto Mode - Setting up ngrok tunnel...")
    
    # Start callback server
    port = 8888
    server = start_callback_server(port)
    
    # Start ngrok tunnel
    ngrok_process, public_url = start_ngrok_tunnel(port)
    if not public_url:
        return None
    
    # Use ngrok URL as redirect URI
    redirect_uri = f"{public_url}/callback"
    
    print(f"\n📝 STEP 1: Add this redirect URI to your Spotify app:")
    print(f"{'='*60}")
    print(f"Redirect URI: {redirect_uri}")
    print(f"{'='*60}")
    print("\n🔗 Go to: https://developer.spotify.com/dashboard")
    print("1. Select your app")
    print("2. Click 'Settings'")
    print("3. Click 'Edit Settings'")
    print("4. Add the above redirect URI to 'Redirect URIs'")
    print("5. Click 'Save'")
    
    # Check for non-interactive mode
    if not sys.stdin.isatty():
        print("\n⚠️  Non-interactive mode detected.")
        print("Alternative: Add a permanent redirect URI to your Spotify app and use manual mode:")
        print("1. Add 'http://localhost:8080/callback' to your Spotify app redirect URIs")
        print("2. Run: SPOTIFY_REDIRECT_URI='http://localhost:8080/callback' python get_spotify_tokens.py")
        if ngrok_process:
            ngrok_process.terminate()
        server.shutdown()
        return None
    
    input("\n⏳ Press Enter after adding the redirect URI to your Spotify app...")
    
    # Define required scopes for playlist modification
    scope = "playlist-modify-public playlist-modify-private"
    
    # Create SpotifyOAuth instance
    sp_oauth = SpotifyOAuth(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        scope=scope,
        cache_path=None  # Don't cache, we want fresh tokens
    )
    
    # Get the authorization URL
    auth_url = sp_oauth.get_authorize_url()
    
    print(f"\n🌐 Opening Spotify authorization in your browser...")
    print(f"If it doesn't open automatically, go to:")
    print(f"{'='*60}")
    print(auth_url)
    print(f"{'='*60}")
    
    # Try to open browser automatically
    try:
        import webbrowser
        webbrowser.open(auth_url)
    except:
        pass
    
    print("\n⏳ Waiting for authorization callback...")
    print("Please complete the authorization in your browser.")
    
    # Wait for callback
    timeout = 300  # 5 minutes
    start_time = time.time()
    
    while not callback_received and (time.time() - start_time) < timeout:
        time.sleep(1)
    
    # Clean up ngrok
    if ngrok_process:
        ngrok_process.terminate()
    
    server.shutdown()
    
    if not callback_received:
        print("❌ Timeout waiting for authorization. Please try again.")
        return None
    
    try:
        # Use the authorization code to get tokens
        token_info = sp_oauth.get_access_token(authorization_code)
        
        if token_info:
            print(f"\n{'='*80}")
            print("🎉 SUCCESS! Spotify tokens obtained!")
            print(f"{'='*80}")
            
            # Test the token by creating a Spotify client
            print("🧪 Testing token by connecting to Spotify...")
            sp = spotipy.Spotify(auth=token_info['access_token'])
            user = sp.current_user()
            print(f"✅ Successfully connected as: {user['display_name']} ({user['id']})")
            
            print(f"\n📋 Add these tokens to your .env file:")
            print(f"{'='*80}")
            print(f"SPOTIFY_ACCESS_TOKEN={token_info['access_token']}")
            print(f"SPOTIFY_REFRESH_TOKEN={token_info['refresh_token']}")
            print(f"{'='*80}")
            
            # Automatically update .env file if it exists
            try:
                update_env_file(token_info['access_token'], token_info['refresh_token'])
                print("\n✅ Automatically updated .env file with new tokens!")
            except Exception as e:
                print(f"\n⚠️  Could not automatically update .env file: {e}")
                print("Please manually add the tokens above to your .env file.")
            
            return token_info
        else:
            print("❌ Failed to get tokens from Spotify")
            return None
            
    except Exception as e:
        print(f"❌ Error processing authorization: {e}")
        return None

def update_env_file(access_token, refresh_token):
    """Update .env file with new Spotify tokens"""
    env_path = '.env'
    if not os.path.exists(env_path):
        print("❌ .env file not found")
        return
    
    # Read current .env file
    with open(env_path, 'r') as f:
        lines = f.readlines()
    
    # Update tokens
    updated_lines = []
    access_updated = False
    refresh_updated = False
    
    for line in lines:
        if line.startswith('SPOTIFY_ACCESS_TOKEN='):
            updated_lines.append(f'SPOTIFY_ACCESS_TOKEN={access_token}\n')
            access_updated = True
        elif line.startswith('SPOTIFY_REFRESH_TOKEN='):
            updated_lines.append(f'SPOTIFY_REFRESH_TOKEN={refresh_token}\n')
            refresh_updated = True
        else:
            updated_lines.append(line)
    
    # Add tokens if they weren't found
    if not access_updated:
        updated_lines.append(f'SPOTIFY_ACCESS_TOKEN={access_token}\n')
    if not refresh_updated:
        updated_lines.append(f'SPOTIFY_REFRESH_TOKEN={refresh_token}\n')
    
    # Write updated .env file
    with open(env_path, 'w') as f:
        f.writelines(updated_lines)

if __name__ == "__main__":
    print("🎵 Spotify OAuth Token Generator for Telegram Mixtaper Bot")
    print("=" * 60)
    
    tokens = get_spotify_tokens()
    
    if tokens:
        print("\n✅ Token generation complete!")
        print("Don't forget to restart your bot after updating the .env file.")
    else:
        print("\n❌ Token generation failed. Please try again.")