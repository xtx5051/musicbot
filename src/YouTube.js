const youtubedl = require('youtube-dl-exec');
const config = require('../config');
const LanguageManager = require('./LanguageManager');

class YouTube {
    static getYtDlpOptions(extraOptions = {}) {
        const baseOptions = {
            noCheckCertificates: true,
            noWarnings: true,

            retries: 3,
            fragmentRetries: 3,

            // Use Node.js as the JS runtime for yt-dlp
            jsRuntimes: `node:${process.execPath}`,

            // Keep requests looking like a normal browser request
            addHeader: [
                'referer:https://www.youtube.com/',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ],

            // Prefer formats that are actually available.
            format: 'bestaudio/best',

            // Do not abort because a particular format is unavailable.
            noCheckFormats: true,

            ...extraOptions
        };

        /*
         * Authentication priority:
         *
         * 1. cookies.txt
         * 2. browser cookies
         * 3. PO Token
         * 4. fallback clients
         *
         * On a server, cookies.txt is the most useful option.
         */

        if (config.ytdl.cookiesFile) {
            baseOptions.cookies = config.ytdl.cookiesFile;
        } else if (config.ytdl.cookiesFromBrowser) {
            baseOptions.cookiesFromBrowser =
                config.ytdl.cookiesFromBrowser;
        } else if (config.ytdl.poToken) {
            baseOptions.extractorArgs =
                `youtube:po_token=web+${config.ytdl.poToken}`;
        } else {
            /*
             * Do not force the old iOS client here.
             *
             * Let yt-dlp select an appropriate client.
             * This is more flexible with newer YouTube changes.
             */
            baseOptions.extractorArgs =
                'youtube:player_client=default';
        }

        return baseOptions;
    }

    static async search(query, limit = 1, guildId = null) {
        try {
            // If it is already a YouTube URL, get its information directly.
            if (this.isYouTubeURL(query)) {
                const info = await this.getInfo(query, guildId);
                return info ? [info] : [];
            }

            const searchQuery = `ytsearch${limit}:${query}`;

            const results = await youtubedl(
                searchQuery,
                this.getYtDlpOptions({
                    dumpSingleJson: true,
                    flatPlaylist: true,
                    skipDownload: true,
                })
            );

            if (!results || !results.entries) {
                return [];
            }

            const tracks = [];

            for (const item of results.entries.slice(0, limit)) {
                try {
                    const unknownTitle = guildId
                        ? await LanguageManager.getTranslation(
                            guildId,
                            'youtube.unknown_title'
                        )
                        : 'Unknown Title';

                    const unknownArtist = guildId
                        ? await LanguageManager.getTranslation(
                            guildId,
                            'youtube.unknown_artist'
                        )
                        : 'Unknown Artist';

                    const track = {
                        title:
                            item.title ||
                            item.fulltitle ||
                            unknownTitle,

                        artist:
                            item.uploader ||
                            item.channel ||
                            unknownArtist,

                        url:
                            item.webpage_url ||
                            item.url ||
                            (item.id
                                ? `https://www.youtube.com/watch?v=${item.id}`
                                : null),

                        duration: item.duration || 0,

                        thumbnail: item.thumbnail,

                        platform: 'youtube',

                        type: 'track',

                        id: item.id,

                        views: item.view_count,

                        uploadDate: item.upload_date,

                        description: item.description,
                    };

                    // Some search results don't contain duration.
                    if (!track.duration || track.duration === 0) {
                        const detailedInfo = await this.getInfo(
                            track.url,
                            guildId
                        );

                        if (
                            detailedInfo &&
                            detailedInfo.duration
                        ) {
                            track.duration =
                                detailedInfo.duration;
                        }
                    }

                    if (track.url) {
                        tracks.push(track);
                    }
                } catch (error) {
                    continue;
                }
            }

            return tracks;

        } catch (error) {
            console.error(
                '[YouTube] search() failed:',
                error.message || error
            );

            return [];
        }
    }

