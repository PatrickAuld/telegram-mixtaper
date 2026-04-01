# telegram-mixtaper
Telegram bot that monitors channels for music links and adds tracks to a Spotify playlist.

Currently supports:
- Spotify links (`open.spotify.com/...` and `spotify.link/...`)
- YouTube / YouTube Music links (resolves title/artist from the page, searches Spotify, and adds the best match)

Commands:
- `/link` (DM only): link your Spotify account.
- `/unlink` (DM only): unlink your Spotify account.
- `/linkyoutubemusic` (DM only): link your YouTube account (Google OAuth).
