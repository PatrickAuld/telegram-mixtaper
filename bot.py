#!/usr/bin/env python
# -*- coding: utf-8 -*-

from telegram.ext import Updater, CommandHandler, MessageHandler, Filters, CallbackQueryHandler
import logging
import re
import spotipy
import spotipy.util as util
import os
from oauth2 import RefreshingSpotifyClientCredentials, InMemTokenStore, RedisTokenStore
import urllib.parse
import redis

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

    def find_spotify_links(self, bot, update):
        links = self.get_spotify_links(update.message.text)
        if not links:
            return

        added_tracks = []
        chat_id = update.message.chat_id

        for link in links:
            try:
                track = self.spotify.track(link)
            except Exception:
                logger.exception("Unable to fetch metadata for link %s", link)
                continue

            artist_names = ", ".join(artist["name"] for artist in track.get("artists", []))
            track_name = track.get("name", "Unknown track")
            caption_lines = [f"{artist_names} - {track_name}", link]

            image_url = None
            images = track.get("album", {}).get("images", [])
            if images:
                # Pick the first image, which is the largest
                image_url = images[0].get("url")

            try:
                if image_url:
                    bot.send_photo(chat_id=chat_id, photo=image_url, caption="\n".join(caption_lines))
                else:
                    bot.send_message(chat_id=chat_id, text="\n".join(caption_lines))
            except Exception:
                logger.exception("Unable to send message for track %s", link)

            added_tracks.append(link)

        if added_tracks:
            try:
                results = self.spotify.user_playlist_add_tracks(self.user_id, self.playlist_id, added_tracks, position=0)
                logger.info(results)
            except Exception:
                logger.exception("Unable to add tracks to playlist")


def error(bot, update, error):
    bot.send_message(error_channel, 'Update "{update}\n\n caused error "{error}"'.format(update=update, error=error))
    logger.warning('Update "%s" caused error "%s"', update, error)

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

def main():
    """Start the bot."""

    sp = get_spotify_client()
    user_id = os.environ.get('SPOTIFY_USER_ID')
    playlist_id = os.environ.get('SPOTIFY_PLAYLIST_ID')
    playlister = PlaylistMaker(sp, user_id, playlist_id)

    TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
    PORT = int(os.environ.get('PORT', '8443'))
    updater = Updater(TOKEN)

    dp = updater.dispatcher
    dp.add_handler(MessageHandler(Filters.all, playlister.find_spotify_links))
    dp.add_error_handler(error)

    updater.start_webhook(listen="0.0.0.0",
                        port=PORT,
                        url_path=TOKEN)
    logger.info("Setting webhook")
    webhook_prefix = os.environ.get('WEBHOOK_DOMAIN')
    updater.bot.set_webhook(webhook_prefix + TOKEN)
    logger.info("Ideling")
    updater.idle()

if __name__ == '__main__':
    main()
