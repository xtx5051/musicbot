const { Events } = require('discord.js');
const MusicPlayer = require('../src/MusicPlayer');
const playCommand = require('../commands/play');

module.exports = {
    name: Events.MessageCreate,
    once: false,

    async execute(message) {
        try {
            // تجاهل البوتات
            if (message.author.bot) return;

            const content = message.content.trim();

            // تجاهل أي رسالة ليست من أوامرنا
            if (!['ش', 'و', 'س', 'م', 'ك'].some(cmd =>
                content === cmd || content.startsWith(cmd + ' ')
            )) {
                return;
            }

            const guild = message.guild;
            if (!guild) return;

            const member = message.member;
            if (!member?.voice?.channel) {
                await message.reply('يجب أن تكون في روم صوتي.');
                return;
            }

            let player = client?.players?.get(guild.id);

            // تشغيل الأغنية
            if (content.startsWith('ش ')) {
                const query = content.slice(2).trim();

                if (!query) {
                    await message.reply('اكتب اسم الأغنية بعد ش.');
                    return;
                }

                let player = message.client.players.get(guild.id);

                if (!player) {
                    player = new MusicPlayer(
                        guild,
                        message.channel,
                        member.voice.channel
                    );

                    message.client.players.set(guild.id, player);
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

                if (!message.client.musicEmbedManager) {
                    const MusicEmbedManager = require('../src/MusicEmbedManager');
                    message.client.musicEmbedManager =
                        new MusicEmbedManager(message.client);
                }

                const fakeInteraction = {
                    ...message,
                    deferred: false,
                    replied: false,
                    editReply: async data => message.reply(data),
                    reply: async data => message.reply(data),
                    followUp: async data => message.reply(data),
                    options: {
                        getString: () => query
                    }
                };

                const result =
                    await message.client.musicEmbedManager.handleMusicData(
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

            player = message.client.players.get(guild.id);

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

            // استكمال
            if (content === 'ك') {
                const resumed = player.resumeFor('manual');

                if (resumed) {
                    await message.reply('تم استكمال التشغيل.');
                }

                return;
            }

            // تخطي
            if (content === 'س') {
                await player.skip();
                await message.reply('تم التخطي.');
                return;
            }

            // إيقاف الموسيقى مع بقاء البوت في الروم
            if (content === 'و') {
                player.queue = [];
                player.currentTrack = null;

                if (player.audioPlayer) {
                    try {
                        player.audioPlayer.stop();
                    } catch (error) {
                        console.error('Failed to stop audio:', error);
                    }
                }

                player.clearInactivityTimer(false);

                if (message.client.musicEmbedManager) {
                    try {
                        await message.client.musicEmbedManager.handlePlaybackEnd(player);
                    } catch (error) {
                        console.error('Failed to update playback UI:', error);
                    }
                }

                return;
            }

        } catch (error) {
            console.error('Message command error:', error);
        }
    }
};
