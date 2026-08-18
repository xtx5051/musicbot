const { Events } = require('discord.js');
const MusicPlayer = require('../src/MusicPlayer');
const playCommand = require('../commands/play');

module.exports = {
    name: Events.MessageCreate,
    once: false,

    async execute(message) {
        try {
            if (message.author.bot) return;
            if (!message.guild) return;

            const content = message.content.trim();

            const isCommand =
                content === 'و' ||
                content === 'س' ||
                content === 'م' ||
                content === 'ك' ||
                content === 'ش' ||
                content.startsWith('ش ');

            if (!isCommand) return;

            const guild = message.guild;
            const member = message.member;

            if (!member?.voice?.channel) {
                await message.reply('يجب أن تكون في روم صوتي.');
                return;
            }

            const client = message.client;

            // تشغيل أغنية
            if (content === 'ش' || content.startsWith('ش ')) {
                const query = content.slice(1).trim();

                if (!query) {
                    await message.reply('اكتب اسم الأغنية بعد ش.');
                    return;
                }

                let player = client.players.get(guild.id);

                if (!player) {
                    player = new MusicPlayer(
                        guild,
                        message.channel,
                        member.voice.channel
                    );

                    client.players.set(guild.id, player);
                }

                player.voiceChannel = member.voice.channel;
                player.textChannel = message.channel;

                const trackData = await playCommand.getTrackData(
                    query,
                    guild.id
                );

                if (!trackData.success) {
                    await message.reply(trackData.message);
                    return;
                }

                if (!client.musicEmbedManager) {
                    const MusicEmbedManager = require('../src/MusicEmbedManager');
                    client.musicEmbedManager = new MusicEmbedManager(client);
                }

                const fakeInteraction = {
                    guild,
                    channel: message.channel,
                    member,
                    user: message.author,
                    deferred: false,
                    replied: false,

                    editReply: async (data) => {
                        return message.reply(data);
                    },

                    reply: async (data) => {
                        return message.reply(data);
                    },

                    followUp: async (data) => {
                        return message.reply(data);
                    },

                    options: {
                        getString: () => query
                    }
                };

                const result =
                    await client.musicEmbedManager.handleMusicData(
                        guild.id,
                        trackData,
                        member,
                        fakeInteraction
                    );

                if (!result.success) {
                    await message.reply(result.message);
                }

                return;
            }

            const player = client.players.get(guild.id);

            if (!player) {
                await message.reply('لا توجد أغنية تعمل حاليًا.');
                return;
            }

            // إيقاف مؤقت
            if (content === 'م') {
                const paused = player.pauseFor('manual');

                if (paused) {
                    await message.reply('تم الإيقاف المؤقت.');
                }

                return;
            }

            // استكمال التشغيل
            if (content === 'ك') {
                const resumed = player.resumeFor('manual');

                if (resumed) {
                    await message.reply('تم استكمال التشغيل.');
                }

                return;
            }

            // تخطي الأغنية
            if (content === 'س') {
                const skipped = player.skip();

                if (skipped) {
                    await message.reply('تم التخطي.');
                }

                return;
            }

            // إيقاف الموسيقى مع بقاء البوت داخل الروم
            if (content === 'و') {
                player.clearQueue();

                if (player.trackTimer) {
                    clearTimeout(player.trackTimer);
                    player.trackTimer = null;
                }

                player.pendingEndReason = 'stop';
                player.stopRequested = true;
                player.currentTrack = null;
                player.resource = null;
                player.paused = false;
                player.pauseReasons.clear();

                player.audioPlayer.stop(true);

                await player.persistState('manual-stop');

                return;
            }

        } catch (error) {
            console.error('Message command error:', error);
        }
    }
};
