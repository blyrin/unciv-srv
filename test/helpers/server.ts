import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync, serve } from 'bun'
import type { Server } from 'bun'
import type { Config } from '../../src/types.js'
import { createApp } from '../../src/app.js'
import { createChatWebSocket, resetChatState } from '../../src/chat.js'
import type { ChatWebSocket, PeerData } from '../../src/chat.js'
import {
  closeDatabase, createGame, createPlayer, getDB, initDatabase, saveFileContent, saveFilePreview,
} from '../../src/database.js'
import type { ArchivedGame } from '../../src/database.js'
import { RateLimiter } from '../../src/rate-limit.js'
import { resetSessions } from '../../src/session.js'
import { testGameID1, testPassword, testPlayerID1 } from '../fixtures/ids.js'

export {
  testGameID1, testGameID2, testPassword, testPlayerID1, testPlayerID2, testPlayerID3,
} from '../fixtures/ids.js'

/** 测试会替换 globalThis.fetch 打桩 GitHub 请求，本地 HTTP 调用必须用加载时捕获的原始 fetch */
const localFetch = globalThis.fetch

export interface TestServer {
  app: ReturnType<typeof createApp>
  chat: ChatWebSocket
  config: Config
  limiter: RateLimiter
  server: Server<PeerData>
  url: string
  /** 经本地 HTTP 走 Bun 真实路由（手动处理重定向，保留 302 响应） */
  request: (path: string, init?: RequestInit) => Promise<Response>
  close: () => void
}

export async function setupTestServer(overrides: Partial<Config> = {}): Promise<TestServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unciv-srv-test-'))
  const config: Config = {
    port: '0',
    dbPath: path.join(dir, 'test.db'),
    adminUsername: 'admin',
    adminPassword: 'admin123',
    maxAttempts: 5,
    lockTime: 5,
    registerMode: 'open',
    chatEnabled: true,
    ipStorage: 'full',
    ipRetentionDays: 0,
    archiveEnabled: true,
    archiveDir: path.join(dir, 'archive'),
    archiveMaxBytes: 1024 * 1024 * 1024,
    downloadGithubRepo: 'AutumnPizazz/Unciv',
    downloadGithubProxy: 'https://mirror.ecrow.cn/github-release/',
    ...overrides,
  }

  resetSessions()
  resetChatState()
  await initDatabase(config)
  const limiter = new RateLimiter(config.maxAttempts, config.lockTime)
  const chat = createChatWebSocket(config)
  const app = createApp(config, limiter, chat)
  const server = serve<PeerData>({
    port: 0,
    hostname: '127.0.0.1',
    routes: app.routes,
    fetch: app.fetch,
    websocket: chat.handlers,
  })
  const url = `http://127.0.0.1:${server.port}`

  return {
    app,
    chat,
    config,
    limiter,
    server,
    url,
    request: (path, init) => localFetch(`${url}${path}`, { ...init, redirect: 'manual' }),
    close: () => {
      server.stop(true)
      limiter.close()
      resetSessions()
      resetChatState()
      closeDatabase()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

export function basicAuth(playerId = testPlayerID1, password = testPassword): string {
  return `Basic ${btoa(`${playerId}:${password}`)}`
}

export function makeGame(gameId: string, size: number, updatedAtOffset: number, playerId = testPlayerID1): number {
  createGame(gameId, [playerId])
  saveFileContent(gameId, 1, playerId, '127.0.0.1', 'x'.repeat(size))
  saveFilePreview(gameId, 1, playerId, '127.0.0.1', '{"preview":1}')
  const updatedAt = Date.now() + updatedAtOffset
  getDB().query('update files set whitelist = 0, created_at = ?, updated_at = ? where game_id = ?')
    .run(updatedAt - 1000, updatedAt, gameId)
  return updatedAt
}

export function createArchiveDir(): { archiveDir: string; cleanup: () => void } {
  const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unciv-srv-archive-'))
  return { archiveDir, cleanup: () => fs.rmSync(archiveDir, { recursive: true, force: true }) }
}

export function archiveFileNames(archiveDir: string): string[] {
  return fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir) : []
}

export function archiveFileWithGame(archiveDir: string, gameId: string): string {
  const name = archiveFileNames(archiveDir)
    .find((file) => fs.readFileSync(path.join(archiveDir, file), 'utf8').includes(gameId))
  assert.ok(name, `归档目录里没有包含 ${gameId} 的归档文件`)
  return path.join(archiveDir, name)
}

export function writeArchiveFile(dir: string, games: ArchivedGame[]): string {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'external.jsonl')
  fs.writeFileSync(file, games.map((game) => JSON.stringify(game)).join('\n') + '\n')
  return file
}

export function archivedGameFixture(gameId: string, overrides: Partial<ArchivedGame> = {}): ArchivedGame {
  return {
    version: 1,
    gameId,
    players: [testPlayerID1],
    whitelist: false,
    remark: '',
    createdAt: 1000,
    updatedAt: 2000,
    turns: 7,
    contentPlayer: testPlayerID1,
    contentCreatedAt: 1500,
    data: '{"save":1}',
    previewTurns: 7,
    previewData: '{"preview":1}',
    ...overrides,
  }
}

export function buildGameData(gameId: string, turns: number, playerIds: string[]): string {
  const data = JSON.stringify({
    gameId,
    turns,
    gameParameters: {
      players: playerIds.map((playerId) => ({ playerId, playerType: 'Human' })),
    },
  })
  return gzipSync(new TextEncoder().encode(data)).toBase64()
}

export async function seedPlayer(playerId = testPlayerID1, password = testPassword): Promise<void> {
  await createPlayer(playerId, password, '127.0.0.1')
}

export async function seedGameWithContent(): Promise<void> {
  await seedPlayer(testPlayerID1)
  createGame(testGameID1, [testPlayerID1])
  const data = JSON.stringify({ gameId: testGameID1, turns: 1 })
  saveFileContent(testGameID1, 1, testPlayerID1, '127.0.0.1', data)
  saveFilePreview(testGameID1, 1, testPlayerID1, '127.0.0.1', data)
}

export async function loginAsAdmin(server: TestServer): Promise<string> {
  const response = await server.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const cookie = response.headers.get('set-cookie')
  if (!cookie) {
    throw new Error('管理员登录未返回 Cookie')
  }
  return cookie
}

export async function loginAsPlayer(
  server: TestServer,
  playerId = testPlayerID1,
  password = testPassword,
): Promise<string> {
  const response = await server.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: playerId, password }),
  })
  const cookie = response.headers.get('set-cookie')
  if (!cookie) {
    throw new Error('玩家登录未返回 Cookie')
  }
  return cookie
}

/** 测试服务器在 setupTestServer 时已启动，这里直接复用同一个实例 */
export async function startHttpServer(testServer: TestServer): Promise<{
  url: string
  server: Server<PeerData>
}> {
  return { url: testServer.url, server: testServer.server }
}
