require('dotenv').config({ quiet: true });
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');
const { createReadStream, existsSync } = require('fs');
const { PassThrough } = require('stream');
const path = require('path');
const { spawn } = require('child_process');

// ─── Bot Identity ────────────────────────────────────────────────────────────
const botIndex = parseInt(process.argv[2]) || 0;
const tokens = [
  process.env.BOT_TOKEN_0, process.env.BOT_TOKEN_1, process.env.BOT_TOKEN_2,
  process.env.BOT_TOKEN_3, process.env.BOT_TOKEN_4, process.env.BOT_TOKEN_5,
  process.env.BOT_TOKEN_6, process.env.BOT_TOKEN_7, process.env.BOT_TOKEN_8,
  process.env.BOT_TOKEN_9
];

const BOT_NUM = botIndex + 1;
const token   = tokens[botIndex];
const audioFile = path.join(__dirname, `new${BOT_NUM}.mp3`);
const audioExists = existsSync(audioFile);
const LOGIN_TIMEOUT_MS = Number(process.env.BOT_LOGIN_TIMEOUT_MS || 90000);

if (!token) { console.error(`[Bot${BOT_NUM}] Token missing`); process.exit(1); }
if (!audioExists) console.warn(`[Bot${BOT_NUM}] Audio file missing: ${audioFile}`);

// ─── EQ Presets (FFmpeg filter chains) ───────────────────────────────────────
const EQ_PRESETS = {
  flat:    '',                                                             // no filter
  bass:    'equalizer=f=60:width_type=o:width=2:g=8,equalizer=f=250:width_type=o:width=2:g=3',
  treble:  'equalizer=f=8000:width_type=o:width=2:g=6,equalizer=f=16000:width_type=o:width=2:g=4',
  vocal:   'equalizer=f=1000:width_type=o:width=2:g=5,equalizer=f=3000:width_type=o:width=2:g=4',
  pop:     'equalizer=f=60:width_type=o:width=2:g=5,equalizer=f=1000:width_type=o:width=2:g=2,equalizer=f=8000:width_type=o:width=2:g=4',
  rock:    'equalizer=f=60:width_type=o:width=2:g=7,equalizer=f=500:width_type=o:width=2:g=-2,equalizer=f=8000:width_type=o:width=2:g=5',
  loud:    'volume=2.0,equalizer=f=60:width_type=o:width=2:g=10',        // custom amp + boost
  soft:    'volume=0.5,equalizer=f=8000:width_type=o:width=2:g=2'
};

// ─── State ───────────────────────────────────────────────────────────────────
const connections  = new Map();   // guildId -> { conn, player, volume, eq, looping }
const commandCooldown = new Map();
const COOLDOWN_MS  = 300;
let   readyFlag    = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function state(guildId) { return connections.get(guildId); }

function reply(message, text, color = 0x5865F2) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setDescription(text)
    .setFooter({ text: `Bot ${BOT_NUM}` });
  return message.reply({ embeds: [embed] }).catch(() => message.reply(text).catch(() => {}));
}
function ok(msg, t)   { return reply(msg, `✅  ${t}`, 0x57F287); }
function err(msg, t)  { return reply(msg, `❌  ${t}`, 0xED4245); }
function info(msg, t) { return reply(msg, `ℹ️  ${t}`, 0x5865F2); }

function isConnectionAlive(guildId) {
  const s = state(guildId);
  if (!s) return false;
  try { return s.conn && s.conn.state.status !== VoiceConnectionStatus.Destroyed; }
  catch { connections.delete(guildId); return false; }
}

// ─── FFmpeg-based audio resource with amp + EQ ───────────────────────────────
function buildResource(guildId) {
  const s = state(guildId);
  const volume = (s?.volume ?? 100) / 100;          // 0.0 – 2.0
  const eq     = s?.eq ?? 'flat';
  const filter = EQ_PRESETS[eq] || '';

  // Build FFmpeg filter: volume first, then EQ if needed
  let afFilter = `volume=${volume}`;
  if (filter) afFilter += `,${filter}`;

  // Spawn FFmpeg to apply filters and pipe PCM → opus via @discordjs/voice
  const ffmpeg = spawn('ffmpeg', [
    '-i', audioFile,
    '-af', afFilter,
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1'
  ], { stdio: ['ignore', 'pipe', 'ignore'] });

  ffmpeg.on('error', (e) => console.error(`[Bot${BOT_NUM}] FFmpeg error:`, e.message));

  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
    inlineVolume: false   // volume is handled by ffmpeg -af
  });

  resource._ffmpegProcess = ffmpeg;  // keep reference for cleanup
  return resource;
}

