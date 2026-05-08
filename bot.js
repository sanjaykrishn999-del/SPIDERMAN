require('dotenv').config({ quiet: true });
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const { createReadStream, existsSync } = require('fs');
const path = require('path');

// Bot index and configuration
const botIndex = parseInt(process.argv[2]) || 0;
const tokens = [
  process.env.BOT_TOKEN_0, process.env.BOT_TOKEN_1, process.env.BOT_TOKEN_2,
  process.env.BOT_TOKEN_3, process.env.BOT_TOKEN_4, process.env.BOT_TOKEN_5,
  process.env.BOT_TOKEN_6, process.env.BOT_TOKEN_7, process.env.BOT_TOKEN_8,
  process.env.BOT_TOKEN_9
];

if (botIndex < 0 || botIndex >= tokens.length) {
  console.error(`Invalid bot index: ${botIndex}`);
  process.exit(1);
}
if (!tokens[botIndex]) {
  console.error(`Bot token not found for index ${botIndex}`);
  process.exit(1);
}

const token = tokens[botIndex];
const audioFile = path.join(__dirname, `new${botIndex + 1}.mp3`);
const audioExists = existsSync(audioFile);
const LOGIN_TIMEOUT_MS = Number(process.env.BOT_LOGIN_TIMEOUT_MS || 90000);

if (!audioExists) {
  console.warn(`[WARN] Bot ${botIndex + 1}: Audio file missing`);
}

// Create optimized Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Connection cache with proper cleanup
const connections = new Map();
let readyFlag = false;
let commandCooldown = new Map();
const COOLDOWN_MS = 300;

// Helper function to check if connection is still valid
function isConnectionValid(connKey) {
  const conn = connections.get(connKey);
  if (!conn) return false;
  
  // Verify connection is still active
  try {
    return conn.conn && conn.conn.state && conn.conn.state.status !== 4; // 4 = destroyed
  } catch (e) {
    // Connection is dead, clean it up
    connections.delete(connKey);
    return false;
  }
}

// Cleanup dead connections periodically
setInterval(() => {
  for (const [key, conn] of connections.entries()) {
    if (!isConnectionValid(key)) {
      try {
        if (conn.player) conn.player.stop();
        if (conn.conn) conn.conn.destroy();
      } catch (e) {}
      connections.delete(key);
    }
  }
}, 10000); // Check every 10 seconds

// Optimized ready event - runs only once
let activitySet = false;
client.on('ready', () => {
  if (!readyFlag) {
    readyFlag = true;
    console.log(`Bot ${botIndex + 1} (${client.user.tag}) is ready!`);
    if (!activitySet) {
      client.user.setActivity('pk vaa');
      activitySet = true;
    }
  }
});

// Efficient error handling with recovery
client.on('error', (error) => {
  console.error(`Bot ${botIndex + 1} error:`, error.message);
});

client.on('voiceStateUpdate', () => {
  // Optimized voice state handler
});

