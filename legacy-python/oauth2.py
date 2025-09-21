
import base64
import requests
import os
import json
import time
import sys
import urllib.parse


class SpotifyOauthError(Exception):
    pass


def _make_authorization_headers(client_id, client_secret):
    auth_header = base64.b64encode((client_id + ':' + client_secret).encode('ascii'))
    return {'Authorization': 'Basic %s' % auth_header.decode('ascii')}


def is_token_expired(token_info):
    now = int(time.time())
    return int(token_info.get('expires_at', '0')) - now < 60

class InMemTokenStore(object):
    def __init__(self, token_info):
        self.token_info = token_info
        
    def get(self):
        return self.token_info
    
    def put(self, token):
        self.token_info = token

class RedisTokenStore(object):
    def __init__(self, redis):
        self.redis = redis
        
    def get(self):
        token_data = self.redis.hgetall('default.token')
        # Convert bytes keys/values to strings if needed
        if token_data and isinstance(list(token_data.keys())[0], bytes):
            return {k.decode('utf-8'): v.decode('utf-8') for k, v in token_data.items()}
        return token_data
    
    def put(self, token):
        # Use hset with mapping for modern redis-py
        self.redis.hset('default.token', mapping=token)

class RefreshingSpotifyClientCredentials(object):
    OAUTH_TOKEN_URL = 'https://accounts.spotify.com/api/token'

    def __init__(self, token_store, client_id=None, client_secret=None, proxies=None):
        """
        You can either provid a client_id and client_secret to the
        constructor or set SPOTIPY_CLIENT_ID and SPOTIPY_CLIENT_SECRET
        environment variables
        """
        if not client_id:
            client_id = os.getenv('SPOTIPY_CLIENT_ID')

        if not client_secret:
            client_secret = os.getenv('SPOTIPY_CLIENT_SECRET')

        if not client_id:
            raise SpotifyOauthError('No client id')

        if not client_secret:
            raise SpotifyOauthError('No client secret')

        self.token_store = token_store
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_info = None
        self.proxies = proxies

    def get_access_token(self):
        """
        If a valid access token is in memory, returns it
        Else feches a new token and returns it
        """
        token_info = self.token_store.get()
        if token_info and not is_token_expired(token_info):
            return token_info['access_token']

        if is_token_expired(token_info):
            print("Refreshing OAuth2 Token")
            token_info = self.refresh_access_token(token_info['refresh_token'])
            if token_info:
                print("Storing new OAuth2 Tokens")
                self.token_store.put(token_info)
            else:
                print("Failed to refresh token")
                return None
        
        return token_info['access_token']

    def _request_access_token(self):
        """Gets client credentials access token """
        payload = { 'grant_type': 'client_credentials'}

        headers = _make_authorization_headers(self.client_id, self.client_secret)

        response = requests.post(self.OAUTH_TOKEN_URL, data=payload,
            headers=headers, verify=True, proxies=self.proxies)
        if response.status_code != 200:
            raise SpotifyOauthError(response.reason)
        token_info = response.json()
        return token_info

    def is_token_expired(self, token_info):
        return is_token_expired(token_info)

    def _add_custom_values_to_token_info(self, token_info):
        """
        Store some values that aren't directly provided by a Web API
        response.
        """
        token_info['expires_at'] = int(time.time()) + token_info['expires_in']
        return token_info

    def refresh_access_token(self, refresh_token):
        payload = { 'refresh_token': refresh_token,
                   'grant_type': 'refresh_token'}

        headers = self._make_authorization_headers()

        response = requests.post(self.OAUTH_TOKEN_URL, data=payload,
            headers=headers, proxies=self.proxies)
        if response.status_code != 200:
            if False:  # debugging code
                print('headers', headers)
                print('request', response.url)
            self._warn("couldn't refresh token: code:%d reason:%s" \
                % (response.status_code, response.reason))
            return None
        token_info = response.json()
        print(token_info)
        token_info = self._add_custom_values_to_token_info(token_info)
        if 'refresh_token' not in token_info:
            token_info['refresh_token'] = refresh_token
        return token_info

    def _add_custom_values_to_token_info(self, token_info):
        '''
        Store some values that aren't directly provided by a Web API
        response.
        '''
        token_info['expires_at'] = int(time.time()) + token_info['expires_in']
        return token_info
    
    def _make_authorization_headers(self):
        return _make_authorization_headers(self.client_id, self.client_secret)

    def _warn(self, msg):
        print('warning:' + msg, file=sys.stderr)