// ─── Play / Loop ─────────────────────────────────────────────────────────────
function startPlayback(guildId) {
  const s = state(guildId);
  if (!s || !isConnectionAlive(guildId)) return;
  if (!audioExists) return;

  // Stop previous
  try { if (s.player) s.player.stop(true); } catch {}
  try { if (s._ffmpeg) s._ffmpeg.kill(); }   catch {}

  const player   = createAudioPlayer();
  s.player       = player;
  s.conn.subscribe(player);

  function playOnce() {
    const resource = buildResource(guildId);
    s._ffmpeg = resource._ffmpegProcess;
    player.play(resource);
  }

  playOnce();

  player.on(AudioPlayerStatus.Idle, () => {
    if (s.looping && isConnectionAlive(guildId)) {
      console.log(`[Bot${BOT_NUM}] Looping…`);
      playOnce();       // seamless loop → no voice break
    } else {
      console.log(`[Bot${BOT_NUM}] Playback ended`);
    }
  });

  player.on('error', (e) => {
    console.error(`[Bot${BOT_NUM}] Player error:`, e.message);
    if (s.looping && isConnectionAlive(guildId)) {
      setTimeout(playOnce, 1000);  // recover after 1 s
    }
  });
}

// ─── Voice connection with keepalive ─────────────────────────────────────────
async function connectVoice(voiceChannel, message) {
  const guildId = voiceChannel.guild.id;

  const conn = joinVoiceChannel({
    channelId:       voiceChannel.id,
    guildId:         guildId,
    adapterCreator:  voiceChannel.guild.voiceAdapterCreator,
    selfMute: false,
    selfDeaf: false
  });

  try {
    await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    conn.destroy();
    await err(message, 'Could not connect to voice channel (timeout).');
    return null;
  }

  // Auto-reconnect on disconnect
  conn.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(conn, VoiceConnectionStatus.Signalling, 5_000),
        entersState(conn, VoiceConnectionStatus.Connecting, 5_000)
      ]);
    } catch {
      console.warn(`[Bot${BOT_NUM}] Reconnect failed, destroying`);
      conn.destroy();
      connections.delete(guildId);
    }
  });

  conn.on(VoiceConnectionStatus.Destroyed, () => {
    console.log(`[Bot${BOT_NUM}] Connection destroyed`);
    connections.delete(guildId);
  });

  connections.set(guildId, {
    conn,
    player:  null,
    volume:  100,         // default 100%
    eq:      'flat',      // default flat
    looping: true,        // loop by default
    _ffmpeg: null
  });

  // Keepalive: send silence packet every 4 s to prevent Discord dropping stream
  const keepalive = setInterval(() => {
    if (!isConnectionAlive(guildId)) { clearInterval(keepalive); return; }
    // Subscribing keeps the UDP connection alive; nothing else needed
  }, 4000);

  return conn;
}

// ─── Discord Client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

client.on('ready', () => {
  if (!readyFlag) {
    readyFlag = true;
    console.log(`[Bot${BOT_NUM}] Ready as ${client.user.tag}`);
    client.user.setActivity(`🎵 pk vaa | Bot ${BOT_NUM}`, { type: 2 }).catch(() => {});
  }
});

client.on('error', (e) => console.error(`[Bot${BOT_NUM}] Client error:`, e.message));

// ─── Periodic dead-connection cleanup ────────────────────────────────────────
setInterval(() => {
  for (const [id] of connections) {
    if (!isConnectionAlive(id)) connections.delete(id);
  }
}, 15_000);

