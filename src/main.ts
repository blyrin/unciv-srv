import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { attachChatWebSocket } from './chat.js'
import { closeDatabase, initDatabase } from './database.js'
import { loadConfig, loadEnvFile } from './config.js'
import { RateLimiter } from './rate-limit.js'
import { startScheduler } from './scheduler.js'

/**
 * 启动 HTTP、WebSocket、数据库和定时任务。
 */
function main(): void {
  loadEnvFile()
  const config = loadConfig()
  console.info('Unciv Srv - https://github.com/blyrin/unciv-srv')

  console.info('连接数据库...')
  initDatabase(config)

  const limiter = new RateLimiter(config.maxAttempts, config.lockTime)
  const scheduler = startScheduler()
  const app = createApp(config, limiter)
  const port = Number.parseInt(config.port, 10)
  const server = serve(
    { fetch: app.fetch, port },
    () => console.info(`服务器启动, 端口: ${port}`),
  )

  attachChatWebSocket(server)

  const shutdown = () => {
    console.info('正在关闭服务器...')
    server.close(() => {
      scheduler.stop()
      limiter.close()
      closeDatabase()
      console.info('服务器已关闭')
      process.exit(0)
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
