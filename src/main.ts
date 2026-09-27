import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { attachChatWebSocket } from './chat.js'
import { closeDatabase, initDatabase, restoreArchivedGames } from './database.js'
import { loadConfig, loadEnvFile } from './config.js'
import { RateLimiter } from './rate-limit.js'
import { startScheduler } from './scheduler.js'

const restoreFlag = '--restore-archive'

/**
 * 归档恢复入口：node dist/main.js --restore-archive <归档文件> [对局ID]。
 * 命中时恢复归档并返回 true，不启动服务器。
 */
function restoreArchiveFromCommandLine(): boolean {
  const index = process.argv.indexOf(restoreFlag)
  if (index < 0) {
    return false
  }

  const file = process.argv[index + 1]
  if (!file) {
    console.error(`用法：node dist/main.js ${restoreFlag} <归档文件> [对局ID]`)
    process.exit(1)
  }
  const gameId = process.argv[index + 2]

  loadEnvFile()
  const config = loadConfig()
  initDatabase(config)
  const archived = restoreArchivedGames(file, gameId)
  console.info('归档恢复完成', {
    games: archived.length,
    turns: archived.map((game) => game.turns),
  })
  closeDatabase()
  return true
}

/**
 * 启动 HTTP、WebSocket、数据库和定时任务。
 */
function main(): void {
  if (restoreArchiveFromCommandLine()) {
    return
  }

  loadEnvFile()
  const config = loadConfig()
  console.info('Unciv Srv - https://github.com/blyrin/unciv-srv')

  console.info('连接数据库...')
  initDatabase(config)

  const limiter = new RateLimiter(config.maxAttempts, config.lockTime)
  const scheduler = startScheduler(config)
  const app = createApp(config, limiter)
  const port = Number.parseInt(config.port, 10)
  const server = serve(
    { fetch: app.fetch, port },
    () => console.info(`服务器启动, 端口: ${port}`),
  )

  attachChatWebSocket(server, config)

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
