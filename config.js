// Load environment variables
require('dotenv').config();

const fs = require('fs');
const path = require('path');

// YouTube cookies file path
const cookiesPath = path.join(__dirname, 'cookies.txt');

console.log('🍪 cookies path:', cookiesPath);
console.log(
    '🍪 cookies exists:',
    fs.existsSync(cookiesPath)
);

// Create cookies.txt from Railway environment variable
if (process.env.YOUTUBE_COOKIES) {
    try {
        fs.writeFileSync(
            cookiesPath,
            process.env.YOUTUBE_COOKIES,
            'utf8'
        );

        console.log('🍪 YOUTUBE_COOKIES موجودة وتم تحميلها');
        console.log('✅ YouTube cookies loaded successfully.');
        console.log(
    `🍪 cookies.txt size: ${fs.statSync(cookiesPath).size} bytes`
);
        const firstLine = fs
    .readFileSync(cookiesPath, 'utf8')
    .split('\n')[0]
    .trim();

console.log(
    '🍪 Cookies format:',
    firstLine.startsWith('# Netscape HTTP Cookie File')
        ? '✅ Netscape'
        : '❌ Unknown'
);
    } catch (error) {
        console.error(
            '❌ Failed to create YouTube cookies file:',
            error.message
        );
    }
}

module.exports = {
    // Discord Bot Settings
    discord: {
        token:
            process.env.DISCORD_TOKEN ||
            'YOUR_DISCORD_BOT_TOKEN_HERE',

        clientId:
            process.env.CLIENT_ID ||
            'YOUR_CLIENT_ID_HERE',

        guildId:
            process.env.GUILD_ID ||
            null,
    },

    // Spotify API Settings
    spotify: {
        clientId:
            process.env.SPOTIFY_CLIENT_ID ||
            'YOUR_SPOTIFY_CLIENT_ID',

        clientSecret:
            process.env.SPOTIFY_CLIENT_SECRET ||
            'YOUR_SPOTIFY_CLIENT_SECRET',
    },

    // Genius API Settings
    genius: {
        clientId:
            process.env.GENIUS_CLIENT_ID ||
            '',

        clientSecret:
            process.env.GENIUS_CLIENT_SECRET ||
            '',
    },

    // Bot Settings
    bot: {
        defaultVolume: 100,

        maxQueueSize: 100,

        maxPlaylistSize: 50,

        status:
            process.env.STATUS ||
            '🎵 Beatra | /play',

        embedColor:
            process.env.EMBED_COLOR ||
            '#FF6B6B',

        supportServer:
            process.env.SUPPORT_SERVER ||
            'https://discord.gg/ACJQzJuckW',

        website:
            process.env.WEBSITE ||
            'https://beatra.app',

        invite:
            'https://discord.com/oauth2/authorize?client_id=' +
            process.env.CLIENT_ID +
            '&permissions=8&scope=bot%20applications.commands',
    },

    // Audio Settings
    audio: {
        quality: 'highestaudio',

        format: 'mp3',

        bitrate: 320,

        filters: {
            bassboost: 'bass=g=20',

            nightcore:
                'aresample=48000,asetrate=48000*1.25',

            vaporwave:
                'aresample=48000,asetrate=48000*0.8',

            _8d:
                'apulsator=hz=0.09',
        }
    },

    // YouTube / yt-dlp Settings
    ytdl: {
        requestOptions: {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                    'Chrome/120.0.0.0 Safari/537.36'
            }
        },

        format:
            'bestaudio[ext=webm+acodec=opus+asr=48000]/bestaudio',

        filter: 'audioonly',

        quality: 'highestaudio',

        highWaterMark:
            1 << 25,

        // Browser cookies
        cookiesFromBrowser:
            process.env.COOKIES_FROM_BROWSER ||
            null,

        // Railway YOUTUBE_COOKIES has priority.
        // If it does not exist, use COOKIES_FILE.
        cookiesFile:
            process.env.YOUTUBE_COOKIES
                ? cookiesPath
                : (
                    process.env.COOKIES_FILE ||
                    null
                ),

        // Optional YouTube PO Token
        poToken:
            process.env.YOUTUBE_PO_TOKEN ||
            null,
    },

    // Sharding Settings
    sharding: {
        totalShards:
            process.env.TOTAL_SHARDS ||
            'auto',

        shardList:
            process.env.SHARD_LIST ||
            'auto',

        mode:
            process.env.SHARD_MODE ||
            'process',

        respawn:
            process.env.SHARD_RESPAWN !== 'false',

        spawnDelay:
            parseInt(
                process.env.SHARD_SPAWN_DELAY
            ) || 5500,

        spawnTimeout:
            parseInt(
                process.env.SHARD_SPAWN_TIMEOUT
            ) || 30000,
    }
};
