#!/usr/bin/env node

/**
 * Extract Spotify track links from Telegram HTML export
 * Deduplicates and maintains chronological order (oldest first)
 */

import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';

function extractSpotifyLinks(htmlFile) {
    try {
        // Read the HTML file
        const htmlContent = readFileSync(htmlFile, 'utf8');
        
        // Parse HTML with JSDOM
        const dom = new JSDOM(htmlContent);
        const document = dom.window.document;
        
        // Find all anchor tags with Spotify links (tracks, albums, playlists)
        const links = document.querySelectorAll('a[href*="open.spotify.com/"]');
        
        const spotifyLinks = [];
        const seenIds = new Set();
        
        // Process links in document order (oldest first in Telegram exports)
        for (const link of links) {
            const href = link.href;
            
            // Extract ID from the URL for tracks, albums, or playlists
            const spotifyMatch = href.match(/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/);
            if (spotifyMatch) {
                const type = spotifyMatch[1];
                const id = spotifyMatch[2];
                const key = `${type}:${id}`;
                
                // Only add if we haven't seen this ID before
                if (!seenIds.has(key)) {
                    seenIds.add(key);
                    spotifyLinks.push(href);
                }
            }
        }
        
        return spotifyLinks;
        
    } catch (error) {
        console.error('Error processing file:', error.message);
        process.exit(1);
    }
}

function main() {
    // Get filename from command line arguments
    const filename = process.argv[2];
    
    if (!filename) {
        console.error('Usage: node extract-spotify-links.js <telegram-export.html>');
        console.error('');
        console.error('Example:');
        console.error('  node extract-spotify-links.js ChatExport_2024-09-20/messages.html');
        console.error('  node extract-spotify-links.js messages.html > spotify-links.txt');
        process.exit(1);
    }
    
    // Extract and output links
    const links = extractSpotifyLinks(filename);
    
    if (links.length === 0) {
        console.error('No Spotify links found in the file.');
        process.exit(1);
    }
    
    // Output one link per line to stdout
    for (const link of links) {
        console.log(link);
    }
    
    // Log summary to stderr so it doesn't interfere with piped output
    console.error(`\nExtracted ${links.length} unique Spotify links (tracks, albums, playlists) - oldest first`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { extractSpotifyLinks };