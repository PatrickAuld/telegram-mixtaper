import redis

class ChannelStore:
    def __init__(self, redis_client):
        self.redis = redis_client
        self.key_prefix = 'channel_playlist:'

    def get_playlist_id(self, channel_id):
        """Get playlist ID for a channel, returns None if not found"""
        return self.redis.get(f"{self.key_prefix}{channel_id}")

    def set_playlist_id(self, channel_id, playlist_id):
        """Set playlist ID for a channel"""
        self.redis.set(f"{self.key_prefix}{channel_id}", playlist_id)

    def remove_channel(self, channel_id):
        """Remove channel mapping"""
        self.redis.delete(f"{self.key_prefix}{channel_id}") 