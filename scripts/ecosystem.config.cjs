// pm2 supervision for arc-s3 autopilot.
// Usage (from repo root):
//   npm run autopilot:up        # start (or reload) under pm2
//   npm run autopilot:down      # stop + delete
//   npm run autopilot:status    # show process state
//   npm run autopilot:logs      # tail combined logs
//
// Logs are written to ./logs/ and rotated by pm2-logrotate when installed:
//   npx pm2 install pm2-logrotate
module.exports = {
  apps: [
    {
      name: "rfb6-autopilot",
      script: "npm",
      args: "run agent:rfb6:autopilot",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      min_uptime: "30s",
      max_memory_restart: "512M",
      kill_timeout: 10000,
      time: true,
      out_file: "./logs/rfb6-autopilot.out.log",
      error_file: "./logs/rfb6-autopilot.err.log",
      merge_logs: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
