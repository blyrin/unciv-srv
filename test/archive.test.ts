import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'vitest'
import {
  archiveColdGames, cleanupEmptyGames, clearArchivedGame, createGame, getArchivedGameRecord, getArchiveUsage, getDB,
  getGameByID, getLatestFileContent, getLatestFilePreview, getRestoreRequests, restoreArchivedGames, saveFileContent,
  saveFilePreview, updateGameInfo,
} from '../src/database.js'
import {
  basicAuth, loginAsAdmin, seedPlayer, setupTestServer, testGameID1, testGameID2, testPassword, testPlayerID1,
  testPlayerID2, type TestServer,
} from './helpers/server.js'

let server: TestServer
let archiveDir: string

beforeEach(() => {
  server = setupTestServer()
  archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unciv-srv-archive-'))
})

afterEach(() => {
  server.close()
  fs.rmSync(archiveDir, { recursive: true, force: true })
})

/**
 * 造一局有存档的对局：size 控制存档正文字节数，updatedAtOffset 控制使用时间（负数表示更久没用）。
 */
function makeGame(gameId: string, size: number, updatedAtOffset: number): number {
  createGame(gameId, [testPlayerID1])
  saveFileContent(gameId, 1, testPlayerID1, '127.0.0.1', 'x'.repeat(size))
  saveFilePreview(gameId, 1, testPlayerID1, '127.0.0.1', '{"preview":1}')
  const updatedAt = Date.now() + updatedAtOffset
  getDB()
    .prepare('update files set whitelist = 0, created_at = ?, updated_at = ? where game_id = ?')
    .run(updatedAt - 1000, updatedAt, gameId)
  return updatedAt
}

test('存档总量未超过阈值时不动任何对局', () => {
  seedPlayer(testPlayerID1)
  makeGame(testGameID1, 1000, 0)

  const result = archiveColdGames(archiveDir, 1024 * 1024)
  assert.deepEqual(result, { games: 0, bytes: 0 })
  assert.equal(fs.readdirSync(archiveDir).length, 0)
  assert.ok(getGameByID(testGameID1) != null)
  assert.ok(getArchiveUsage() >= 1000)
})

test('总量超过阈值时按最久未使用顺序归档，先写归档文件再删记录，并可从归档恢复', () => {
  seedPlayer(testPlayerID1)
  const oldTime = makeGame(testGameID1, 1000, -60_000)
  makeGame(testGameID2, 1000, 0)

  // 阈值只够放下最新那一局，于是只有最久未使用的那局被归档
  const result = archiveColdGames(archiveDir, 1200)
  assert.equal(result.games, 1)
  assert.ok(result.bytes > 0)
  assert.equal(getGameByID(testGameID1), null)
  assert.ok(getGameByID(testGameID2) != null)

  const files = fs.readdirSync(archiveDir)
  assert.equal(files.length, 1)
  assert.match(files[0], /^unciv-archive-\d{8}-\d{6}Z\.jsonl$/)
  const file = path.join(archiveDir, files[0])
  assert.ok(!fs.existsSync(`${file}.tmp`))

  const record = getArchivedGameRecord(testGameID1)
  assert.equal(record?.archiveFile, files[0])
  assert.equal(record?.restoreRequestedAt, null)

  const [restored] = restoreArchivedGames(file)
  assert.equal(restored.gameId, testGameID1)
  assert.deepEqual(restored.players, [testPlayerID1])
  assert.equal(restored.whitelist, false)
  assert.equal(restored.turns, 1)
  assert.equal(restored.previewData, '{"preview":1}')

  const game = getGameByID(testGameID1)
  assert.equal(game?.createdAt, oldTime - 1000)
  assert.equal(game?.updatedAt, oldTime)
  assert.deepEqual(game?.players, [testPlayerID1])
  assert.equal(getLatestFileContent(testGameID1)?.data, 'x'.repeat(1000))
  assert.equal(getLatestFilePreview(testGameID1)?.data, '{"preview":1}')
  // 恢复后墓碑被清掉
  assert.equal(getArchivedGameRecord(testGameID1), null)
  assert.deepEqual(getRestoreRequests(), [])
})

test('白名单对局不会被归档', () => {
  seedPlayer(testPlayerID1)
  makeGame(testGameID1, 4000, -60_000)
  updateGameInfo(testGameID1, true, '长期保留')

  const result = archiveColdGames(archiveDir, 100)
  assert.deepEqual(result, { games: 0, bytes: 0 })
  assert.equal(fs.readdirSync(archiveDir).length, 0)
  assert.equal(getGameByID(testGameID1)?.remark, '长期保留')
  assert.ok(getLatestFileContent(testGameID1) != null)
})

