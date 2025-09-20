#!/usr/bin/env python3
import base64, json, os, random, socket, string, sys, time, urllib.parse, webbrowser, subprocess, signal, http.server, threading, requests

CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID")
CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET")
SCOPE = os.environ.get("SPOTIFY_SCOPE", "user-read-email playlist-read-private")
PORT = int(os.environ.get("PORT", "3000"))
REDIRECT_PATH = os.environ.get("REDIRECT_PATH", "/callback")

if not CLIENT_ID or not CLIENT_SECRET:
    print("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET"); sys.exit(1)

def pick_free_port(p):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", p)); return p
        except OSError:
            s.bind(("127.0.0.1", 0)); return s.getsockname()[1]

PORT = pick_free_port(PORT)

ngrok = subprocess.Popen(["ngrok", "http", str(PORT)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
def stop_ngrok():
    try: ngrok.terminate()
    except: pass
def wait_for_tunnel():
    for _ in range(60):
        try:
            r = requests.get("http://127.0.0.1:4040/api/tunnels", timeout=1)
            for t in r.json().get("tunnels", []):
                if t.get("proto") == "https":
                    return t["public_url"]
        except Exception:
            pass
        time.sleep(0.5)
    print("Failed to get ngrok tunnel"); stop_ngrok(); sys.exit(1)

public_url = wait_for_tunnel()
redirect_uri = public_url + REDIRECT_PATH
print("\nRedirect URI:\n" + redirect_uri + "\n")
input("Add this Redirect URI in Spotify → Dashboard → Your App → Edit Settings, then press Enter... ")

state = "".join(random.choice(string.ascii_letters + string.digits) for _ in range(32))
params = {
    "client_id": CLIENT_ID,
    "response_type": "code",
    "redirect_uri": redirect_uri,
    "scope": SCOPE,
    "state": state,
    "show_dialog": "false",
}
auth_url = "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode(params)
print("\nOpening browser for consent...\n")
webbrowser.open(auth_url)

class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "LocalAuth/1.0"
    code = None
    got_state = None
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != urllib.parse.urlparse(REDIRECT_PATH).path:
            self.send_response(404); self.end_headers(); return
        q = urllib.parse.parse_qs(parsed.query)
        self.__class__.code = q.get("code", [None])[0]
        self.__class__.got_state = q.get("state", [None])[0]
        self.send_response(200)
        self.send_header("Content-Type","text/plain")
        self.end_headers()
        self.wfile.write(b"You can close this tab and return to the terminal.")
    def log_message(self, *args): pass

httpd = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
srv = threading.Thread(target=httpd.handle_request, daemon=True); srv.start()

for _ in range(600):
    if Handler.code: break
    time.sleep(0.1)

if not Handler.code:
    print("No authorization code received"); httpd.server_close(); stop_ngrok(); sys.exit(1)
if Handler.got_state != state:
    print("State mismatch"); httpd.server_close(); stop_ngrok(); sys.exit(1)

token_url = "https://accounts.spotify.com/api/token"
basic = base64.b64encode((CLIENT_ID + ":" + CLIENT_SECRET).encode()).decode()
data = {
    "grant_type": "authorization_code",
    "code": Handler.code,
    "redirect_uri": redirect_uri,
}
hdrs = {"Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded"}
resp = requests.post(token_url, headers=hdrs, data=data, timeout=10)
if resp.status_code != 200:
    print("Token exchange failed:", resp.status_code, resp.text)
    httpd.server_close(); stop_ngrok(); sys.exit(1)

tok = resp.json()
access = tok["access_token"]
refresh = tok.get("refresh_token")
expires_in = tok.get("expires_in")

print("\nSPOTIFY_ACCESS_TOKEN=" + access)
print("SPOTIFY_REFRESH_TOKEN=" + (refresh or ""))
print("EXPIRES_IN_SECONDS=" + str(expires_in))
print("\nTo refresh later:")
print("curl -s -X POST https://accounts.spotify.com/api/token \\")
print("  -H 'Authorization: Basic " + basic + "' \\")
print("  -d grant_type=refresh_token -d refresh_token=" + (refresh or "") + " | jq -r '.access_token'")

httpd.server_close()
stop_ngrok()