    static async getInfo(url, guildId = null) {
        try {
            const info = await youtubedl(
                url,
                this.getYtDlpOptions({
                    dumpSingleJson: true,
                    preferFreeFormats: true,
                    skipDownload: true,
                })
            );

            if (!info) {
                const errorMsg = guildId
                    ? await LanguageManager.getTranslation(
                        guildId,
                        'youtube.no_info_returned'
                    )
                    : 'No info returned from youtube-dl';

                throw new Error(errorMsg);
            }

            const unknownTitle = guildId
                ? await LanguageManager.getTranslation(
                    guildId,
                    'youtube.unknown_title'
                )
                : 'Unknown Title';

            const unknownArtist = guildId
                ? await LanguageManager.getTranslation(
                    guildId,
                    'youtube.unknown_artist'
                )
                : 'Unknown Artist';

            return {
                title:
                    info.title ||
                    unknownTitle,

                artist:
                    info.uploader ||
                    info.channel ||
                    unknownArtist,

                url:
                    info.webpage_url ||
                    url,

                duration:
                    info.duration ||
                    0,

                thumbnail:
                    info.thumbnail ||
                    info.thumbnails?.[0]?.url,

                platform: 'youtube',

                type: 'track',

                id: info.id,

                views: info.view_count,

                uploadDate: info.upload_date,

                description: info.description,

                formats: info.formats,
            };

        } catch (error) {
            console.error(
                '[YouTube] getInfo() failed:',
                error.message || error
            );

            return null;
        }
    }

    static async getStream(
        url,
        guildId = null,
        startSeconds = 0
    ) {
        try {
            if (!url) {
                const errorMsg = guildId
                    ? await LanguageManager.getTranslation(
                        guildId,
                        'youtube.url_required'
                    )
                    : 'URL is required';

                throw new Error(errorMsg);
            }

            const info = await youtubedl(
                url,
                this.getYtDlpOptions({
                    dumpSingleJson: true,
                    skipDownload: true,

                    format:
                        'bestaudio/best',

                    noCheckFormats: true,
                })
            );

            if (!info || !info.url) {
                const errorMsg = guildId
                    ? await LanguageManager.getTranslation(
                        guildId,
                        'youtube.no_stream_url'
                    )
                    : 'No stream URL found';

                throw new Error(errorMsg);
            }

            const baseUrl = info.url;

            const canSeek =
                /googlevideo\.com/i.test(baseUrl);

            let finalUrl = baseUrl;

            const seekSeconds = Math.max(
                0,
                Number(startSeconds) || 0
            );

            if (
                seekSeconds > 0 &&
                canSeek
            ) {
                const startMs =
                    Math.floor(
                        seekSeconds * 1000
                    );

                const separator =
                    baseUrl.includes('?')
                        ? '&'
                        : '?';

                finalUrl =
                    `${baseUrl}${separator}begin=${startMs}`;
            }

            return {
                url: finalUrl,

                rawUrl: baseUrl,

                type:
                    info.acodec &&
                    info.acodec.includes('opus')
                        ? 'opus'
                        : 'arbitrary',

                duration:
                    info.duration ||
                    0,

                bitrate:
                    info.abr ||
                    info.tbr ||
                    0,

                canSeek,

                format:
                    info.format,

                httpHeaders:
                    info.http_headers ||
                    {}
            };

        } catch (error) {
            console.error(
                '[YouTube] getStream() failed:',
                error.message || error
            );

            throw error;
        }
    }

    static async getPlaylist(
        url,
        guildId = null
    ) {
        try {
            const info = await youtubedl(
                url,
                this.getYtDlpOptions({
                    dumpSingleJson: true,
                    flatPlaylist: true,
                    skipDownload: true,
                })
            );

            if (!info) {
                const errorMsg = guildId
                    ? await LanguageManager.getTranslation(
                        guildId,
                        'youtube.no_playlist_info'
                    )
                    : 'No playlist info found';

                throw new Error(errorMsg);
            }

            if (
                !info.entries ||
                info.entries.length === 0
            ) {
                const errorMsg = guildId
                    ? await LanguageManager.getTranslation(
                        guildId,
                        'youtube.no_playlist_entries'
                    )
                    : 'No playlist entries found';

                throw new Error(errorMsg);
            }

            const unknownTitle = guildId
                ? await LanguageManager.getTranslation(
                    guildId,
                    'youtube.unknown_title'
                )
                : 'Unknown Title';

            const unknownArtist = guildId
                ? await LanguageManager.getTranslation(
                    guildId,
                    'youtube.unknown_artist'
                )
                : 'Unknown Artist';

            const tracks = [];

            for (
                const entry of info.entries.slice(
                    0,
                    config.bot.maxPlaylistSize
                )
            ) {
                if (
                    entry &&
                    (entry.id || entry.url)
                ) {
                    try {
                        const track = {
                            title:
                                entry.title ||
                                entry.fulltitle ||
                                unknownTitle,

                            artist:
                                entry.uploader ||
                                entry.channel ||
                                entry.uploader_id ||
                                unknownArtist,

                            url:
                                entry.webpage_url ||
                                entry.url ||
                                (entry.id
                                    ? `https://www.youtube.com/watch?v=${entry.id}`
                                    : null),

                            duration:
                                entry.duration ||
                                0,

                            thumbnail:
                                entry.thumbnail ||
                                entry.thumbnails?.[0]?.url,

                            platform:
                                'youtube',

                            type:
                                'track',

                            id:
                                entry.id,
                        };

                        if (track.url) {
                            tracks.push(track);
                        }

                    } catch (entryError) {
                        continue;
                    }
                }
            }

            if (tracks.length === 0) {
                const errorMsg = guildId
                    ? await LanguageManager.getTranslation(
                        guildId,
                        'youtube.no_valid_tracks'
                    )
                    : 'No valid tracks found in playlist';

                throw new Error(errorMsg);
            }

            const unknownPlaylist = guildId
                ? await LanguageManager.getTranslation(
                    guildId,
                    'youtube.unknown_playlist'
                )
                : 'Unknown Playlist';

            return {
                title:
                    info.title ||
                    unknownPlaylist,

                tracks,

                totalTracks:
                    info.playlist_count ||
                    tracks.length,

                url,

                platform:
                    'youtube',

                type:
                    'playlist',
            };

        } catch (error) {
            console.error(
                '[YouTube] getPlaylist() failed:',
                error.message || error
            );

            return null;
        }
    }

