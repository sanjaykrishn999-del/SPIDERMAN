/**
 * index.js — Single-process fallback runner
 * Runs all 10 bots in one process (use bot.js + PM2 for production).
 * All amp / EQ / mod / loop commands are supported here too.
 */
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, StreamType, VoiceConnectionStatus, entersState
} = require('@discordjs/voice');
const path  = require('path');
const http  = require('http');
const { spawn } = require('child_process');
const { existsSync } = require('fs');

// ── Keep-alive web server (for cloud platforms like Render / Fly) ─────────────
const port = process.env.PORT || 10000;
http.createServer((_, res) => {
  res.writeHead(200); res.end('Dark Empire Bots — Running\n');
}).listen(port, () => console.log(`[Web] Listening on port ${port}`));

// ── EQ Presets ────────────────────────────────────────────────────────────────
const EQ_PRESETS = {
  flat:   '',
  bass:   'equalizer=f=60:width_type=o:width=2:g=8,equalizer=f=250:width_type=o:width=2:g=3',
  treble: 'equalizer=f=8000:width_type=o:width=2:g=6,equalizer=f=16000:width_type=o:width=2:g=4',
  vocal:  'equalizer=f=1000:width_type=o:width=2:g=5,equalizer=f=3000:width_type=o:width=2:g=4',
  pop:    'equalizer=f=60:width_type=o:width=2:g=5,equalizer=f=1000:width_type=o:width=2:g=2,equalizer=f=8000:width_type=o:width=2:g=4',
  rock:   'equalizer=f=60:width_type=o:width=2:g=7,equalizer=f=500:width_type=o:width=2:g=-2,equalizer=f=8000:width_type=o:width=2:g=5',
  loud:   'volume=2.0,equalizer=f=60:width_type=o:width=2:g=10',
  soft:   'volume=0.5,equalizer=f=8000:width_type=o:width=2:g=2'
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function embed(text, color = 0x5865F2, footer = '') {
  return new EmbedBuilder().setColor(color).setDescription(text)
    .setFooter({ text: footer });
}
function ok(msg, t, footer)   { return msg.reply({ embeds: [embed(`✅  ${t}`, 0x57F287, footer)] }).catch(() => {}); }
function fail(msg, t, footer) { return msg.reply({ embeds: [embed(`❌  ${t}`, 0xED4245, footer)] }).catch(() => {}); }
function info(msg, t, footer) { return msg.reply({ embeds: [embed(`ℹ️  ${t}`, 0x5865F2, footer)] }).catch(() => {}); }

// ── Bot factory ───────────────────────────────────────────────────────────────
async function createBot(botIndex) {
  const BOT_NUM  = botIndex + 1;
  const token    = process.env[`BOT_TOKEN_${botIndex}`];
  const audioFile = path.join(__dirname, `new${BOT_NUM}.mp3`);
  if (!token) { console.error(`[Bot${BOT_NUM}] No token`); return; }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers
    ]
  });

  // Per-guild state
  const connections    = new Map();
  const cmdCooldown    = new Map();
  const COOLDOWN_MS    = 300;

  function getState(guildId) { return connections.get(guildId); }

  function isAlive(guildId) {
    const s = getState(guildId);
    if (!s) return false;
    try { return s.conn.state.status !== VoiceConnectionStatus.Destroyed; }
    catch { connections.delete(guildId); return false; }
  }

  // ── FFmpeg resource with amp + EQ ──────────────────────────────────────────
  function buildResource(guildId) {
    const s = getState(guildId);
    const vol    = (s?.volume ?? 100) / 100;
    const eq     = s?.eq ?? 'flat';
    const filter = EQ_PRESETS[eq] || '';
    let afFilter = `volume=${vol}`;
    if (filter) afFilter += `,${filter}`;

    const ff = spawn('ffmpeg', [
      '-i', audioFile, '-af', afFilter,
      '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    ff.on('error', e => console.error(`[Bot${BOT_NUM}] FFmpeg:`, e.message));
    const res = createAudioResource(ff.stdout, { inputType: StreamType.Raw, inlineVolume: false });
    res._ff = ff;
    return res;
  }

  // ── Playback (loop-safe) ───────────────────────────────────────────────────
  function startPlayback(guildId) {
    const s = getState(guildId);
    if (!s || !isAlive(guildId) || !existsSync(audioFile)) return;

    try { s.player?.stop(true); }  catch {}
    try { s._ff?.kill(); }         catch {}

    const player = createAudioPlayer();
    s.player = player;
    s.conn.subscribe(player);

    function playOnce() {
      const res = buildResource(guildId);
      s._ff = res._ff;
      player.play(res);
    }

    playOnce();

    player.on(AudioPlayerStatus.Idle, () => {
      if (s.looping && isAlive(guildId)) playOnce();
    });
    player.on('error', e => {
      console.error(`[Bot${BOT_NUM}] Player error:`, e.message);
      if (s.looping && isAlive(guildId)) setTimeout(playOnce, 1000);
    });
  }

  // ── Voice join with reconnect ──────────────────────────────────────────────
  async function joinVoice(vc, message) {
    const guildId = vc.guild.id;
    const conn = joinVoiceChannel({
      channelId: vc.id, guildId,
      adapterCreator: vc.guild.voiceAdapterCreator,
      selfMute: false, selfDeaf: false
    });
    try { await entersState(conn, VoiceConnectionStatus.Ready, 20_000); }
    catch { conn.destroy(); await fail(message, 'Voice connect timeout.', `Bot ${BOT_NUM}`); return null; }

    conn.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(conn, VoiceConnectionStatus.Signalling, 5_000),
          entersState(conn, VoiceConnectionStatus.Connecting, 5_000)
        ]);
      } catch { conn.destroy(); connections.delete(guildId); }
    });

    conn.on(VoiceConnectionStatus.Destroyed, () => connections.delete(guildId));
    connections.set(guildId, { conn, player: null, volume: 100, eq: 'flat', looping: true, _ff: null });
    return conn;
  }

  // ── Message handler ────────────────────────────────────────────────────────
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const ck  = `${message.guild.id}-${message.author.id}`;
    const now = Date.now();
    if (cmdCooldown.has(ck) && now < cmdCooldown.get(ck) + COOLDOWN_MS) return;
    cmdCooldown.set(ck, now);

    const guildId = message.guild.id;
    const vc      = message.member?.voice?.channel;
    const [cmd, ...args] = message.content.trim().split(/\s+/);
    const footer  = `Bot ${BOT_NUM}`;

    try {
      if (cmd === '!join10') {
        if (isAlive(guildId)) return info(message, `Bot ${BOT_NUM} already connected!`, footer);
        if (!vc)              return fail(message, 'Join a voice channel first!', footer);
        const conn = await joinVoice(vc, message);
        if (conn) await ok(message, `Bot ${BOT_NUM} joined **${vc.name}**`, footer);

      } else if (cmd === '!st10') {
        if (!isAlive(guildId))       return fail(message, 'Use `!join10` first!', footer);
        if (!existsSync(audioFile))  return fail(message, `Audio file missing for Bot ${BOT_NUM}`, footer);
        getState(guildId).looping = true;
        startPlayback(guildId);
        await ok(message, `▶️  Bot ${BOT_NUM} playing (loop ON)`, footer);

      } else if (cmd === '!sp10') {
        const s = getState(guildId);
        if (s) { s.looping = false; try { s.player?.stop(true); } catch {} try { s._ff?.kill(); } catch {} }
        await ok(message, `⏹️  Bot ${BOT_NUM} stopped`, footer);

      } else if (cmd === '!ds10') {
        const s = getState(guildId);
        if (s) {
          s.looping = false;
          try { s.player?.stop(true); } catch {}
          try { s._ff?.kill(); }         catch {}
          try { s.conn.destroy(); }      catch {}
          connections.delete(guildId);
        }
        await ok(message, `👋  Bot ${BOT_NUM} disconnected`, footer);

      } else if (cmd === '!vol10') {
        const vol = parseInt(args[0]);
        if (isNaN(vol) || vol < 0 || vol > 200)
          return fail(message, 'Usage: `!vol10 <0–200>`  (100 = normal, 200 = 2× amp)', footer);
        if (!isAlive(guildId)) return fail(message, 'Use `!join10` first!', footer);
        getState(guildId).volume = vol;
        if (getState(guildId).player?.state?.status === AudioPlayerStatus.Playing)
          startPlayback(guildId);
        await ok(message, `🔊  Amp → **${vol}%** for Bot ${BOT_NUM}`, footer);

      } else if (cmd === '!eq10') {
        const preset = (args[0] || '').toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(EQ_PRESETS, preset)) {
          const list = Object.keys(EQ_PRESETS).map(p => `\`${p}\``).join(', ');
          return fail(message, `Unknown preset. Available: ${list}`, footer);
        }
        if (!isAlive(guildId)) return fail(message, 'Use `!join10` first!', footer);
        getState(guildId).eq = preset;
        if (getState(guildId).player?.state?.status === AudioPlayerStatus.Playing)
          startPlayback(guildId);
        await ok(message, `🎛️  EQ → **${preset}** for Bot ${BOT_NUM}`, footer);

      } else if (cmd === '!loop10') {
        const s = getState(guildId);
        if (!s) return fail(message, 'Use `!join10` first!', footer);
        s.looping = !s.looping;
        await ok(message, `🔁  Loop **${s.looping ? 'ON' : 'OFF'}** — Bot ${BOT_NUM}`, footer);

      } else if (cmd === '!eqlist10') {
        const e = new EmbedBuilder().setColor(0x5865F2)
          .setTitle(`🎛️  EQ Presets — Bot ${BOT_NUM}`)
          .setDescription(Object.keys(EQ_PRESETS).map(k => `**${k}**`).join(' · '))
          .addFields({ name: 'Usage', value: '`!eq10 <preset>` — e.g. `!eq10 bass`' });
        await message.reply({ embeds: [e] }).catch(() => {});

      } else if (cmd === '!status10') {
        const s = getState(guildId);
        if (!s) return info(message, `Bot ${BOT_NUM} not in a channel.`, footer);
        const e = new EmbedBuilder().setColor(0x57F287)
          .setTitle(`📊  Bot ${BOT_NUM} Status`)
          .addFields(
            { name: '🔊 Amp',    value: `${s.volume}%`,               inline: true },
            { name: '🎛️ EQ',     value: s.eq,                         inline: true },
            { name: '🔁 Loop',   value: s.looping ? 'ON' : 'OFF',     inline: true },
            { name: '▶️ Player', value: s.player?.state?.status ?? 'idle', inline: true }
          );
        await message.reply({ embeds: [e] }).catch(() => {});

      // ── Moderation ─────────────────────────────────────────────────────────
      } else if (cmd === '!mute10') {
        if (!message.member.permissions.has(PermissionFlagsBits.MuteMembers))
          return fail(message, 'You need **Mute Members** permission.', footer);
        const t = message.mentions.members?.first();
        if (!t) return fail(message, 'Usage: `!mute10 @user`', footer);
        await t.voice.setMute(true);
        await ok(message, `🔇  ${t.user.tag} muted`, footer);

      } else if (cmd === '!unmute10') {
        if (!message.member.permissions.has(PermissionFlagsBits.MuteMembers))
          return fail(message, 'You need **Mute Members** permission.', footer);
        const t = message.mentions.members?.first();
        if (!t) return fail(message, 'Usage: `!unmute10 @user`', footer);
        await t.voice.setMute(false);
        await ok(message, `🔊  ${t.user.tag} unmuted`, footer);

      } else if (cmd === '!vkick10') {
        if (!message.member.permissions.has(PermissionFlagsBits.MoveMembers))
          return fail(message, 'You need **Move Members** permission.', footer);
        const t = message.mentions.members?.first();
        if (!t) return fail(message, 'Usage: `!vkick10 @user`', footer);
        await t.voice.disconnect();
        await ok(message, `🦵  ${t.user.tag} kicked from voice`, footer);

      } else if (cmd === '!deafen10') {
        if (!message.member.permissions.has(PermissionFlagsBits.DeafenMembers))
          return fail(message, 'You need **Deafen Members** permission.', footer);
        const t = message.mentions.members?.first();
        if (!t) return fail(message, 'Usage: `!deafen10 @user`', footer);
        await t.voice.setDeaf(true);
        await ok(message, `🔕  ${t.user.tag} deafened`, footer);

      } else if (cmd === '!help10') {
        const e = new EmbedBuilder().setColor(0x5865F2)
          .setTitle(`🎧  Bot ${BOT_NUM} — All Commands`)
          .addFields(
            { name: '🎵 Audio',      value: '`!join10` `!st10` `!sp10` `!ds10` `!loop10`' },
            { name: '🔊 Amplifier',  value: '`!vol10 <0–200>`' },
            { name: '🎛️ Equalizer', value: '`!eq10 <preset>` · `!eqlist10`' },
            { name: '🛡️ Mod',        value: '`!mute10` `!unmute10` `!vkick10` `!deafen10`' },
            { name: '📊 Info',       value: '`!status10` · `!help10`' }
          )
          .setFooter({ text: `Bot ${BOT_NUM} · Auto-loop on by default` });
        await message.reply({ embeds: [e] }).catch(() => {});
      }

    } catch (e) {
      console.error(`[Bot${BOT_NUM}] Error in ${cmd}:`, e.message);
      fail(message, `Error: ${e.message}`, footer).catch(() => {});
    }
  });

  client.on('ready', () => {
    console.log(`[Bot${BOT_NUM}] Ready as ${client.user.tag}`);
    client.user.setActivity(`🎵 pk vaa | Bot ${BOT_NUM}`, { type: 2 }).catch(() => {});
  });

  client.on('error', e => console.error(`[Bot${BOT_NUM}] Client error:`, e.message));

  process.on('uncaughtException',  e => console.error(`[Bot${BOT_NUM}] uncaughtException:`,  e.message));
  process.on('unhandledRejection', r => console.error(`[Bot${BOT_NUM}] unhandledRejection:`, r));

  try {
    await client.login(token);
  } catch (e) {
    console.error(`[Bot${BOT_NUM}] Login failed:`, e.message);
  }
}

// ── Launch all bots with staggered login ──────────────────────────────────────
(async () => {
  const totalBots = 10;
  console.log(`[Launcher] Starting ${totalBots} bots (staggered)…`);
  for (let i = 0; i < totalBots; i++) {
    await createBot(i);
    if (i < totalBots - 1) await sleep(3000);
  }
  console.log('[Launcher] All bots initialized.');
})();