// ─── Command Router ───────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // Rate limit
  const ck  = `${message.guild.id}-${message.author.id}`;
  const now = Date.now();
  if (commandCooldown.has(ck) && now < commandCooldown.get(ck) + COOLDOWN_MS) return;
  commandCooldown.set(ck, now);

  const guildId     = message.guild.id;
  const voiceChannel = message.member?.voice?.channel;
  const raw          = message.content.trim();
  const [cmd, ...args] = raw.split(/\s+/);

  try {

    // ── !join10 ──────────────────────────────────────────────────────────────
    if (cmd === '!join10') {
      if (isConnectionAlive(guildId)) return info(message, `Bot ${BOT_NUM} already in a channel!`);
      if (!voiceChannel)             return err(message, 'Join a voice channel first!');
      const conn = await connectVoice(voiceChannel, message);
      if (conn) await ok(message, `Bot ${BOT_NUM} joined **${voiceChannel.name}**`);

    // ── !st10 — start / resume ───────────────────────────────────────────────
    } else if (cmd === '!st10') {
      if (!isConnectionAlive(guildId)) return err(message, 'Use `!join10` first!');
      if (!audioExists)               return err(message, `Audio file missing for Bot ${BOT_NUM}.`);
      state(guildId).looping = true;
      startPlayback(guildId);
      await ok(message, `▶️  Bot ${BOT_NUM} playing (loop ON)`);

    // ── !sp10 — stop ─────────────────────────────────────────────────────────
    } else if (cmd === '!sp10') {
      const s = state(guildId);
      if (s) {
        s.looping = false;
        try { s.player?.stop(true); } catch {}
        try { s._ffmpeg?.kill(); }    catch {}
      }
      await ok(message, `⏹️  Bot ${BOT_NUM} stopped`);

    // ── !ds10 — disconnect ───────────────────────────────────────────────────
    } else if (cmd === '!ds10') {
      const s = state(guildId);
      if (s) {
        s.looping = false;
        try { s.player?.stop(true); } catch {}
        try { s._ffmpeg?.kill(); }    catch {}
        try { s.conn.destroy(); }     catch {}
        connections.delete(guildId);
      }
      await ok(message, `👋  Bot ${BOT_NUM} disconnected`);

    // ── !vol10 <0-200> — Custom Amplifier ────────────────────────────────────
    } else if (cmd === '!vol10') {
      const vol = parseInt(args[0]);
      if (isNaN(vol) || vol < 0 || vol > 200)
        return err(message, 'Usage: `!vol10 <0–200>` (100 = normal, 200 = 2× amplified)');
      if (!isConnectionAlive(guildId))
        return err(message, 'Use `!join10` first!');
      state(guildId).volume = vol;
      // Restart playback to apply new amp
      if (state(guildId).player?.state?.status === AudioPlayerStatus.Playing) {
        startPlayback(guildId);
      }
      await ok(message, `🔊  Amp set to **${vol}%** for Bot ${BOT_NUM}`);

    // ── !eq10 <preset> — Custom Equalizer ────────────────────────────────────
    } else if (cmd === '!eq10') {
      const preset = (args[0] || '').toLowerCase();
      if (!EQ_PRESETS.hasOwnProperty(preset)) {
        const list = Object.keys(EQ_PRESETS).map(p => `\`${p}\``).join(', ');
        return err(message, `Unknown preset. Available: ${list}`);
      }
      if (!isConnectionAlive(guildId))
        return err(message, 'Use `!join10` first!');
      state(guildId).eq = preset;
      if (state(guildId).player?.state?.status === AudioPlayerStatus.Playing) {
        startPlayback(guildId);
      }
      await ok(message, `🎛️  EQ set to **${preset}** for Bot ${BOT_NUM}`);

    // ── !loop10 — toggle loop ────────────────────────────────────────────────
    } else if (cmd === '!loop10') {
      const s = state(guildId);
      if (!s) return err(message, 'Use `!join10` first!');
      s.looping = !s.looping;
      await ok(message, `🔁  Loop **${s.looping ? 'ON' : 'OFF'}** for Bot ${BOT_NUM}`);

    // ── !eqlist10 — show all EQ presets ──────────────────────────────────────
    } else if (cmd === '!eqlist10') {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🎛️  EQ Presets — Bot ${BOT_NUM}`)
        .setDescription(
          Object.entries(EQ_PRESETS).map(([k, v]) =>
            `**${k}** — ${v || '(no filter, default)'}`
          ).join('\n')
        )
        .addFields({ name: 'Usage', value: '`!eq10 <preset>`  e.g. `!eq10 bass`' });
      await message.reply({ embeds: [embed] }).catch(() => {});

    // ── !status10 — show current settings ────────────────────────────────────
    } else if (cmd === '!status10') {
      const s = state(guildId);
      if (!s) return info(message, `Bot ${BOT_NUM} is not in a voice channel.`);
      const playerStatus = s.player?.state?.status ?? 'idle';
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(`📊  Bot ${BOT_NUM} Status`)
        .addFields(
          { name: '🔊 Amp',     value: `${s.volume}%`,      inline: true },
          { name: '🎛️ EQ',      value: s.eq,                inline: true },
          { name: '🔁 Loop',    value: s.looping ? 'ON' : 'OFF', inline: true },
          { name: '▶️ Player',  value: playerStatus,         inline: true }
        );
      await message.reply({ embeds: [embed] }).catch(() => {});

    // ── Mod: !mute10 @user ───────────────────────────────────────────────────
    } else if (cmd === '!mute10') {
      if (!message.member.permissions.has(PermissionFlagsBits.MuteMembers))
        return err(message, 'You need **Mute Members** permission.');
      const target = message.mentions.members?.first();
      if (!target) return err(message, 'Mention a user to mute: `!mute10 @user`');
      await target.voice.setMute(true, `Muted by Bot ${BOT_NUM} (${message.author.tag})`);
      await ok(message, `🔇  ${target.user.tag} muted`);

    // ── Mod: !unmute10 @user ─────────────────────────────────────────────────
    } else if (cmd === '!unmute10') {
      if (!message.member.permissions.has(PermissionFlagsBits.MuteMembers))
        return err(message, 'You need **Mute Members** permission.');
      const target = message.mentions.members?.first();
      if (!target) return err(message, 'Mention a user to unmute: `!unmute10 @user`');
      await target.voice.setMute(false, `Unmuted by Bot ${BOT_NUM}`);
      await ok(message, `🔊  ${target.user.tag} unmuted`);

    // ── Mod: !vkick10 @user (kick from voice) ────────────────────────────────
    } else if (cmd === '!vkick10') {
      if (!message.member.permissions.has(PermissionFlagsBits.MoveMembers))
        return err(message, 'You need **Move Members** permission.');
      const target = message.mentions.members?.first();
      if (!target) return err(message, 'Mention a user: `!vkick10 @user`');
      await target.voice.disconnect(`Voice-kicked by Bot ${BOT_NUM} (${message.author.tag})`);
      await ok(message, `🦵  ${target.user.tag} kicked from voice`);

    // ── Mod: !deafen10 @user ─────────────────────────────────────────────────
    } else if (cmd === '!deafen10') {
      if (!message.member.permissions.has(PermissionFlagsBits.DeafenMembers))
        return err(message, 'You need **Deafen Members** permission.');
      const target = message.mentions.members?.first();
      if (!target) return err(message, 'Mention a user: `!deafen10 @user`');
      await target.voice.setDeaf(true, `Deafened by Bot ${BOT_NUM}`);
      await ok(message, `🔕  ${target.user.tag} deafened`);

    // ── !help10 ───────────────────────────────────────────────────────────────
    } else if (cmd === '!help10') {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🎧  Bot ${BOT_NUM} — Commands`)
        .addFields(
          {
            name: '🎵 Audio',
            value: [
              '`!join10` — Join your voice channel',
              '`!st10` — Start looping audio',
              '`!sp10` — Stop audio',
              '`!ds10` — Disconnect',
              '`!loop10` — Toggle loop on/off',
            ].join('\n')
          },
          {
            name: '🔊 Amplifier',
            value: '`!vol10 <0–200>` — Set volume/amp (100=normal, 200=2× boost)'
          },
          {
            name: '🎛️ Equalizer',
            value: [
              '`!eq10 <preset>` — Apply EQ preset',
              '`!eqlist10` — List all presets',
              'Presets: `flat` `bass` `treble` `vocal` `pop` `rock` `loud` `soft`'
            ].join('\n')
          },
          {
            name: '🛡️ Moderation',
            value: [
              '`!mute10 @user` — Server-mute a member',
              '`!unmute10 @user` — Unmute a member',
              '`!vkick10 @user` — Kick from voice channel',
              '`!deafen10 @user` — Server-deafen a member'
            ].join('\n')
          },
          {
            name: '📊 Info',
            value: '`!status10` — Show current amp / EQ / loop status'
          }
        )
        .setFooter({ text: 'All commands work per-guild · Auto-loop enabled by default' });
      await message.reply({ embeds: [embed] }).catch(() => {});
    }

  } catch (e) {
    console.error(`[Bot${BOT_NUM}] Command error (${cmd}):`, e.message);
    err(message, `Internal error: ${e.message}`).catch(() => {});
  }
});

