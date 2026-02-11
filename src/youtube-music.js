import { JSDOM } from 'jsdom';

/**
 * Extract YouTube/YouTube Music links from a string.
 */
export function extractYouTubeMusicLinks(text) {
  // music.youtube.com/watch?v=
  const musicWatch = /https?:\/\/music\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{6,})([^\s]*)?/g;
  // www.youtube.com/watch?v=
  const youtubeWatch = /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{6,})([^\s]*)?/g;
  // youtu.be/<id>
  const youtuBe = /https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{6,})([^\s]*)?/g;

  const links = [];
  const patterns = [
    { re: musicWatch, kind: 'youtube_music' },
    { re: youtubeWatch, kind: 'youtube' },
    { re: youtuBe, kind: 'youtube' }
  ];

  for (const { re, kind } of patterns) {
    let match;
    while ((match = re.exec(text)) !== null) {
      links.push({
        url: match[0],
        kind,
        videoId: match[1]
      });
    }
  }

  return links;
}

/**
 * Fetch a YouTube/YouTube Music page and attempt to extract {title, artist}.
 *
 * Strategy:
 * 1) Parse JSON-LD (MusicRecording) if present.
 * 2) Fall back to <title> parsing (common: "Artist - Song - YouTube Music").
 */
export async function getYouTubeMusicTrackInfo(url) {
  try {
    const res = await fetch(url, {
      headers: {
        // Some UA helps avoid minimal responses.
        'User-Agent': 'telegram-mixtaper/1.0'
      }
    });

    if (!res.ok) {
      throw new Error(`YouTube fetch failed: ${res.status}`);
    }

    const html = await res.text();
    const dom = new JSDOM(html);
    const { document } = dom.window;

    // JSON-LD blocks
    const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const s of ldScripts) {
      const raw = s.textContent?.trim();
      if (!raw) continue;
      try {
        const data = JSON.parse(raw);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const t = item['@type'];
          // MusicRecording is typical on YouTube Music.
          if (t === 'MusicRecording' || t === 'Song') {
            const title = item.name;
            let artist = null;
            const by = item.byArtist;
            if (typeof by === 'string') artist = by;
            if (by && typeof by === 'object') {
              artist = by.name ?? null;
            }
            if (Array.isArray(by) && by[0]) {
              artist = by[0].name ?? null;
            }
            if (title) return { title, artist };
          }
          // Sometimes embedded as VideoObject
          if (t === 'VideoObject' && item.name) {
            const title = item.name;
            return { title, artist: null };
          }
        }
      } catch {
        // ignore bad JSON
      }
    }

    // Fallback: parse <title>
    const titleText = document.querySelector('title')?.textContent?.trim() ?? '';
    // Examples:
    // "Artist - Song - YouTube Music"
    // "Song - Artist - YouTube"
    const cleaned = titleText
      .replace(/-\s*YouTube Music$/i, '')
      .replace(/-\s*YouTube$/i, '')
      .trim();

    const parts = cleaned.split(' - ').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      // Prefer Artist - Title
      const artist = parts[0];
      const title = parts.slice(1).join(' - ');
      return { title, artist };
    }

    if (cleaned) return { title: cleaned, artist: null };

    return null;
  } catch (error) {
    console.error('Error extracting YouTube Music track info:', error);
    return null;
  }
}
