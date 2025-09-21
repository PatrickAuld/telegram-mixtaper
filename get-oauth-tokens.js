#!/usr/bin/env node

/**
 * Spotify OAuth Token Generator (JavaScript version)
 * Converts Python get_oauth_tokens.py to Node.js for consistency with Cloudflare Workers
 */

import { spawn } from 'child_process';
import { createServer } from 'http';
import { randomBytes } from 'crypto';
import { Socket } from 'net';
import { parse } from 'url';
import open from 'open';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SCOPE = process.env.SPOTIFY_SCOPE || "user-read-email playlist-read-private playlist-modify-public playlist-modify-private";
const PORT_START = parseInt(process.env.PORT || "3000");
const REDIRECT_PATH = process.env.REDIRECT_PATH || "/callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET");
    process.exit(1);
}

/**
 * Find an available port starting from the preferred port
 */
function findFreePort(startPort) {
    return new Promise((resolve, reject) => {
        const socket = new Socket();
        
        socket.connect(startPort, '127.0.0.1', () => {
            socket.destroy();
            // Port is in use, try next port
            findFreePort(startPort + 1).then(resolve).catch(reject);
        });
        
        socket.on('error', () => {
            // Port is free
            resolve(startPort);
        });
        
        socket.setTimeout(100, () => {
            socket.destroy();
            resolve(startPort);
        });
    });
}

/**
 * Start ngrok tunnel and wait for public URL
 */
function startNgrok(port) {
    return new Promise((resolve, reject) => {
        console.log(`Starting ngrok tunnel on port ${port}...`);
        
        const ngrok = spawn('ngrok', ['http', port.toString()], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let resolved = false;
        
        // Function to stop ngrok
        const stopNgrok = () => {
            try {
                ngrok.kill('SIGTERM');
            } catch (error) {
                // Ignore errors when stopping
            }
        };
        
        // Wait for tunnel to be ready
        const checkTunnel = async () => {
            for (let i = 0; i < 60; i++) {
                try {
                    const response = await fetch('http://127.0.0.1:4040/api/tunnels');
                    const data = await response.json();
                    
                    for (const tunnel of data.tunnels || []) {
                        if (tunnel.proto === 'https') {
                            if (!resolved) {
                                resolved = true;
                                resolve({ url: tunnel.public_url, stop: stopNgrok });
                            }
                            return;
                        }
                    }
                } catch (error) {
                    // Keep trying
                }
                
                await new Promise(r => setTimeout(r, 500));
            }
            
            if (!resolved) {
                stopNgrok();
                reject(new Error('Failed to get ngrok tunnel after 30 seconds'));
            }
        };
        
        // Start checking for tunnel
        setTimeout(checkTunnel, 1000);
        
        ngrok.on('error', (error) => {
            if (!resolved) {
                resolved = true;
                reject(new Error(`Failed to start ngrok: ${error.message}`));
            }
        });
    });
}

/**
 * Generate secure random state parameter
 */
function generateState() {
    return randomBytes(16).toString('hex');
}

/**
 * Start HTTP server to handle OAuth callback
 */
function startCallbackServer(port, redirectPath) {
    return new Promise((resolve, reject) => {
        let authCode = null;
        let receivedState = null;
        let serverResolved = false;
        
        const server = createServer((req, res) => {
            const parsedUrl = parse(req.url, true);
            
            if (parsedUrl.pathname !== redirectPath) {
                res.writeHead(404);
                res.end('Not Found');
                return;
            }
            
            authCode = parsedUrl.query.code;
            receivedState = parsedUrl.query.state;
            
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Authorization successful! You can close this tab and return to the terminal.');
            
            if (!serverResolved) {
                serverResolved = true;
                resolve({ code: authCode, state: receivedState, server });
            }
        });
        
        server.listen(port, '127.0.0.1', () => {
            console.log(`Callback server listening on http://127.0.0.1:${port}`);
        });
        
        server.on('error', (error) => {
            if (!serverResolved) {
                serverResolved = true;
                reject(error);
            }
        });
        
        // Timeout after 10 minutes
        setTimeout(() => {
            if (!serverResolved) {
                serverResolved = true;
                server.close();
                reject(new Error('Timeout waiting for authorization'));
            }
        }, 600000);
    });
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(code, redirectUri) {
    const tokenUrl = 'https://accounts.spotify.com/api/token';
    const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
    });
    
    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
}

/**
 * Prompt user for input
 */
function promptUser(question) {
    return new Promise((resolve) => {
        process.stdout.write(question);
        process.stdin.once('data', (data) => {
            resolve(data.toString().trim());
        });
    });
}

/**
 * Main OAuth flow
 */
async function main() {
    console.log('🚀 Spotify OAuth Token Generator (JavaScript)\n');
    
    try {
        // Step 1: Find free port
        const port = await findFreePort(PORT_START);
        console.log(`✅ Using port: ${port}`);
        
        // Step 2: Start ngrok tunnel
        const { url: publicUrl, stop: stopNgrok } = await startNgrok(port);
        const redirectUri = publicUrl + REDIRECT_PATH;
        
        console.log(`✅ Ngrok tunnel: ${publicUrl}`);
        console.log(`\n📋 Redirect URI:\n${redirectUri}\n`);
        
        // Step 3: Prompt user to configure redirect URI
        await promptUser('Add this Redirect URI in Spotify → Dashboard → Your App → Edit Settings, then press Enter... ');
        
        // Step 4: Generate state and build authorization URL
        const state = generateState();
        const authParams = new URLSearchParams({
            client_id: CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: SCOPE,
            state: state,
            show_dialog: 'false'
        });
        
        const authUrl = `https://accounts.spotify.com/authorize?${authParams}`;
        
        // Step 5: Start callback server
        const serverPromise = startCallbackServer(port, REDIRECT_PATH);
        
        // Step 6: Open browser for user consent
        console.log('\n🌐 Opening browser for consent...\n');
        await open(authUrl);
        
        // Step 7: Wait for authorization callback
        console.log('⏳ Waiting for authorization...');
        const { code, state: receivedState, server } = await serverPromise;
        
        // Step 8: Validate state parameter
        if (receivedState !== state) {
            throw new Error('State parameter mismatch - possible CSRF attack');
        }
        
        if (!code) {
            throw new Error('No authorization code received');
        }
        
        console.log('✅ Authorization code received');
        
        // Step 9: Exchange code for tokens
        console.log('🔄 Exchanging code for tokens...');
        const tokens = await exchangeCodeForToken(code, redirectUri);
        
        // Step 10: Display results
        const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
        
        console.log('\n🎉 Success! OAuth tokens received:\n');
        console.log(`SPOTIFY_ACCESS_TOKEN=${tokens.access_token}`);
        console.log(`SPOTIFY_REFRESH_TOKEN=${tokens.refresh_token || ''}`);
        console.log(`EXPIRES_IN_SECONDS=${tokens.expires_in || ''}`);
        
        console.log('\n📝 To refresh tokens later:');
        console.log('curl -s -X POST https://accounts.spotify.com/api/token \\');
        console.log(`  -H 'Authorization: Basic ${basicAuth}' \\`);
        console.log(`  -d grant_type=refresh_token -d refresh_token=${tokens.refresh_token || ''} | jq -r '.access_token'`);
        
        console.log('\n💡 Add these to your .env file for development');
        
        // Cleanup
        server.close();
        stopNgrok();
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
    console.log('\n\n🛑 Process interrupted by user');
    process.exit(0);
});

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}

export { main as getOAuthTokens };