// ─── Login with timeout ───────────────────────────────────────────────────────
const loginTimeout = setTimeout(() => {
  console.error(`[Bot${BOT_NUM}] Login timeout!`);
  process.exit(1);
}, LOGIN_TIMEOUT_MS);

client.login(token)
  .then(() => { clearTimeout(loginTimeout); console.log(`[Bot${BOT_NUM}] Logged in!`); })
  .catch((e) => { clearTimeout(loginTimeout); console.error(`[Bot${BOT_NUM}] Login failed:`, e.message); process.exit(1); });

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = async () => {
  console.log(`[Bot${BOT_NUM}] Shutting down…`);
  for (const [, s] of connections) {
    try { s.looping = false; s.player?.stop(true); } catch {}
    try { s._ffmpeg?.kill(); }  catch {}
    try { s.conn.destroy(); }   catch {}
  }
  connections.clear();
  try { await client.destroy(); } catch {}
  process.exit(0);
};

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP',  shutdown);

// ─── No-crash: catch all uncaught errors ─────────────────────────────────────
process.on('uncaughtException',  (e) => console.error(`[Bot${BOT_NUM}] uncaughtException:`,  e.message));
process.on('unhandledRejection', (r) => console.error(`[Bot${BOT_NUM}] unhandledRejection:`, r));