// Ultra-fast message handler with ghost connection fix
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.member) return;

  const userId = message.author.id;
  const guildId = message.guild?.id;
  
  if (!guildId) return;

  // Rate limiting
  const cooldownKey = `${guildId}-${userId}`;
  const now = Date.now();
  if (commandCooldown.has(cooldownKey)) {
    const expirationTime = commandCooldown.get(cooldownKey) + COOLDOWN_MS;
    if (now < expirationTime) return;
  }
  commandCooldown.set(cooldownKey, now);

  const cmd = message.content;
  const voiceChannel = message.member.voice.channel;
  const connKey = guildId;

  try {
    if (cmd === '!join10') {
      // Check if already has valid connection
      if (isConnectionValid(connKey)) {
        return message.reply(`Bot ${botIndex + 1} already in channel!`).catch(() => {});
      }

      if (!voiceChannel) {
        return message.reply('You must be in a voice channel!').catch(() => {});
      }

      try {
        // Create fresh connection
        const conn = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guildId,
          adapterCreator: message.guild.voiceAdapterCreator,
          selfMute: false,
          selfDeaf: false
        });

        // Add destruction listener for cleanup
        conn.on('stateChange', (oldState, newState) => {
          if (newState.status === 4) { // Destroyed
            connections.delete(connKey);
            console.log(`Bot ${botIndex + 1} connection destroyed (auto cleanup)`);
          }
        });

        connections.set(connKey, { conn, player: null });
        console.log(`Bot ${botIndex + 1} joined: ${voiceChannel.name}`);
      } catch (err) {
        console.error(`Bot ${botIndex + 1} join error:`, err.message);
        return message.reply(`Failed to join channel!`).catch(() => {});
      }

    } else if (cmd === '!st10') {
      const connection = connections.get(connKey);
      if (!isConnectionValid(connKey)) {
        // Clean up ghost connection
        connections.delete(connKey);
        return message.reply(`Bot ${botIndex + 1} not in channel! Use !join10 first!`).catch(() => {});
      }

      if (!audioExists) {
        return message.reply(`Audio file missing for bot ${botIndex + 1}.`).catch(() => {});
      }

      try {
        // Stop existing player
        if (connection.player) {
          connection.player.stop();
          connection.player = null;
        }

        // Create new player
        const player = createAudioPlayer();
        connection.player = player;

        let resource;
        try {
          resource = createAudioResource(createReadStream(audioFile), {
            inputType: StreamType.Arbitrary,
            inlineVolume: true
          });
        } catch (e) {
          console.error(`Bot ${botIndex + 1} resource creation error:`, e.message);
          return message.reply(`Audio file error: ${e.message}`).catch(() => {});
        }

        // Play immediately
        connection.conn.subscribe(player);
        player.play(resource);

        console.log(`Bot ${botIndex + 1} playing audio`);

        // Single listener
        player.removeAllListeners();
        player.once(AudioPlayerStatus.Idle, () => {
          console.log(`Bot ${botIndex + 1} finished`);
        });

        player.on('error', (error) => {
          console.error(`Bot ${botIndex + 1} player error:`, error.message);
        });
      } catch (err) {
        console.error(`Bot ${botIndex + 1} play error:`, err.message);
        return message.reply('Play error!').catch(() => {});
      }

    } else if (cmd === '!sp10') {
      const connection = connections.get(connKey);
      if (connection?.player) {
        connection.player.stop();
        connection.player = null;
        console.log(`Bot ${botIndex + 1} stopped`);
      }

    } else if (cmd === '!ds10') {
      const connection = connections.get(connKey);
      if (connection) {
        try {
          if (connection.player) {
            connection.player.stop();
            connection.player = null;
          }
          connection.conn.destroy();
          connections.delete(connKey);
          console.log(`Bot ${botIndex + 1} disconnected`);
        } catch (err) {
          console.error(`Bot ${botIndex + 1} disconnect error:`, err.message);
        }
      }
    }
  } catch (error) {
    console.error(`Bot ${botIndex + 1} error:`, error.message);
  }
});

// Fast login with timeout
const loginTimeout = setTimeout(() => {
  console.error(`Bot ${botIndex + 1} login timeout after ${Math.round(LOGIN_TIMEOUT_MS / 1000)}s!`);
  process.exit(1);
}, LOGIN_TIMEOUT_MS);

client.login(token).then(() => {
  clearTimeout(loginTimeout);
  console.log(`Bot ${botIndex + 1} connected!`);
}).catch((error) => {
  clearTimeout(loginTimeout);
  console.error(`Bot ${botIndex + 1} login failed:`, error.message);
  process.exit(1);
});

// Optimized graceful shutdown
const shutdown = async () => {
  console.log(`Bot ${botIndex + 1} shutting down...`);
  
  // Cleanup all connections
  for (const [key, conn] of connections.entries()) {
    try {
      if (conn.player) conn.player.stop();
      if (conn.conn) conn.conn.destroy();
    } catch (e) {}
  }
  connections.clear();
  commandCooldown.clear();

  // Disconnect client
  try {
    await client.destroy();
  } catch (e) {}

  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error(`Bot ${botIndex + 1} uncaught exception:`, error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`Bot ${botIndex + 1} unhandled rejection:`, reason);
});