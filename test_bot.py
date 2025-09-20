import unittest
from unittest.mock import Mock, AsyncMock, patch, MagicMock
import pytest
import asyncio
from bot import PlaylistMaker, error_handler, create_token_store
from oauth2 import RefreshingSpotifyClientCredentials, RedisTokenStore, is_token_expired
from channel_store import ChannelStore
from telegram import Update, Message, Chat, User
from telegram.ext import ContextTypes
import redis
import time


class TestPlaylistMaker(unittest.TestCase):
    def setUp(self):
        self.mock_spotify = Mock()
        self.user_id = "test_user"
        self.playlist_id = "test_playlist"
        self.playlist_maker = PlaylistMaker(self.mock_spotify, self.user_id, self.playlist_id)

    def test_get_spotify_links_single_link(self):
        text = "Check out this song https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"
        links = self.playlist_maker.get_spotify_links(text)
        self.assertEqual(len(links), 1)
        self.assertIn("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", links[0])

    def test_get_spotify_links_multiple_links(self):
        text = """Here are some great songs:
        https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
        Also check this: https://open.spotify.com/track/1BxfuPKGuaTgP7aM0Bbdwr"""
        links = self.playlist_maker.get_spotify_links(text)
        self.assertEqual(len(links), 2)

    def test_get_spotify_links_no_links(self):
        text = "This is just regular text with no Spotify links"
        links = self.playlist_maker.get_spotify_links(text)
        self.assertEqual(len(links), 0)

    def test_get_spotify_links_empty_text(self):
        links = self.playlist_maker.get_spotify_links("")
        self.assertEqual(len(links), 0)
        
        links = self.playlist_maker.get_spotify_links(None)
        self.assertEqual(len(links), 0)

    def test_get_spotify_links_with_query_params(self):
        text = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123"
        links = self.playlist_maker.get_spotify_links(text)
        self.assertEqual(len(links), 1)
        self.assertIn("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", links[0])

    def test_extract_track_id_basic_url(self):
        url = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"
        track_id = self.playlist_maker.extract_track_id(url)
        self.assertEqual(track_id, "4uLU6hMCjMI75M1A2tKUQC")

    def test_extract_track_id_with_query_params(self):
        url = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123&utm_source=copy-link"
        track_id = self.playlist_maker.extract_track_id(url)
        self.assertEqual(track_id, "4uLU6hMCjMI75M1A2tKUQC")

    def test_extract_track_id_invalid_url(self):
        url = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
        track_id = self.playlist_maker.extract_track_id(url)
        self.assertIsNone(track_id)

    @pytest.mark.asyncio
    async def test_get_track_info_success(self):
        # Mock Spotify track response
        mock_track_data = {
            'name': 'Bohemian Rhapsody',
            'artists': [{'name': 'Queen'}],
            'album': {
                'name': 'A Night at the Opera',
                'images': [{'url': 'https://example.com/album-art.jpg'}]
            },
            'external_urls': {'spotify': 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'}
        }
        self.mock_spotify.track.return_value = mock_track_data
        
        track_info = await self.playlist_maker.get_track_info("4uLU6hMCjMI75M1A2tKUQC")
        
        self.assertIsNotNone(track_info)
        self.assertEqual(track_info['name'], 'Bohemian Rhapsody')
        self.assertEqual(track_info['artists'], ['Queen'])
        self.assertEqual(track_info['album'], 'A Night at the Opera')
        self.assertEqual(track_info['artwork_url'], 'https://example.com/album-art.jpg')
        self.mock_spotify.track.assert_called_once_with("4uLU6hMCjMI75M1A2tKUQC")

    @pytest.mark.asyncio
    async def test_get_track_info_failure(self):
        # Mock Spotify API failure
        self.mock_spotify.track.side_effect = Exception("API Error")
        
        track_info = await self.playlist_maker.get_track_info("invalid_id")
        
        self.assertIsNone(track_info)

    @pytest.mark.asyncio
    async def test_find_spotify_links_success(self):
        # Create mock update and context
        mock_update = Mock(spec=Update)
        mock_message = Mock(spec=Message)
        mock_message.text = "Check this out https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"
        mock_message.message_id = 456  # Add message ID for reply functionality
        mock_update.message = mock_message
        mock_update.effective_chat = Mock()
        mock_update.effective_chat.id = 12345
        
        mock_context = Mock(spec=ContextTypes.DEFAULT_TYPE)
        mock_bot = AsyncMock()
        mock_context.bot = mock_bot
        
        # Mock successful Spotify API calls
        self.mock_spotify.user_playlist_add_tracks.return_value = {"snapshot_id": "test"}
        self.mock_spotify.track.return_value = {
            'name': 'Test Song',
            'artists': [{'name': 'Test Artist'}],
            'album': {
                'name': 'Test Album',
                'images': [{'url': 'https://example.com/artwork.jpg'}]
            },
            'external_urls': {'spotify': 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'}
        }
        mock_bot.send_message.return_value = Mock(message_id=123)
        
        await self.playlist_maker.find_spotify_links(mock_update, mock_context)
        
        # Verify Spotify API was called with correct parameters
        self.mock_spotify.user_playlist_add_tracks.assert_called_once()
        args = self.mock_spotify.user_playlist_add_tracks.call_args
        self.assertEqual(args[0][0], self.user_id)  # user_id
        self.assertEqual(args[0][1], self.playlist_id)  # playlist_id
        self.assertEqual(len(args[0][2]), 1)  # links list
        self.assertEqual(args[1]['position'], 0)  # position=0
        
        # Verify track info was fetched
        self.mock_spotify.track.assert_called_once_with("4uLU6hMCjMI75M1A2tKUQC")
        
        # Verify bot sent photo with caption (combined track info and artwork)
        self.assertEqual(mock_bot.send_photo.call_count, 1)  # Photo with caption
        
        # Verify the photo was sent as a reply
        photo_call_args = mock_bot.send_photo.call_args
        self.assertEqual(photo_call_args[1]['reply_to_message_id'], mock_message.message_id)
        self.assertIn('Test Song', photo_call_args[1]['caption'])
        self.assertIn('Test Artist', photo_call_args[1]['caption'])

    @pytest.mark.asyncio
    async def test_find_spotify_links_multiple_tracks(self):
        # Create mock update with multiple Spotify links
        mock_update = Mock(spec=Update)
        mock_message = Mock(spec=Message)
        mock_message.text = """Check these songs:
        https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
        https://open.spotify.com/track/1BxfuPKGuaTgP7aM0Bbdwr"""
        mock_message.message_id = 456
        mock_update.message = mock_message
        mock_update.effective_chat = Mock()
        mock_update.effective_chat.id = 12345
        
        mock_context = Mock(spec=ContextTypes.DEFAULT_TYPE)
        mock_bot = AsyncMock()
        mock_context.bot = mock_bot
        
        # Mock successful Spotify API calls
        self.mock_spotify.user_playlist_add_tracks.return_value = {"snapshot_id": "test"}
        
        # Mock different tracks for each call
        track_responses = [
            {
                'name': 'Track One',
                'artists': [{'name': 'Artist One'}],
                'album': {'name': 'Album One', 'images': [{'url': 'https://example.com/art1.jpg'}]},
                'external_urls': {'spotify': 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'}
            },
            {
                'name': 'Track Two',
                'artists': [{'name': 'Artist Two'}],
                'album': {'name': 'Album Two', 'images': [{'url': 'https://example.com/art2.jpg'}]},
                'external_urls': {'spotify': 'https://open.spotify.com/track/1BxfuPKGuaTgP7aM0Bbdwr'}
            }
        ]
        self.mock_spotify.track.side_effect = track_responses
        
        await self.playlist_maker.find_spotify_links(mock_update, mock_context)
        
        # Verify playlist was updated
        self.mock_spotify.user_playlist_add_tracks.assert_called_once()
        
        # Verify track info was fetched for both tracks
        self.assertEqual(self.mock_spotify.track.call_count, 2)
        self.mock_spotify.track.assert_any_call("4uLU6hMCjMI75M1A2tKUQC")
        self.mock_spotify.track.assert_any_call("1BxfuPKGuaTgP7aM0Bbdwr")
        
        # Verify separate reply messages were sent for each track
        self.assertEqual(mock_bot.send_photo.call_count, 2)
        
        # Verify both messages are replies to the original message
        for call in mock_bot.send_photo.call_args_list:
            self.assertEqual(call[1]['reply_to_message_id'], 456)

    @pytest.mark.asyncio
    async def test_find_spotify_links_no_message(self):
        mock_update = Mock(spec=Update)
        mock_update.message = None
        mock_context = Mock(spec=ContextTypes.DEFAULT_TYPE)
        
        await self.playlist_maker.find_spotify_links(mock_update, mock_context)
        
        # Should not call Spotify API
        self.mock_spotify.user_playlist_add_tracks.assert_not_called()

    @pytest.mark.asyncio
    async def test_find_spotify_links_api_error(self):
        mock_update = Mock(spec=Update)
        mock_message = Mock(spec=Message)
        mock_message.text = "Check this out https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"
        mock_update.message = mock_message
        
        mock_context = Mock(spec=ContextTypes.DEFAULT_TYPE)
        mock_bot = AsyncMock()
        mock_context.bot = mock_bot
        
        # Mock Spotify API error
        self.mock_spotify.user_playlist_add_tracks.side_effect = Exception("API Error")
        
        with patch('bot.error_channel', 12345):
            await self.playlist_maker.find_spotify_links(mock_update, mock_context)
        
        # Verify error message was sent
        mock_bot.send_message.assert_called_once_with(12345, 'Error adding tracks: API Error')


class TestOAuth2(unittest.TestCase):
    def test_is_token_expired_not_expired(self):
        future_time = int(time.time()) + 3600  # 1 hour from now
        token_info = {'expires_at': future_time}
        self.assertFalse(is_token_expired(token_info))

    def test_is_token_expired_expired(self):
        past_time = int(time.time()) - 3600  # 1 hour ago
        token_info = {'expires_at': past_time}
        self.assertTrue(is_token_expired(token_info))

    def test_is_token_expired_soon(self):
        soon_time = int(time.time()) + 30  # 30 seconds from now (less than 60 second buffer)
        token_info = {'expires_at': soon_time}
        self.assertTrue(is_token_expired(token_info))

    def test_redis_token_store_put_get(self):
        mock_redis = Mock()
        mock_redis.hgetall.return_value = {'access_token': 'test_token', 'refresh_token': 'test_refresh'}
        
        store = RedisTokenStore(mock_redis)
        
        # Test put
        token = {'access_token': 'new_token', 'refresh_token': 'new_refresh'}
        store.put(token)
        mock_redis.hset.assert_called_once_with('default.token', mapping=token)
        
        # Test get
        result = store.get()
        mock_redis.hgetall.assert_called_with('default.token')
        self.assertEqual(result['access_token'], 'test_token')

    @patch('oauth2.requests.post')
    def test_refresh_access_token_success(self, mock_post):
        mock_redis = Mock()
        store = RedisTokenStore(mock_redis)
        
        # Mock successful refresh response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'access_token': 'new_access_token',
            'expires_in': 3600
        }
        mock_post.return_value = mock_response
        
        credentials = RefreshingSpotifyClientCredentials(
            store, 
            client_id='test_id', 
            client_secret='test_secret'
        )
        
        result = credentials.refresh_access_token('test_refresh_token')
        
        self.assertIsNotNone(result)
        self.assertEqual(result['access_token'], 'new_access_token')
        self.assertIn('expires_at', result)
        self.assertEqual(result['refresh_token'], 'test_refresh_token')

    @patch('oauth2.requests.post')
    def test_refresh_access_token_failure(self, mock_post):
        mock_redis = Mock()
        store = RedisTokenStore(mock_redis)
        
        # Mock failed refresh response
        mock_response = Mock()
        mock_response.status_code = 400
        mock_response.reason = 'Bad Request'
        mock_post.return_value = mock_response
        
        credentials = RefreshingSpotifyClientCredentials(
            store, 
            client_id='test_id', 
            client_secret='test_secret'
        )
        
        result = credentials.refresh_access_token('invalid_refresh_token')
        
        self.assertIsNone(result)


class TestChannelStore(unittest.TestCase):
    def setUp(self):
        self.mock_redis = Mock()
        self.channel_store = ChannelStore(self.mock_redis)

    def test_set_and_get_playlist_id(self):
        channel_id = "test_channel"
        playlist_id = "test_playlist"
        
        # Test set
        self.channel_store.set_playlist_id(channel_id, playlist_id)
        self.mock_redis.set.assert_called_once_with(f"channel_playlist:{channel_id}", playlist_id)
        
        # Test get
        self.mock_redis.get.return_value = playlist_id.encode('utf-8')
        result = self.channel_store.get_playlist_id(channel_id)
        self.mock_redis.get.assert_called_with(f"channel_playlist:{channel_id}")
        self.assertEqual(result, playlist_id)

    def test_get_playlist_id_not_found(self):
        self.mock_redis.get.return_value = None
        result = self.channel_store.get_playlist_id("nonexistent_channel")
        self.assertIsNone(result)

    def test_remove_channel(self):
        channel_id = "test_channel"
        self.channel_store.remove_channel(channel_id)
        self.mock_redis.delete.assert_called_once_with(f"channel_playlist:{channel_id}")


class TestErrorHandler(unittest.TestCase):
    @pytest.mark.asyncio
    async def test_error_handler_with_channel(self):
        mock_update = Mock(spec=Update)
        mock_context = Mock(spec=ContextTypes.DEFAULT_TYPE)
        mock_context.error = Exception("Test error")
        mock_bot = AsyncMock()
        mock_context.bot = mock_bot
        
        with patch('bot.error_channel', 12345):
            await error_handler(mock_update, mock_context)
        
        mock_bot.send_message.assert_called_once()
        args = mock_bot.send_message.call_args[0]
        self.assertEqual(args[0], 12345)
        self.assertIn("Test error", args[1])

    @pytest.mark.asyncio
    async def test_error_handler_send_message_fails(self):
        mock_update = Mock(spec=Update)
        mock_context = Mock(spec=ContextTypes.DEFAULT_TYPE)
        mock_context.error = Exception("Test error")
        mock_bot = AsyncMock()
        mock_bot.send_message.side_effect = Exception("Send failed")
        mock_context.bot = mock_bot
        
        with patch('bot.error_channel', 12345):
            # Should not raise exception even if send_message fails
            await error_handler(mock_update, mock_context)


if __name__ == '__main__':
    # Run async tests
    pytest.main([__file__, "-v"])