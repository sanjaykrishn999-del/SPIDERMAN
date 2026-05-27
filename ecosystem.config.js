module.exports = {
  apps: Array.from({ length: 10 }, (_, i) => ({
    name:               `bot-${i + 1}`,
    script:             'bot.js',
    args:               String(i),
    instances:          1,
    autorestart:        true,          // restart on crash → no crash
    watch:              false,
    max_memory_restart: '120M',
    exec_mode:          'fork',
    merge_logs:         true,
    // Logs go to ./logs/ folder (Windows-compatible)
    error_file:         `./logs/bot-${i + 1}-err.log`,
    out_file:           `./logs/bot-${i + 1}-out.log`,
    env: {
      NODE_ENV:     'production',
      NODE_OPTIONS: '--max-old-space-size=100'
    }
  }))
};