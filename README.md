# 🎧 Dark Empire | Multi-Bot Audio Dashboard v2.0

A premium, production-ready web dashboard to manage 10 Discord audio bots simultaneously. Control everything from a sleek web interface—no Discord commands needed.

## 🚀 Key Features

- **Fleet Management**: Control 10 bots from a single dashboard.
- **Web-Only Control**: Join VC, Play, Stop, and Disconnect via the web UI.
- **Advanced Audio Processing**:
  - **Master Volume**: 0% to 200% amplification.
  - **Bass Boost**: Real-time low-end enhancement.
  - **Playback Speed**: Adjust from 0.5x to 2.0x.
  - **Looping**: Seamless audio looping.
- **Real-time Monitoring**: Live logs, bot status, and system resource (CPU/MEM) tracking.
- **Audio Library**: Upload, store, and manage your MP3 files directly through the web interface.
- **Stability**: Staggered login/join to avoid Discord rate limits and auto-reconnect logic.

## 🛠 Tech Stack

- **Backend**: Node.js, Express, Socket.IO, Discord.js, @discordjs/voice.
- **Processing**: FFmpeg (via `fluent-ffmpeg` and `ffmpeg-static`).
- **Frontend**: Vanilla JS, CSS Glassmorphism, Inter Typography.

## 📦 Installation

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   Edit `.env` and add your 10 bot tokens:
   ```env
   BOT_TOKEN_0=your_token_here
   BOT_TOKEN_1=your_token_here
   ...
   BOT_TOKEN_9=your_token_here
   PORT=3000
   ```

3. **Start the Dashboard**:
   ```bash
   npm start
   ```

4. **Access the UI**:
   Open `http://localhost:3000` in your browser.

## 🌐 Deployment Instructions

### 1. Fly.io (Recommended)
- Install Fly CLI and run `fly launch`.
- Use the provided `fly.toml` (or let Fly generate one).
- Set secrets: `fly secrets set BOT_TOKEN_0=... BOT_TOKEN_1=...`

### 2. Render
- Create a new **Web Service**.
- Connect your GitHub repo.
- Environment: Node.
- Build Command: `npm install`.
- Start Command: `node server.js`.
- Add Environment Variables for each bot token.

### 3. VPS (Ubuntu/Windows)
- Install Node.js and PM2.
- Run `pm2 start server.js --name "bot-dashboard"`.
- Use `pm2 startup` to ensure it starts on boot.

## ⚠️ Important Notes
- **FFmpeg**: The project uses `ffmpeg-static`, so you don't need to install FFmpeg manually on most systems.
- **Rate Limits**: Bots join VCs with a 1.5s delay to prevent being flagged by Discord.
- **Persistence**: VC links and audio settings are saved in `./data/config.json`.

---
*Created with ❤️ by Antigravity*