    static isYouTubeURL(url) {
        if (!url || typeof url !== 'string') {
            return false;
        }

        const patterns = [
            /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/playlist\?list=)/i,

            /^https?:\/\/(www\.)?youtube\.com\/embed\/[a-zA-Z0-9_-]+/i,

            /^https?:\/\/(www\.)?youtube\.com\/v\/[a-zA-Z0-9_-]+/i,
        ];

        return patterns.some(
            pattern => pattern.test(url)
        );
    }

    static isPlaylist(url) {
        if (!url || typeof url !== 'string') {
            return false;
        }

        return (
            url.includes('list=') &&
            (
                url.includes(
                    'youtube.com/playlist'
                ) ||
                url.includes(
                    'youtube.com/watch'
                ) ||
                url.includes(
                    'youtu.be'
                )
            )
        );
    }

    static parseDuration(durationString) {
        if (!durationString) {
            return 0;
        }

        const parts =
            durationString
                .split(':')
                .reverse();

        let seconds = 0;

        for (
            let i = 0;
            i < parts.length;
            i++
        ) {
            seconds +=
                parseInt(
                    parts[i],
                    10
                ) *
                Math.pow(60, i);
        }

        return seconds;
    }

    static formatDuration(seconds) {
        if (
            !seconds ||
            seconds === 0
        ) {
            return '0:00';
        }

        const totalSeconds =
            Math.floor(
                Number(seconds) || 0
            );

        const hours =
            Math.floor(
                totalSeconds / 3600
            );

        const minutes =
            Math.floor(
                (totalSeconds % 3600) / 60
            );

        const remainingSeconds =
            totalSeconds % 60;

        if (hours > 0) {
            return (
                `${hours}:` +
                `${minutes
                    .toString()
                    .padStart(2, '0')}:` +
                `${remainingSeconds
                    .toString()
                    .padStart(2, '0')}`
            );
        }

        return (
            `${minutes}:` +
            `${remainingSeconds
                .toString()
                .padStart(2, '0')}`
        );
    }

    static async getRelatedVideos(
        videoId,
        limit = 5
    ) {
        try {
            return [];
        } catch (error) {
            return [];
        }
    }

    static extractVideoId(url) {
        if (!url || typeof url !== 'string') {
            return null;
        }

        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/i,

            /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/i,

            /youtube\.com\/v\/([a-zA-Z0-9_-]+)/i,
        ];

        for (const pattern of patterns) {
            const match =
                url.match(pattern);

            if (match) {
                return match[1];
            }
        }

        return null;
    }

    static extractPlaylistId(url) {
        if (!url || typeof url !== 'string') {
            return null;
        }

        const match =
            url.match(
                /[&?]list=([a-zA-Z0-9_-]+)/i
            );

        return match
            ? match[1]
            : null;
    }

    static createThumbnailUrl(
        videoId,
        quality = 'maxresdefault'
    ) {
        return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
    }

    static createVideoUrl(videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
    }

    static async validateUrl(
        url
    ) {
        try {
            if (!this.isYouTubeURL(url)) {
                return false;
            }

            const info = await youtubedl(
                url,
                this.getYtDlpOptions({
                    dumpSingleJson: true,
                    skipDownload: true,
                })
            );

            return (
                !!info &&
                !!info.title
            );

        } catch (error) {
            return false;
        }
    }
}

module.exports = YouTube;
