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
error_channel = int(os.environ.get('TELEGRAM_ERROR_CHANNEL'))

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

    async def find_spotify_links(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not update.message or not update.message.text:
            return
        
        links = self.get_spotify_links(update.message.text)
        if links:
            try:
                results = self.spotify.user_playlist_add_tracks(self.user_id, self.playlist_id, links, position=0)
                logger.info(f"Added {len(links)} tracks to playlist: {results}")
            except Exception as e:
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
    r = redis.from_url(url=url, db=0, decode_responses=True, charset='utf-8')
    return RedisTokenStore(r)

def set_default_token(store: RedisTokenStore):
    token = store.get()
    if not token:
        access_token = os.environ.get('SPOTIFY_ACCESS_TOKEN')
        refresh_token = os.environ.get('SPOTIFY_REFRESH_TOKEN')
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
    
    await application.bot.set_webhook(f"{webhook_prefix}{TOKEN}")
    logger.info("Setting webhook")
    
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

async def main():
    """Start the bot."""
    setup_application()
    
    # For local development, you can use polling instead of webhooks
    if os.environ.get('USE_POLLING', 'false').lower() == 'true':
        logger.info("Starting bot with polling...")
        await application.run_polling()
    else:
        logger.info("Bot configured for webhook mode")
        # The FastAPI app handles webhook requests

if __name__ == '__main__':
    # Setup the application when the module is imported
    setup_application()
    
    # For running locally with polling
    if os.environ.get('USE_POLLING', 'false').lower() == 'true':
        asyncio.run(main())
    else:
        # For production with webhooks, use uvicorn to run the FastAPI app
        import uvicorn
        PORT = int(os.environ.get('PORT', '8000'))
        uvicorn.run(app, host="0.0.0.0", port=PORT)