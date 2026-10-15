import { argv, serve } from 'bun'
import type { Server } from 'bun'
import { createApp } from './app.js'
import { createChatWebSocket } from './chat.js'
import { closeDatabase, initDatabase, restoreArchivedGames, runCleanup } from './database.js'
import { loadConfig, loadEnvFile } from './config.js'
import type { PeerData } from './chat.js'
import { RateLimiter } from './rate-limit.js'
import { startScheduler } from './scheduler.js'

const restoreFlag = '--restore-archive'
const cleanupFlag = '--cleanup'

/**
 * 归档恢复入口：bun dist/main.js --restore-archive <归档文件> [对局ID]。
 * 命中时恢复归档并返回 true，不启动服务器。
 */
function restoreArchiveFromCommandLine(): boolean {
  const index = argv.indexOf(restoreFlag)
  if (index < 0) {
    return false
  }

  const file = argv[index + 1]
  if (!file) {
    console.error(`用法：bun dist/main.js ${restoreFlag} <归档文件> [对局ID]`)
    process.exit(1)
  }
  const gameId = argv[index + 2]

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
 * 手动清理入口：bun dist/main.js --cleanup，等价于定时任务那次数据清理。
 */
function runCleanupFromCommandLine(): boolean {
  if (!argv.includes(cleanupFlag)) {
    return false
  }

  loadEnvFile()
  const config = loadConfig()
  initDatabase(config)
  runCleanup(config.archiveEnabled, config.archiveDir, config.archiveMaxBytes)
  closeDatabase()
  return true
}

/**
 * 启动 HTTP、WebSocket、数据库和定时任务。
 */
function main(): void {
  if (restoreArchiveFromCommandLine() || runCleanupFromCommandLine()) {
    return
  }

  loadEnvFile()
  const config = loadConfig()
  console.info('Unciv Srv - https://github.com/blyrin/unciv-srv')

  console.info('连接数据库...')
  initDatabase(config)

  const limiter = new RateLimiter(config.maxAttempts, config.lockTime)
  const scheduler = startScheduler(config)
  const chat = createChatWebSocket(config)
  const app = createApp(config, limiter, chat)
  const port = Number.parseInt(config.port, 10)
  const server: Server<PeerData> = serve({
    port,
    hostname: '0.0.0.0',
    routes: app.routes,
    fetch: app.fetch,
    websocket: chat.handlers,
  })

  console.info(`服务器启动, 端口: ${port}`)

  const shutdown = () => {
    console.info('正在关闭服务器...')
    scheduler.stop()
    limiter.close()
    server.stop(true)
    closeDatabase()
    console.info('服务器已关闭')
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
