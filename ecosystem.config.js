// ecosystem.config.js — konfigurasi PM2 agar bot berjalan terus & auto-restart.
// Jalankan: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "bot-stok-hp",
      script: "src/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
