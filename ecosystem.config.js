/**
 * PM2 Ecosystem Configuration - Otimizado para 33GB RAM, 8vCPU, 480GB disco
 * Configuração para ~1000 msg/s
 * 
 * Alocação de recursos:
 * - API: 2 instâncias × 1GB = 2GB (cluster HTTP)
 * - Workers: 5 instâncias × 2.5GB = 12.5GB (processamento paralelo)
 * - Node.js heap: máximo 2.5GB/instância (deixa espaço para OS/cache)
 * - DB pool: 150 conexões (distribuídas entre processos)
 * - Redis: 8GB dedicado (separado)
 * - Sistema: ~8GB
 * 
 * Uso: pm2 start ecosystem.config.js
 *      pm2 scale worker 7   # escalar conforme carga
 *      pm2 scale api 4      # API pode chegar a 4 em pico
 */

module.exports = {
  apps: [
    // ============ API HTTP (2-4 instâncias) ============
    {
      name: 'api',
      script: 'dist/src/main.js',
      instances: 2, // base = 2, pode chegar a 4 em pico (pm2 scale api 4)
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--max-old-space-size=2048', // 2GB heap por instância
        LOG_LEVEL: 'info',
        PORT: 3000,
      },
      error_file: 'logs/api-error.log',
      out_file: 'logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_memory_restart: '2560M', // reinicia se exceder 2.5GB
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'dist', '.env'],
      listen_timeout: 15000,
      kill_timeout: 30000,
    },

    // ============ WORKERS BullMQ (5-7 instâncias) ============
    // Cada worker: concurrency 100, ~100-150 msg/s, usando 2-2.5GB RAM
    {
      name: 'worker',
      script: 'dist/src/worker.js',
      instances: 5, // base = 5 (pode escalar até 7 em carga máxima)
      exec_mode: 'fork', // fork pois cada worker tem seu próprio event loop
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--max-old-space-size=2560', // 2.5GB heap por worker
        LOG_LEVEL: 'info',
      },
      error_file: 'logs/worker-error.log',
      out_file: 'logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_memory_restart: '2816M', // um pouco acima do heap para margem
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'dist', '.env'],
      listen_timeout: 15000,
      kill_timeout: 45000, // workers precisam de mais tempo para completar jobs
      autorestart: true,
      // Graceful shutdown hook
      shutdown_timeout: 45000,
    },
  ],

  // ============ Deploy (opcional) ============
  deploy: {
    production: {
      user: 'deploy',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-org/beecrm-broadcast.git',
      path: '/opt/broadcast', // use /opt para não pressionar / em servidor com 480GB
      'pre-deploy-local': 'npm run build && npm run test',
      'post-deploy':
        'npm install && npm run build && pm2 startOrRestart ecosystem.config.js --env production',
    },
  },
};
