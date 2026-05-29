import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import type { ServerType } from '@hono/node-server'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import type { AppVariables, Config } from '../src/types.js'
import { createApp } from '../src/app.js'
import { attachChatWebSocket, resetChatState } from '../src/chat.js'
import {
  closeDatabase, createGame, createPlayer, initDatabase, saveFileContent, saveFilePreview,
} from '../src/database.js'
import { RateLimiter } from '../src/rate-limit.js'
import { resetSessions } from '../src/session.js'

export const testPlayerID1 = '00000000-0000-0000-0000-000000000001'
export const testPlayerID2 = '00000000-0000-0000-0000-000000000002'
export const testGameID1 = '11111111-1111-1111-1111-111111111111'
export const testPassword = 'password123'

export interface TestServer {
  app: Hono<{ Variables: AppVariables }>
  config: Config
  limiter: RateLimiter
  close: () => void
}

/**
 * 创建隔离的数据库和 Hono 应用。
 */
export function setupTestServer(): TestServer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unciv-srv-node-'))
  const config: Config = {
    port: '0',
    dbPath: path.join(dir, 'test.db'),
    adminUsername: 'admin',
    adminPassword: 'admin123',
    maxAttempts: 5,
    lockTime: 5,
  }

  resetSessions()
  resetChatState()
  initDatabase(config)
  const limiter = new RateLimiter(config.maxAttempts, config.lockTime)
  const app = createApp(config, limiter)

  return {
    app,
    config,
    limiter,
    close: () => {
      limiter.close()
      resetSessions()
      resetChatState()
      closeDatabase()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * 生成 Basic Auth 请求头。
 */
export function basicAuth(playerId = testPlayerID1, password = testPassword): string {
  return `Basic ${Buffer.from(`${playerId}:${password}`).toString('base64')}`
}

/**
 * 构造测试用编码存档。
 */
export function buildGameData(gameId: string, turns: number, playerIds: string[]): string {
  const data = JSON.stringify({
    gameId,
    turns,
    gameParameters: {
      players: playerIds.map((playerId) => ({ playerId, playerType: 'Human' })),
    },
  })
  return gzipSync(Buffer.from(data)).toString('base64')
}

/**
 * 创建测试玩家。
 */
export function seedPlayer(playerId = testPlayerID1, password = testPassword): void {
  createPlayer(playerId, password, '127.0.0.1')
}

/**
 * 创建带正式和预览存档的测试游戏。
 */
export function seedGameWithContent(): void {
  seedPlayer(testPlayerID1)
  createGame(testGameID1, [testPlayerID1])
  const data = JSON.stringify({ gameId: testGameID1, turns: 1 })
  saveFileContent(testGameID1, 1, testPlayerID1, '127.0.0.1', data)
  saveFilePreview(testGameID1, 1, testPlayerID1, '127.0.0.1', data)
}

/**
 * 登录管理员并返回 Cookie。
 */
export async function loginAsAdmin(app: Hono<{ Variables: AppVariables }>): Promise<string> {
  const response = await app.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const cookie = response.headers.get('set-cookie')
  if (!cookie) {
    throw new Error('管理员登录未返回 Cookie')
  }
  return cookie
}

/**
 * 登录玩家并返回 Cookie。
 */
export async function loginAsPlayer(app: Hono<{
  Variables: AppVariables
}>, playerId = testPlayerID1, password = testPassword): Promise<string> {
  const response = await app.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: playerId, password }),
  })
  const cookie = response.headers.get('set-cookie')
  if (!cookie) {
    throw new Error('玩家登录未返回 Cookie')
  }
  return cookie
}

/**
 * 启动带 WebSocket 的测试服务器。
 */
export async function startHttpServer(app: Hono<{ Variables: AppVariables }>): Promise<{
  url: string;
  server: ServerType
}> {
  const server = serve({ fetch: app.fetch, port: 0 })
  attachChatWebSocket(server)
  await new Promise<void>((resolve) => {
    server.once('listening', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('测试服务器地址无效')
  }
  return { url: `http://127.0.0.1:${address.port}`, server }
}
