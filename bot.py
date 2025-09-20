#!/usr/bin/env python
# -*- coding: utf-8 -*-

from telegram import Update
from telegram.ext import Application, MessageHandler, filters, ContextTypes
import logging
import re
import spotipy
import os
from oauth2 import RefreshingSpotifyClientCredentials, RedisTokenStore
import redis
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from http import HTTPStatus

# Enable logging
logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                    level=logging.INFO)

logger = logging.getLogger(__name__)
spotify_link_regex = r".*(https?://open\.spotify\.com/track/(?:[^?\s()<>{}\[\]]+|\([^\s()]*?\([^\s()]+\)[^\s()]*?\)|\([^\s]+?\))+)"
error_channel_str = os.environ.get('TELEGRAM_ERROR_CHANNEL')
error_channel = int(error_channel_str) if error_channel_str else None

class PlaylistMaker(object):

    def __init__(self, spotify_client, user_id, playlist_id):
        self.spotify = spotify_client
        self.user_id = user_id
        self.playlist_id = playlist_id

    def get_spotify_links(self, text):
        links = []
        if not text:
            return links
        lines = text.split("\n")
        for line in lines:
            words = line.split()
            for word in words:
                url_search = re.match(spotify_link_regex, word)
                if not url_search:
                    continue
                group0 = url_search.group(0)
                if group0:
                    links.append(group0)
        return links

    def extract_track_id(self, spotify_url):
        """Extract track ID from Spotify URL"""
        # Handle both formats: 
        # https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
        # https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=...
        track_match = re.search(r'/track/([a-zA-Z0-9]+)', spotify_url)
        if track_match:
            return track_match.group(1)
        return None

    async def get_track_info(self, track_id):
        """Get track information from Spotify API"""
        try:
            track = self.spotify.track(track_id)
            return {
                'name': track['name'],
                'artists': [artist['name'] for artist in track['artists']],
                'album': track['album']['name'],
                'artwork_url': track['album']['images'][0]['url'] if track['album']['images'] else None,
                'external_url': track['external_urls']['spotify']
            }
        except Exception as e:
            logger.error(f"Error getting track info for {track_id}: {e}")
            return None

    async def post_track_info(self, update: Update, context: ContextTypes.DEFAULT_TYPE, track_info):
        """Post track information as a reply to the original message with artwork"""
        if not track_info:
            return
        
        artists_str = ", ".join(track_info['artists'])
        caption = f"🎵 **{track_info['name']}**\n👤 {artists_str}\n💿 {track_info['album']}"
        
        try:
            # Send photo with caption if artwork is available
            if track_info['artwork_url']:
                try:
                    await context.bot.send_photo(
                        chat_id=update.effective_chat.id,
                        photo=track_info['artwork_url'],
                        caption=caption,
                        parse_mode='Markdown',
                        reply_to_message_id=update.message.message_id
                    )
                    return
                except Exception as e:
                    logger.warning(f"Could not send photo with caption: {e}")
            
            # Fallback: send text message only if photo failed or no artwork
            await context.bot.send_message(
                chat_id=update.effective_chat.id,
                text=caption,
                parse_mode='Markdown',
                reply_to_message_id=update.message.message_id
            )
                    
        except Exception as e:
            logger.error(f"Error posting track info: {e}")
            # Final fallback without markdown if formatting fails
            try:
                fallback_message = f"🎵 {track_info['name']}\n👤 {artists_str}\n💿 {track_info['album']}"
                await context.bot.send_message(
                    chat_id=update.effective_chat.id,
                    text=fallback_message,
                    reply_to_message_id=update.message.message_id
                )
            except Exception as fallback_error:
                logger.error(f"Error with fallback message: {fallback_error}")

    async def find_spotify_links(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not update.message or not update.message.text:
            return
        
        links = self.get_spotify_links(update.message.text)
        if links:
            try:
                # Add tracks to playlist
                results = self.spotify.user_playlist_add_tracks(self.user_id, self.playlist_id, links, position=0)
                logger.info(f"Added {len(links)} tracks to playlist: {results}")
                
                # Post track information for each link
                for link in links:
                    track_id = self.extract_track_id(link)
                    if track_id:
                        track_info = await self.get_track_info(track_id)
                        if track_info:
                            await self.post_track_info(update, context, track_info)
                        else:
                            logger.warning(f"Could not get track info for {track_id}")
                    else:
                        logger.warning(f"Could not extract track ID from {link}")
                        
            except Exception as e:
                error_msg = str(e)
                if "Invalid access token" in error_msg:
                    logger.error("Spotify access token is invalid. Please regenerate tokens using get_oauth_tokens.py")
                    if context.bot and error_channel:
                        await context.bot.send_message(error_channel, 'Spotify access token is invalid. Please regenerate tokens.')
                else:
                    logger.error(f"Error adding tracks to playlist: {e}")
                    if context.bot and error_channel:
                        await context.bot.send_message(error_channel, f'Error adding tracks: {e}')


async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    error = context.error
    logger.warning('Update "%s" caused error "%s"', update, error)
    try:
        if error_channel:
            await context.bot.send_message(error_channel, f'Update "{update}"\n\ncaused error "{error}"')
    except Exception as e:
        logger.error(f"Failed to send error message: {e}")

def get_spotify_client():
    store = create_token_store()
    set_default_token(store)
    client_id = os.environ.get('SPOTIFY_CLIENT_ID')
    client_secret = os.environ.get('SPOTIFY_CLIENT_SECRET')
    spotify_credentals = RefreshingSpotifyClientCredentials(store, client_id=client_id, client_secret=client_secret)
    return spotipy.Spotify(client_credentials_manager=spotify_credentals)

def create_token_store():
    url = os.environ.get('REDIS_URL')
    r = redis.from_url(url=url, db=0, decode_responses=True)
    return RedisTokenStore(r)

def set_default_token(store: RedisTokenStore):
    token = store.get()
    if not token or not token.get('access_token') or not token.get('refresh_token'):
        access_token = os.environ.get('SPOTIFY_ACCESS_TOKEN')
        refresh_token = os.environ.get('SPOTIFY_REFRESH_TOKEN')
        
        # If no tokens are provided, skip setting default token
        # This will force the RefreshingSpotifyClientCredentials to use client credentials flow
        if not access_token or not refresh_token:
            logger.warning("No Spotify access/refresh tokens provided. Bot will not be able to add tracks to playlists.")
            logger.warning("Please set SPOTIFY_ACCESS_TOKEN and SPOTIFY_REFRESH_TOKEN in your .env file.")
            logger.warning("Run 'python get_spotify_tokens.py' to obtain these tokens.")
            return
            
        token = {'expires_at': 0, 'access_token': access_token, 'refresh_token': refresh_token}
        store.put(token)

# Global variables for the application
application = None
playlister = None

@asynccontextmanager
async def lifespan(_: FastAPI):
    global application
    TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
    webhook_prefix = os.environ.get('WEBHOOK_DOMAIN')
    
    if webhook_prefix:
        await application.bot.set_webhook(f"{webhook_prefix}{TOKEN}")
        logger.info("Setting webhook")
    else:
        logger.info("No webhook domain configured, skipping webhook setup")
    
    async with application:
        await application.start()
        logger.info("Bot started")
        yield
        await application.stop()
        logger.info("Bot stopped")

# Initialize FastAPI app
app = FastAPI(lifespan=lifespan)

@app.post("/")
async def process_update(request: Request):
    req = await request.json()
    update = Update.de_json(req, application.bot)
    await application.process_update(update)
    return Response(status_code=HTTPStatus.OK)

@app.get("/")
async def health_check():
    return {"status": "ok", "message": "Telegram Mixtaper Bot is running"}

def setup_application():
    """Setup the bot application."""
    global application, playlister
    
    sp = get_spotify_client()
    user_id = os.environ.get('SPOTIFY_USER_ID')
    playlist_id = os.environ.get('SPOTIFY_PLAYLIST_ID')
    playlister = PlaylistMaker(sp, user_id, playlist_id)

    TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
    
    application = Application.builder().token(TOKEN).build()
    
    # Add handlers
    application.add_handler(MessageHandler(filters.ALL, playlister.find_spotify_links))
    application.add_error_handler(error_handler)
    
    logger.info("Application setup complete")

if __name__ == '__main__':
    # Setup the application
    setup_application()
    
    # For running locally with polling
    if os.environ.get('USE_POLLING', 'false').lower() == 'true':
        logger.info("Starting bot with polling...")
        # Use the run_polling method which handles event loops properly
        application.run_polling()
    else:
        # For production with webhooks, use uvicorn to run the FastAPI app
        import uvicorn
        PORT = int(os.environ.get('PORT', '8000'))
        uvicorn.run(app, host="0.0.0.0", port=PORT)