test('没有存档的空对局不写进归档文件，由空对局清理负责', () => {
  seedPlayer(testPlayerID1)
  createGame(testGameID1, [testPlayerID1])
  const old = Date.now() - 2 * 24 * 60 * 60 * 1000
  getDB()
    .prepare('update files set created_at = ?, updated_at = ? where game_id = ?')
    .run(old, old, testGameID1)

  const result = archiveColdGames(archiveDir, 1)
  assert.deepEqual(result, { games: 0, bytes: 0 })
  assert.equal(fs.readdirSync(archiveDir).length, 0)
  assert.ok(getGameByID(testGameID1) != null)

  assert.equal(cleanupEmptyGames(), 1)
  assert.equal(getGameByID(testGameID1), null)
})

test('玩家打开已冷归档的对局时返回提示并登记恢复请求，预览请求不登记', async () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)
  makeGame(testGameID1, 4000, -60_000)
  assert.equal(archiveColdGames(archiveDir, 1000).games, 1)
  assert.equal(getGameByID(testGameID1), null)

  const response = await server.app.request(`/files/${testGameID1}`, {
    headers: { Authorization: basicAuth(testPlayerID1, testPassword), 'User-Agent': 'Unciv' },
  })
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('Retry-After'), '600')
  const message = await response.text()
  assert.match(message, /冷归档/)
  assert.match(message, /加密网盘/)

  const requests = getRestoreRequests()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].gameId, testGameID1)
  assert.equal(requests[0].requestedBy, testPlayerID1)
  assert.ok(requests[0].restoreRequestedAt != null)

  // 客户端会定时刷新预览：这类请求也要给出提示，但不应该登记成玩家的恢复请求
  const preview = await server.app.request(`/files/${testGameID1}_Preview`, {
    headers: { Authorization: basicAuth(testPlayerID2, testPassword), 'User-Agent': 'Unciv' },
  })
  assert.equal(preview.status, 503)
  assert.equal(getRestoreRequests()[0].requestedBy, testPlayerID1)

  // 管理员可以查到待恢复列表，也可以放弃某一局
  const cookie = await loginAsAdmin(server.app)
  const list = await server.app.request('/api/restore-requests', { headers: { Cookie: cookie } })
  assert.equal(list.status, 200)
  const body = (await list.json()) as { requests: Array<{ gameId: string, requestedBy: string }> }
  assert.deepEqual(body.requests.map((item) => item.gameId), [testGameID1])
  assert.equal(body.requests[0].requestedBy, testPlayerID1)

  const cleared = await server.app.request(`/api/restore-requests/${testGameID1}`, {
    method: 'DELETE', headers: { Cookie: cookie },
  })
  assert.equal(cleared.status, 204)
  assert.deepEqual(getRestoreRequests(), [])
  assert.equal(getArchivedGameRecord(testGameID1), null)
})

test('归档文件格式不受支持时报错', () => {
  const brokenJson = path.join(archiveDir, 'broken.jsonl')
  fs.writeFileSync(brokenJson, '这不是 JSON')
  assert.throws(() => restoreArchivedGames(brokenJson), /归档文件格式不受支持/)

  const unsupportedVersion = path.join(archiveDir, 'unsupported.jsonl')
  fs.writeFileSync(unsupportedVersion, JSON.stringify({ version: 99, gameId: testGameID1, data: '{}' }))
  assert.throws(() => restoreArchivedGames(unsupportedVersion), /归档文件格式不受支持/)
})

test('归档文件里没有指定对局时报错', () => {
  const file = path.join(archiveDir, 'one-game.jsonl')
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, gameId: testGameID1, data: '{}' })}\n`)

  assert.throws(() => restoreArchivedGames(file, testGameID2), /没有对局/)
})

test('可以直接放弃一局冷存档（清掉墓碑）', () => {
  seedPlayer(testPlayerID1)
  makeGame(testGameID1, 4000, -60_000)
  assert.equal(archiveColdGames(archiveDir, 1000).games, 1)

  assert.equal(clearArchivedGame(testGameID1), 1)
  assert.equal(getArchivedGameRecord(testGameID1), null)
  assert.equal(clearArchivedGame(testGameID1), 0)
})
