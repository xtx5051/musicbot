const { Client, GatewayIntentBits, Collection, Events, ActivityType } = require('discord.js');

const {
    getVoiceConnection,
    joinVoiceChannel,
    VoiceConnectionStatus,
    entersState
} = require('@discordjs/voice');

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const config = require('./config');
const PlayerStateManager = require('./src/PlayerStateManager');
const MusicPlayer = require('./src/MusicPlayer');
const chalk = require('chalk');

require("./src/commandLoader"); // Load and deploy commands


// ============================================================
// 🔒 الروم الصوتي الثابت
// ============================================================
//
// حط هنا ID الروم الصوتي اللي تبي البوت يجلس فيه.
//
// مثال:
// const FIXED_VOICE_CHANNEL_ID = '123456789012345678';
//
// ============================================================

const FIXED_VOICE_CHANNEL_ID = '770786224612704306';


// ============================================================
// 🔒 متغيرات الاتصال بالروم الثابت
// ============================================================

let fixedVoiceConnection = null;
let fixedVoiceReconnectTimer = null;
let fixedVoiceWatchdog = null;
let isReconnectingFixedVoice = false;


// ============================================================
// تنظيف ملفات الكاش الصوتي
// ============================================================

async function cleanupAudioCache() {
    const cacheDir = path.join(__dirname, 'audio_cache');

    try {
        if (fs.existsSync(cacheDir)) {
            const files = await fsPromises.readdir(cacheDir);
            const protectedFiles = PlayerStateManager.getProtectedCacheFiles();

            let deletedCount = 0;
            let skippedCount = 0;

            for (const file of files) {
                const absolutePath = path.join(cacheDir, file);

                if (protectedFiles.has(path.resolve(absolutePath))) {
                    skippedCount++;
                    continue;
                }

                try {
                    await fsPromises.unlink(absolutePath);
                    deletedCount++;
                } catch (err) {
                    console.error(
                        chalk.red(`❌ Failed to delete ${file}:`),
                        err.message
                    );
                }
            }
        } else {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
    } catch (error) {
        console.error(
            chalk.red('❌ Failed to cleanup audio cache:'),
            error.message
        );
    }
}


// ============================================================
// استعادة جلسات الموسيقى
// ============================================================

async function restoreSavedPlayers(client) {
    const savedStates = PlayerStateManager.getAllStates();
    const entries = Object.entries(savedStates || {});

    if (entries.length === 0) return;

    console.log(
        chalk.cyan(
            `🔄 Found ${entries.length} saved session(s) to restore...`
        )
    );

    for (const [guildId, state] of entries) {
        try {
            let guild = client.guilds.cache.get(guildId);

            if (!guild) {
                let retries = 3;

                while (!guild && retries > 0) {
                    try {
                        await new Promise(resolve =>
                            setTimeout(resolve, 1000)
                        );

                        guild = await client.guilds
                            .fetch(guildId)
                            .catch(() => null);

                        if (guild) break;
                    } catch (error) {
                        retries--;
                    }
                }
            }

            if (!guild) {
                console.log(
                    chalk.yellow(
                        `⚠️ Guild ${guildId} not found or not accessible, removing state...`
                    )
                );

                await PlayerStateManager.removeState(guildId);
                continue;
            }

            const voiceChannelId = state.voiceChannelId;
            const textChannelId = state.textChannelId;

            if (!voiceChannelId || !textChannelId) {
                await PlayerStateManager.removeState(guildId);
                continue;
            }

            let voiceChannel =
                guild.channels.cache.get(voiceChannelId) || null;

            if (!voiceChannel) {
                voiceChannel = await guild.channels
                    .fetch(voiceChannelId)
                    .catch(() => null);
            }

            let textChannel =
                guild.channels.cache.get(textChannelId) || null;

            if (!textChannel) {
                textChannel = await guild.channels
                    .fetch(textChannelId)
                    .catch(() => null);
            }

            const isVoiceValid =
                voiceChannel &&
                typeof voiceChannel.isVoiceBased === 'function' &&
                voiceChannel.isVoiceBased();

            const isTextValid =
                textChannel &&
                typeof textChannel.isTextBased === 'function' &&
                textChannel.isTextBased();

            if (!isVoiceValid || !isTextValid) {
                console.log(
                    chalk.yellow(
                        `⚠️ Invalid channels for guild ${guild.name}, removing state...`
                    )
                );

                await PlayerStateManager.removeState(guildId);
                continue;
            }

            const player = new MusicPlayer(
                guild,
                textChannel,
                voiceChannel
            );

            client.players.set(guildId, player);

            try {
                await player.restoreFromState(state);

                console.log(
                    chalk.green(
                        `✅ Successfully restored session for guild ${guild.name}`
                    )
                );
            } catch (error) {
                console.error(
                    chalk.red(
                        `❌ Failed to restore music session for guild ${guild.name} (${guildId}):`
                    ),
                    error.message
                );

                client.players.delete(guildId);
                player.cleanup();

                await PlayerStateManager.removeState(guildId);
            }
        } catch (error) {
            console.error(
                chalk.red(
                    `❌ Error during session restoration for guild ${guildId}:`
                ),
                error.message
            );

            await PlayerStateManager.removeState(guildId);
        }
    }
}


// ============================================================
// 🔒 الاتصال بالروم الثابت
// ============================================================

async function connectToFixedVoiceChannel(client) {

    if (!FIXED_VOICE_CHANNEL_ID ||
        FIXED_VOICE_CHANNEL_ID === 'حط_هنا_ID_الروم') {

        console.log(
            chalk.yellow(
                '⚠️ لم يتم وضع ID للروم الصوتي الثابت.'
            )
        );

        return;
    }

    if (isReconnectingFixedVoice) {
        return;
    }

    isReconnectingFixedVoice = true;

    try {

        const channel = await client.channels
            .fetch(FIXED_VOICE_CHANNEL_ID)
            .catch(() => null);

        if (!channel) {
            console.error(
                chalk.red(
                    '❌ لم أستطع العثور على الروم الصوتي الثابت.'
                )
            );

            return;
        }

        if (
            !channel.isVoiceBased ||
            !channel.isVoiceBased()
        ) {
            console.error(
                chalk.red(
                    '❌ الـ ID المحدد ليس رومًا صوتيًا.'
                )
            );

            return;
        }

        const guild = channel.guild;

        const botMember = guild.members.me ||
            await guild.members
                .fetch(client.user.id)
                .catch(() => null);

        if (!botMember) {
            console.error(
                chalk.red(
                    '❌ لم أستطع العثور على البوت داخل السيرفر.'
                )
            );

            return;
        }

        // إذا البوت موجود أصلًا في الروم الصحيح
        if (
            botMember.voice.channelId ===
            FIXED_VOICE_CHANNEL_ID
        ) {

            const existingConnection =
                getVoiceConnection(guild.id);

            if (existingConnection) {
                fixedVoiceConnection = existingConnection;

                console.log(
                    chalk.green(
                        `🔒 البوت موجود أصلًا في الروم الثابت: ${channel.name}`
                    )
                );

                return;
            }
        }

        // إذا فيه اتصال قديم
        const oldConnection =
            getVoiceConnection(guild.id);

        if (oldConnection) {
            try {
                oldConnection.destroy();
            } catch {}
        }

        // إنشاء اتصال جديد
        fixedVoiceConnection = joinVoiceChannel({
            channelId: FIXED_VOICE_CHANNEL_ID,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false
        });

        console.log(
            chalk.green(
                `🔒 تم تثبيت البوت في الروم: ${channel.name}`
            )
        );

        // ========================================================
        // مراقبة حالة الاتصال
        // ========================================================

        fixedVoiceConnection.on(
            VoiceConnectionStatus.Ready,
            () => {

                console.log(
                    chalk.green(
                        `✅ اتصال الروم الثابت جاهز: ${channel.name}`
                    )
                );

            }
        );

        fixedVoiceConnection.on(
            VoiceConnectionStatus.Disconnected,
            async () => {

                console.log(
                    chalk.yellow(
                        '⚠️ البوت انقطع من الروم الثابت!'
                    )
                );

                if (fixedVoiceReconnectTimer) {
                    clearTimeout(fixedVoiceReconnectTimer);
                }

                fixedVoiceReconnectTimer = setTimeout(
                    async () => {

                        try {

                            if (fixedVoiceConnection) {
                                try {
                                    fixedVoiceConnection.destroy();
                                } catch {}
                            }

                            fixedVoiceConnection = null;

                            await connectToFixedVoiceChannel(client);

                        } catch (error) {

                            console.error(
                                chalk.red(
                                    '❌ فشل إعادة الاتصال بالروم الثابت:'
                                ),
                                error.message
                            );

                        }

                    },
                    3000
                );
            }
        );

        fixedVoiceConnection.on(
            VoiceConnectionStatus.Destroyed,
            () => {

                console.log(
                    chalk.yellow(
                        '⚠️ اتصال الروم الثابت تم تدميره!'
                    )
                );
                console.log(
    chalk.cyan(
        `🎵 [SHARD ${client.shard?.ids[0] ?? 0}] Music bot serving ${client.guilds.cache.size} servers on this shard!`
    )
);

// ====================================================
// 🏠 عرض السيرفرات اللي البوت موجود فيها
// ====================================================

console.log(
    chalk.magenta(
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    )
);

console.log(
    chalk.magenta(
        '🏠 السيرفرات اللي البوت موجود فيها:'
    )
);

if (client.guilds.cache.size === 0) {

    console.log(
        chalk.yellow(
            '⚠️ ما فيه سيرفرات محملة حاليًا.'
        )
    );

} else {

    client.guilds.cache.forEach(
        (guild, index) => {

            console.log(
                chalk.white(
                    `${index + 1}. ${guild.name} | ID: ${guild.id}`
                )
            );

        }
    );
}

console.log(
    chalk.magenta(
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    )
);

                fixedVoiceConnection = null;

                if (fixedVoiceReconnectTimer) {
                    clearTimeout(fixedVoiceReconnectTimer);
                }

                fixedVoiceReconnectTimer = setTimeout(
                    () => {
                        connectToFixedVoiceChannel(client);
                    },
                    3000
                );
            }
        );

        // انتظر حتى يصبح الاتصال جاهز
        try {

            await entersState(
                fixedVoiceConnection,
                VoiceConnectionStatus.Ready,
                15000
            );

            console.log(
                chalk.green(
                    '🎵 البوت متصل بالروم الثابت ومستعد.'
                )
            );

        } catch (error) {

            console.log(
                chalk.yellow(
                    '⚠️ الاتصال لم يصبح Ready، سيتم إعادة المحاولة.'
                )
            );

        }

    } catch (error) {

        console.error(
            chalk.red(
                '❌ خطأ أثناء الدخول للروم الثابت:'
            ),
            error.message
        );

        if (fixedVoiceReconnectTimer) {
            clearTimeout(fixedVoiceReconnectTimer);
        }

        fixedVoiceReconnectTimer = setTimeout(
            () => {
                connectToFixedVoiceChannel(client);
            },
            5000
        );

    } finally {

        isReconnectingFixedVoice = false;

    }
}


// ============================================================
// 🔒 مراقبة الروم الثابت كل 10 ثواني
// ============================================================

function startFixedVoiceWatchdog(client) {

    if (fixedVoiceWatchdog) {
        clearInterval(fixedVoiceWatchdog);
    }

    fixedVoiceWatchdog = setInterval(
        async () => {

            try {

                const channel = await client.channels
                    .fetch(FIXED_VOICE_CHANNEL_ID)
                    .catch(() => null);

                if (!channel) return;

                const guild = channel.guild;

                const botMember =
                    guild.members.me ||
                    await guild.members
                        .fetch(client.user.id)
                        .catch(() => null);

                if (!botMember) return;

                const currentChannelId =
                    botMember.voice.channelId;

                // البوت مو موجود بالروم الثابت
                if (
                    currentChannelId !==
                    FIXED_VOICE_CHANNEL_ID
                ) {

                    console.log(
                        chalk.yellow(
                            '🔒 البوت ليس في الروم الثابت، جاري إرجاعه...'
                        )
                    );

                    await connectToFixedVoiceChannel(client);

                    return;
                }

                // تأكد أن الاتصال نفسه موجود
                const connection =
                    getVoiceConnection(guild.id);

                if (!connection) {

                    console.log(
                        chalk.yellow(
                            '⚠️ لا يوجد Voice Connection، جاري إنشاء اتصال جديد...'
                        )
                    );

                    await connectToFixedVoiceChannel(client);
                }

            } catch (error) {

                console.error(
                    chalk.red(
                        '❌ خطأ في مراقبة الروم الثابت:'
                    ),
                    error.message
                );

            }

        },
        10000
    );
}


// ============================================================
// تشغيل البوت بعد 5 ثواني
// ============================================================

setTimeout(() => {

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildMembers,
        ]
    });


    // ========================================================
    // Collections
    // ========================================================

    client.commands = new Collection();
    client.players = new Collection();


    // ========================================================
    // Music Embed Manager
    // ========================================================

    const MusicEmbedManager =
        require('./src/MusicEmbedManager');

    client.musicEmbedManager =
        new MusicEmbedManager(client);

    if (!global.clients) {
        global.clients = {};
    }

    global.clients.musicEmbedManager =
        client.musicEmbedManager;


    // ========================================================
    // Load Commands
    // ========================================================

    const loadCommands = () => {

        const commandsPath =
            path.join(__dirname, 'commands');

        if (!fs.existsSync(commandsPath)) {
            fs.mkdirSync(
                commandsPath,
                { recursive: true }
            );
        }

        try {

            const commandFiles =
                fs.readdirSync(commandsPath)
                    .filter(file =>
                        file.endsWith('.js')
                    );

            for (const file of commandFiles) {

                const filePath =
                    path.join(commandsPath, file);

                const command =
                    require(filePath);

                if (
                    'data' in command &&
                    'execute' in command
                ) {

                    client.commands.set(
                        command.data.name,
                        command
                    );

                    console.log(
                        chalk.green(
                            `✓ Loaded command: ${command.data.name}`
                        )
                    );

                } else {

                    console.log(
                        chalk.yellow(
                            `⚠ Warning: ${file} is missing required "data" or "execute" property.`
                        )
                    );

                }
            }

        } catch (error) {

            console.log(
                chalk.yellow(
                    '⚠ No commands directory found, skipping command loading.'
                )
            );

        }
    };


    // ========================================================
    // Load Events
    // ========================================================

    const loadEvents = () => {

        const eventsPath =
            path.join(__dirname, 'events');

        if (!fs.existsSync(eventsPath)) {
            fs.mkdirSync(
                eventsPath,
                { recursive: true }
            );
        }

        try {

            const eventFiles =
                fs.readdirSync(eventsPath)
                    .filter(file =>
                        file.endsWith('.js')
                    );

            for (const file of eventFiles) {

                const filePath =
                    path.join(eventsPath, file);

                const event =
                    require(filePath);

                if (event.once) {

                    client.once(
                        event.name,
                        (...args) =>
                            event.execute(...args)
                    );

                } else {

                    client.on(
                        event.name,
                        (...args) =>
                            event.execute(...args)
                    );

                }

                console.log(
                    chalk.green(
                        `✓ Loaded event: ${event.name}`
                    )
                );
            }

        } catch (error) {

            console.log(
                chalk.yellow(
                    '⚠ No events directory found, using default events.'
                )
            );

        }
    };


    // ========================================================
    // Client Ready
    // ========================================================

    client.once(
        Events.ClientReady,
        async () => {

            console.log(
                chalk.green(
                    `✅ [SHARD ${client.shard?.ids[0] ?? 0}] ${client.user.tag} is online and ready!`
                )
            );

            console.log(
                chalk.cyan(
                    `🎵 [SHARD ${client.shard?.ids[0] ?? 0}] Music bot serving ${client.guilds.cache.size} servers on this shard!`
                )
            );


            // ====================================================
            // 🔒 دخول الروم الثابت
            // ====================================================

            await new Promise(resolve =>
                setTimeout(resolve, 2000)
            );

            await connectToFixedVoiceChannel(client);

            startFixedVoiceWatchdog(client);


            // ====================================================
            // Shard information
            // ====================================================

            if (client.shard) {

                setTimeout(() => {

                    client.shard
                        .fetchClientValues(
                            'guilds.cache.size'
                        )
                        .then(results => {

                            const totalGuilds =
                                results.reduce(
                                    (acc, guildCount) =>
                                        acc + guildCount,
                                    0
                                );

                            console.log(
                                chalk.magenta(
                                    `🌐 [SHARD ${client.shard.ids[0]}] Total servers across all shards: ${totalGuilds}`
                                )
                            );

                        })
                        .catch(err => {

                            if (
                                !err.message.includes(
                                    'still being spawned'
                                )
                            ) {

                                console.error(
                                    chalk.red(
                                        'Error fetching total guild count:'
                                    ),
                                    err
                                );

                            }

                        });

                }, 10000);
            }


            // ====================================================
            // Bot activity
            // ====================================================

            setInterval(() => {

                client.user.setActivity({
                    name: `${config.bot.status}`,
                    type: ActivityType.Listening
                });

            }, 10000);


            // ====================================================
            // Restore sessions
            // ====================================================

            if (!client.shard) {

                console.log(
                    chalk.cyan(
                        '⏳ Non-sharded mode: waiting for guilds to be fully cached...'
                    )
                );

                await new Promise(resolve =>
                    setTimeout(resolve, 5000)
                );

                await client.restoreSessions();
            }
        }
    );


    // ========================================================
    // Restore function
    // ========================================================

    client.restoreSessions = async function() {

        console.log(
            chalk.cyan(
                `[SHARD ${client.shard?.ids?.[0] ?? 'N/A'}] 🔄 Starting session restore...`
            )
        );

        await restoreSavedPlayers(client);

        await cleanupAudioCache();

        console.log(
            chalk.green(
                `[SHARD ${client.shard?.ids?.[0] ?? 'N/A'}] ✅ Session restore complete`
            )
        );
    };


    // ========================================================
    // Interactions
    // ========================================================

    client.on(
        Events.InteractionCreate,
        async interaction => {

            if (!interaction.isChatInputCommand()) {
                return;
            }

            const command =
                client.commands.get(
                    interaction.commandName
                );

            if (!command) {

                console.error(
                    chalk.red(
                        `❌ No command matching ${interaction.commandName} was found.`
                    )
                );

                return;
            }

            try {

                await command.execute(
                    interaction,
                    client
                );

            } catch (error) {

                console.error(
                    chalk.red(
                        `❌ Error executing ${interaction.commandName}:`
                    ),
                    error
                );

                const errorMessage =
                    '❌ An error occurred while executing this command!';

                if (
                    interaction.replied ||
                    interaction.deferred
                ) {

                    await interaction.followUp({
                        content: errorMessage,
                        ephemeral: true
                    });

                } else {

                    await interaction.reply({
                        content: errorMessage,
                        ephemeral: true
                    });

                }
            }
        }
    );


    // ========================================================
    // 🔊 Voice State Update
    // ========================================================

    client.on(
        Events.VoiceStateUpdate,
        async (oldState, newState) => {

            const guild = oldState.guild;

            const botMember =
                guild.members.me;

            const botId =
                botMember?.id ??
                client.user.id;

            const involvesBot =
                oldState.id === botId ||
                newState.id === botId;


            // ====================================================
            // 🔒 حماية الروم الثابت
            // ====================================================

            if (involvesBot) {

                const oldChannelId =
                    oldState.channelId;

                const newChannelId =
                    newState.channelId;


                // البوت خرج من الروم
                if (
                    oldChannelId &&
                    !newChannelId &&
                    oldChannelId === FIXED_VOICE_CHANNEL_ID
                ) {

                    console.log(
                        chalk.yellow(
                            '🔒 البوت خرج من الروم الثابت، جاري إرجاعه...'
                        )
                    );

                    setTimeout(() => {
                        connectToFixedVoiceChannel(client);
                    }, 1500);

                    return;
                }


                // أحد نقل البوت لروم ثاني
                if (
                    newChannelId &&
                    newChannelId !== FIXED_VOICE_CHANNEL_ID
                ) {

                    console.log(
                        chalk.yellow(
                            '🔒 تم نقل البوت من الروم الثابت، جاري إرجاعه...'
                        )
                    );

                    setTimeout(() => {
                        connectToFixedVoiceChannel(client);
                    }, 1500);

                    return;
                }
            }


            // ====================================================
            // Player
            // ====================================================

            const player =
                client.players.get(guild.id);

            if (!player) {
                return;
            }


            if (involvesBot) {

                const oldChannelId =
                    oldState.channelId;

                const newChannelId =
                    newState.channelId;


                // ==================================================
                // البوت خرج من روم عادي
                // ==================================================

                if (
                    oldChannelId &&
                    !newChannelId
                ) {

                    // إذا كان الروم الثابت، لا ننهي الجلسة
                    if (
                        oldChannelId ===
                        FIXED_VOICE_CHANNEL_ID
                    ) {

                        setTimeout(() => {
                            connectToFixedVoiceChannel(client);
                        }, 1500);

                        return;
                    }

                    try {

                        const embedManager =
                            client.musicEmbedManager ||
                            global.clients?.musicEmbedManager;

                        player.pendingEndReason =
                            'forced-disconnect';

                        player.queue = [];

                        player.currentTrack = null;

                        if (embedManager) {

                            await embedManager
                                .handlePlaybackEnd(player);

                        } else if (
                            typeof player.showQueueCompleted ===
                            'function'
                        ) {

                            await player.showQueueCompleted();

                        }

                    } catch (error) {

                        console.error(
                            '❌ Failed to update playback UI after forced disconnect:',
                            error
                        );

                    } finally {

                        player.cleanup();

                        client.players.delete(
                            guild.id
                        );

                    }

                    return;
                }


                // ==================================================
                // البوت انتقل لروم آخر
                // ==================================================

                if (
                    newChannelId &&
                    oldChannelId !== newChannelId
                ) {

                    // الروم الثابت ممنوع يتركه
                    if (
                        newChannelId !==
                        FIXED_VOICE_CHANNEL_ID
                    ) {

                        setTimeout(() => {
                            connectToFixedVoiceChannel(client);
                        }, 1500);

                        return;
                    }

                    if (newState.channel) {

                        await player.moveToChannel(
                            newState.channel
                        );

                        player.clearInactivityTimer(
                            false
                        );

                        if (
                            client.musicEmbedManager
                        ) {

                            await client.musicEmbedManager
                                .updateNowPlayingEmbed(
                                    player
                                );
                        }
                    }
                }


                // ==================================================
                // Mute / Deaf
                // ==================================================

                const wasMuted =
                    oldState.serverMute ||
                    oldState.serverDeaf ||
                    oldState.suppress;

                const isMuted =
                    newState.serverMute ||
                    newState.serverDeaf ||
                    newState.suppress;


                if (
                    !wasMuted &&
                    isMuted
                ) {

                    const paused =
                        player.pauseFor('mute');

                    if (
                        paused &&
                        client.musicEmbedManager
                    ) {

                        await client.musicEmbedManager
                            .updateNowPlayingEmbed(
                                player
                            );
                    }

                } else if (
                    wasMuted &&
                    !isMuted
                ) {

                    const resumed =
                        player.resumeFor('mute');

                    if (
                        client.musicEmbedManager &&
                        (
                            resumed ||
                            !player.pauseReasons.has(
                                'mute'
                            )
                        )
                    ) {

                        await client.musicEmbedManager
                            .updateNowPlayingEmbed(
                                player
                            );
                    }
                }
            }


            // ====================================================
            // 🔒 مراقبة الأشخاص داخل الروم
            // ====================================================

            const voiceChannelId =
                player.voiceChannel?.id;

            if (!voiceChannelId) {
                return;
            }


            const channel =
                guild.channels.cache.get(
                    voiceChannelId
                );

            if (!channel) {

                // لا نحذف الـ player إذا كان الروم الثابت
                if (
                    voiceChannelId !==
                    FIXED_VOICE_CHANNEL_ID
                ) {

                    player.cleanup();

                    client.players.delete(
                        guild.id
                    );
                }

                return;
            }


            // ====================================================
            // 🔒 إذا كان الروم ثابت، لا تستخدم inactivity timer
            // ====================================================

            if (
                voiceChannelId ===
                FIXED_VOICE_CHANNEL_ID
            ) {

                player.clearInactivityTimer(
                    false
                );

                return;
            }


            // ====================================================
            // السلوك الطبيعي للرومات الأخرى
            // ====================================================

            if (
                oldState.channelId ===
                    voiceChannelId ||
                newState.channelId ===
                    voiceChannelId
            ) {

                const listeners =
                    channel.members.filter(
                        member =>
                            !member.user.bot
                    ).size;


                if (listeners === 0) {

                    const alreadyPaused =
                        player.pauseReasons.has(
                            'alone'
                        );

                    player.startInactivityTimer();

                    if (
                        !alreadyPaused &&
                        client.musicEmbedManager &&
                        player.currentTrack
                    ) {

                        await client.musicEmbedManager
                            .updateNowPlayingEmbed(
                                player
                            );
                    }

                } else {

                    const wasPausedForAlone =
                        player.pauseReasons.has(
                            'alone'
                        );

                    player.clearInactivityTimer(
                        true
                    );

                    if (
                        wasPausedForAlone &&
                        client.musicEmbedManager &&
                        player.currentTrack
                    ) {

                        await client.musicEmbedManager
                            .updateNowPlayingEmbed(
                                player
                            );
                    }
                }
            }
        }
    );


    // ========================================================
    // Process termination
    // ========================================================

    process.on('SIGINT', () => {

        if (fixedVoiceWatchdog) {
            clearInterval(fixedVoiceWatchdog);
        }

        if (fixedVoiceReconnectTimer) {
            clearTimeout(fixedVoiceReconnectTimer);
        }

        client.players.forEach(
            (player, guildId) => {

                player.stop();

                const connection =
                    getVoiceConnection(guildId);

                if (connection) {
                    connection.destroy();
                }
            }
        );

        if (fixedVoiceConnection) {
            try {
                fixedVoiceConnection.destroy();
            } catch {}
        }

        client.destroy();

        process.exit(0);
    });


    // ========================================================
    // Unhandled Rejection
    // ========================================================

    process.on(
        'unhandledRejection',
        (reason, promise) => {

            console.error(
                chalk.red(
                    '❌ Unhandled Rejection at:'
                ),
                promise,
                chalk.red('reason:'),
                reason
            );


            if (reason && reason.code) {

                switch (reason.code) {

                    case 10062:

                        console.log(
                            chalk.yellow(
                                'ℹ️ Interaction has expired, safely ignoring...'
                            )
                        );

                        return;

                    case 40060:

                        console.log(
                            chalk.yellow(
                                'ℹ️ Interaction already acknowledged, safely ignoring...'
                            )
                        );

                        return;

                    case 50013:

                        console.error(
                            chalk.red(
                                '❌ Missing permissions for Discord action'
                            )
                        );

                        return;
                }
            }


            if (
                reason &&
                reason.message &&
                reason.message.includes(
                    'IP discovery'
                )
            ) {

                console.log(
                    chalk.yellow(
                        '⚠️ Voice IP discovery error. Fixed voice connection will be restored automatically.'
                    )
                );

                return;
            }
        }
    );


    // ========================================================
    // Uncaught Exception
    // ========================================================

    process.on(
        'uncaughtException',
        (error) => {

            console.error(
                chalk.red(
                    '❌ Uncaught Exception:'
                ),
                error
            );


            if (
                error.code === 10062 ||
                error.code === 40060
            ) {

                console.log(
                    chalk.yellow(
                        'ℹ️ Discord interaction error handled, continuing...'
                    )
                );

                return;
            }


            if (
                error.message &&
                (
                    error.message.includes(
                        'terminated'
                    ) ||
                    error.message.includes(
                        'ECONNRESET'
                    ) ||
                    error.message.includes(
                        'ETIMEDOUT'
                    )
                )
            ) {

                console.log(
                    chalk.yellow(
                        '⚠️ Network error occurred, but bot continues running...'
                    )
                );

                return;
            }


            console.log(
                chalk.red(
                    '🛑 Critical error occurred, shutting down...'
                )
            );


            if (
                client &&
                client.players
            ) {

                client.players.forEach(
                    player => {

                        if (
                            player &&
                            player.cleanup
                        ) {

                            player.cleanup();
                        }
                    }
                );

                client.players.clear();
            }


            process.exit(1);
        }
    );


    // ========================================================
    // Initialize bot
    // ========================================================

    const init = async () => {

        try {

            console.log(
                chalk.blue(
                    '🤖 Starting Discord Music Bot...'
                )
            );


            // Load commands
            loadCommands();

            // Load events
            loadEvents();


            // ==================================================
            // Graceful shutdown
            // ==================================================

            const gracefulShutdown =
                async (signal) => {

                    const savePromises = [];

                    for (
                        const [
                            guildId,
                            player
                        ] of client.players
                    ) {

                        if (
                            player &&
                            typeof player.persistState ===
                            'function'
                        ) {

                            savePromises.push(
                                player
                                    .persistState(
                                        'shutdown',
                                        true
                                    )
                                    .catch(
                                        err => {

                                            console.error(
                                                chalk.red(
                                                    `Failed to save state for guild ${guildId}:`
                                                ),
                                                err
                                            );
                                        }
                                    )
                            );
                        }
                    }


                    await Promise.all(
                        savePromises
                    );


                    await new Promise(
                        resolve =>
                            setTimeout(
                                resolve,
                                1000
                            )
                    );


                    if (fixedVoiceWatchdog) {
                        clearInterval(
                            fixedVoiceWatchdog
                        );
                    }


                    if (fixedVoiceReconnectTimer) {
                        clearTimeout(
                            fixedVoiceReconnectTimer
                        );
                    }


                    process.exit(0);
                };


            process.on(
                'SIGINT',
                () => gracefulShutdown('SIGINT')
            );

            process.on(
                'SIGTERM',
                () => gracefulShutdown('SIGTERM')
            );


            // Windows
            if (
                process.platform ===
                'win32'
            ) {

                const readline =
                    require('readline');

                if (
                    process.stdin.isTTY
                ) {

                    readline
                        .createInterface({
                            input: process.stdin,
                            output: process.stdout
                        })
                        .on(
                            'SIGINT',
                            () =>
                                gracefulShutdown(
                                    'SIGINT'
                                )
                        );
                }
            }


            // ==================================================
            // Login
            // ==================================================

            await client.login(
                config.discord.token
            );

        } catch (error) {

            console.error(
                chalk.red(
                    '❌ Failed to start bot:'
                ),
                error
            );

            process.exit(1);
        }
    };


    // ========================================================
    // Start
    // ========================================================

    init();


    module.exports = client;

}, 5000);
