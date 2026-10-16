import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'bun:test'
import {
  acquireSimultaneousTurnLock, appendSimultaneousTurnOperations, archiveColdGames, cleanupEmptyGames, clearArchivedGame,
  createGame, getAllTurnsForGame, getArchivedGameRecord, getArchiveUsage, getDB, getGameByID, getLatestFileContent,
  getLatestFilePreview, getRestoreRequests, getSimultaneousTurnOperations, getTurnsMetadata, restoreArchivedGames,
  rollbackGameToTurn, saveFileContent, saveFilePreview, updateGameInfo,
} from '../src/database.js'
import {
  archiveFileNames, archiveFileWithGame, archivedGameFixture, basicAuth, createArchiveDir, loginAsAdmin, makeGame,
  seedPlayer, setupTestServer, testGameID1, testGameID2, testPassword, testPlayerID1, testPlayerID2,
  type TestServer, writeArchiveFile,
} from './helpers/server.js'

let server: TestServer
let archiveDir: string
let cleanupArchiveDir: () => void

beforeEach(async () => {
  server = await setupTestServer()
  const archive = createArchiveDir()
  archiveDir = archive.archiveDir
  cleanupArchiveDir = archive.cleanup
})

afterEach(async () => {
  server.close()
  cleanupArchiveDir()
})

test('存档总量未超过阈值时不动任何对局', async () => {
  await seedPlayer(testPlayerID1)
  makeGame(testGameID1, 1000, 0)

  const result = await archiveColdGames(archiveDir, 1024 * 1024)
  assert.deepEqual(result, { games: 0, bytes: 0 })
  assert.equal(archiveFileNames(archiveDir).length, 0)
  assert.ok(getGameByID(testGameID1) != null)
  assert.ok(getArchiveUsage() >= 1000)
})

test('总量超过阈值时按最久未使用顺序归档，先写归档文件再删记录，并可从归档恢复', async () => {
  await seedPlayer(testPlayerID1)
  const oldTime = makeGame(testGameID1, 1000, -60_000)
  makeGame(testGameID2, 1000, 0)

  // 阈值只够放下最新那一局，于是只有最久未使用的那局被归档
  const result = await archiveColdGames(archiveDir, 1200)
  assert.equal(result.games, 1)
  assert.ok(result.bytes > 0)
  assert.equal(getGameByID(testGameID1), null)
  assert.ok(getGameByID(testGameID2) != null)

  const files = archiveFileNames(archiveDir)
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

test('写归档文件失败时中止归档，不删除任何对局记录', async () => {
  await seedPlayer(testPlayerID1)
  makeGame(testGameID1, 3000, -60_000)
  // 归档目录位置上放一个已存在的文件，创建归档目录必然失败
  const blocked = path.join(archiveDir, 'blocked')
  fs.writeFileSync(blocked, '')

  await assert.rejects(archiveColdGames(blocked, 1000))
  assert.ok(getGameByID(testGameID1) != null)
  assert.ok(getLatestFileContent(testGameID1) != null)
  assert.equal(getArchivedGameRecord(testGameID1), null)
  assert.equal(archiveFileNames(archiveDir).length, 1)
})

test('白名单对局不会被归档', async () => {
  await seedPlayer(testPlayerID1)
  makeGame(testGameID1, 4000, -60_000)
  updateGameInfo(testGameID1, true, '长期保留')

  const result = await archiveColdGames(archiveDir, 100)
  assert.deepEqual(result, { games: 0, bytes: 0 })
  assert.equal(archiveFileNames(archiveDir).length, 0)
  assert.equal(getGameByID(testGameID1)?.remark, '长期保留')
  assert.ok(getLatestFileContent(testGameID1) != null)
})

test('没有存档的空对局不写进归档文件，由空对局清理负责', async () => {
  await seedPlayer(testPlayerID1)
  createGame(testGameID1, [testPlayerID1])
  const old = Date.now() - 2 * 24 * 60 * 60 * 1000
  getDB()
    .query('update files set created_at = ?, updated_at = ? where game_id = ?')
    .run(old, old, testGameID1)

  const result = await archiveColdGames(archiveDir, 1)
  assert.deepEqual(result, { games: 0, bytes: 0 })
  assert.equal(archiveFileNames(archiveDir).length, 0)
  assert.ok(getGameByID(testGameID1) != null)

  assert.equal(cleanupEmptyGames(), 1)
  assert.equal(getGameByID(testGameID1), null)
})

test('只上传过预览的对局不会被归档，否则墓碑会指向不含它的归档文件', async () => {
  await seedPlayer(testPlayerID1)
  createGame(testGameID1, [testPlayerID1])
  saveFilePreview(testGameID1, 1, testPlayerID1, '127.0.0.1', 'y'.repeat(4000))
  const old = Date.now() - 60_000
  getDB().query('update files set created_at = ?, updated_at = ? where game_id = ?').run(old, old, testGameID1)

  const result = await archiveColdGames(archiveDir, 1000)
  assert.deepEqual(result, { games: 0, bytes: 0 })
  assert.equal(archiveFileNames(archiveDir).length, 0)
  assert.ok(getGameByID(testGameID1) != null)
  assert.equal(getArchivedGameRecord(testGameID1), null)
  assert.ok(getLatestFilePreview(testGameID1) != null)
})

test('同一秒内再次归档不会覆盖上一个归档文件', async () => {
  await seedPlayer(testPlayerID1)
  makeGame(testGameID1, 3000, -120_000)
  const first = await archiveColdGames(archiveDir, 1500)
  makeGame(testGameID2, 3000, -60_000)
  const second = await archiveColdGames(archiveDir, 1500)

  assert.equal(first.games, 1)
  assert.equal(second.games, 1)
  const files = archiveFileNames(archiveDir)
  assert.equal(files.length, 2)
  // 每个墓碑都必须指向真的含有自己对局的归档文件
  for (const gameId of [testGameID1, testGameID2]) {
    const record = getArchivedGameRecord(gameId)
    assert.ok(record != null)
    assert.ok(fs.readFileSync(path.join(archiveDir, record.archiveFile), 'utf8').includes(gameId))
  }
})

test('容量统计按 UTF-8 字节而不是字符数', async () => {
  await seedPlayer(testPlayerID1)
  const data = '中文存档数据'.repeat(500)
  createGame(testGameID1, [testPlayerID1])
  saveFileContent(testGameID1, 1, testPlayerID1, '127.0.0.1', data)

  assert.equal(getArchiveUsage(), new TextEncoder().encode(data).length)
})

test('归档会级联清理同步回合锁与操作', async () => {
  await seedPlayer(testPlayerID1)
  makeGame(testGameID1, 3000, -60_000)
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 5, testPlayerID1), true)
  appendSimultaneousTurnOperations(testGameID1, testPlayerID1, [
    { turn: 5, sequence: 1, playerId: testPlayerID1, type: 'move' },
  ])
  assert.ok(getSimultaneousTurnOperations(testGameID1) != null)

  await archiveColdGames(archiveDir, 1000)

  const conn = getDB()
  assert.equal((conn.query('select count(*) as count from simultaneous_turn_locks').get() as { count: number }).count, 0)
  assert.equal((conn.query('select count(*) as count from simultaneous_turn_operations').get() as { count: number }).count, 0)
})

test('恢复时创建者不在 players 表也能恢复（异地或换库恢复）', async () => {
  const file = writeArchiveFile(archiveDir, [
    archivedGameFixture(testGameID1, { contentPlayer: 'ghost-player' }),
  ])

  const [restored] = restoreArchivedGames(file)
  assert.equal(restored.gameId, testGameID1)
  assert.ok(getGameByID(testGameID1) != null)
  assert.equal(getLatestFileContent(testGameID1)?.data, '{"save":1}')
  // 创建者缺失时置空，而不是让整笔恢复失败
  const row = getDB()
    .query('select created_player from files_content where game_id = ?')
    .get(testGameID1) as { created_player: string | null }
  assert.equal(row.created_player, null)
})

test('同一个归档文件里多局恢复，创建者缺失不影响其他对局', async () => {
  await seedPlayer(testPlayerID1)
  const file = writeArchiveFile(archiveDir, [
    archivedGameFixture(testGameID1),
    archivedGameFixture(testGameID2, { contentPlayer: 'ghost-player' }),
  ])

  const restored = restoreArchivedGames(file)
  assert.equal(restored.length, 2)
  assert.ok(getGameByID(testGameID1) != null)
  assert.ok(getGameByID(testGameID2) != null)
  assert.equal(getLatestFileContent(testGameID2)?.data, '{"save":1}')
})

test('恢复会覆盖库里已有的旧存档，而不是叠加', async () => {
  await seedPlayer(testPlayerID1)
  createGame(testGameID1, [testPlayerID1])
  saveFileContent(testGameID1, 99, testPlayerID1, '127.0.0.1', '{"turns":99}')
  saveFilePreview(testGameID1, 99, testPlayerID1, '127.0.0.1', '{"preview":99}')

  restoreArchivedGames(writeArchiveFile(archiveDir, [archivedGameFixture(testGameID1)]))

  assert.deepEqual(getAllTurnsForGame(testGameID1).map((turn) => turn.turns), [7])
  assert.equal(getLatestFileContent(testGameID1)?.data, '{"save":1}')
  assert.equal(getLatestFilePreview(testGameID1)?.data, '{"preview":1}')
})

test('恢复后的对局可以正常回档', async () => {
  await seedPlayer(testPlayerID1)
  restoreArchivedGames(writeArchiveFile(archiveDir, [archivedGameFixture(testGameID1)]))

  const turn = getTurnsMetadata(testGameID1)[0]
  assert.deepEqual(rollbackGameToTurn(testGameID1, turn.id), {
    deletedTurns: 0,
    deletedPreviews: 0,
    currentTurns: 7,
  })
})

test('玩家打开已冷归档的对局时返回提示并登记恢复请求，预览请求不登记', async () => {
  await seedPlayer(testPlayerID1)
  await seedPlayer(testPlayerID2)
  makeGame(testGameID1, 4000, -60_000)
  assert.equal((await archiveColdGames(archiveDir, 1000)).games, 1)
  assert.equal(getGameByID(testGameID1), null)

  const response = await server.request(`/files/${testGameID1}`, {
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
  const preview = await server.request(`/files/${testGameID1}_Preview`, {
    headers: { Authorization: basicAuth(testPlayerID2, testPassword), 'User-Agent': 'Unciv' },
  })
  assert.equal(preview.status, 503)
  assert.equal(getRestoreRequests()[0].requestedBy, testPlayerID1)

  // 管理员可以查到待恢复列表，也可以放弃某一局
  const cookie = await loginAsAdmin(server)
  const list = await server.request('/api/restore-requests', { headers: { Cookie: cookie } })
  assert.equal(list.status, 200)
  const body = (await list.json()) as { requests: Array<{ gameId: string, requestedBy: string }> }
  assert.deepEqual(body.requests.map((item) => item.gameId), [testGameID1])
  assert.equal(body.requests[0].requestedBy, testPlayerID1)

  const cleared = await server.request(`/api/restore-requests/${testGameID1}`, {
    method: 'DELETE', headers: { Cookie: cookie },
  })
  assert.equal(cleared.status, 204)
  assert.deepEqual(getRestoreRequests(), [])
  assert.equal(getArchivedGameRecord(testGameID1), null)
})

test('归档文件格式不受支持时报错', async () => {
  const brokenJson = path.join(archiveDir, 'broken.jsonl')
  fs.writeFileSync(brokenJson, '这不是 JSON')
  assert.throws(() => restoreArchivedGames(brokenJson), /归档文件格式不受支持/)

  const unsupportedVersion = path.join(archiveDir, 'unsupported.jsonl')
  fs.writeFileSync(unsupportedVersion, JSON.stringify({ version: 99, gameId: testGameID1, data: '{}' }))
  assert.throws(() => restoreArchivedGames(unsupportedVersion), /归档文件格式不受支持/)
})

test('归档文件里没有指定对局时报错', async () => {
  const file = path.join(archiveDir, 'one-game.jsonl')
  fs.writeFileSync(file, `${JSON.stringify(archivedGameFixture(testGameID1))}\n`)

  assert.throws(() => restoreArchivedGames(file, testGameID2), /没有对局/)
})

test('可以直接放弃一局冷存档（清掉墓碑）', async () => {
  await seedPlayer(testPlayerID1)
  makeGame(testGameID1, 4000, -60_000)
  assert.equal((await archiveColdGames(archiveDir, 1000)).games, 1)

  assert.equal(clearArchivedGame(testGameID1), 1)
  assert.equal(getArchivedGameRecord(testGameID1), null)
  assert.equal(clearArchivedGame(testGameID1), 0)
})

test('按 gameId 恢复时只恢复该局，且不影响其他对局的墓碑', async () => {
  await seedPlayer(testPlayerID1)
  makeGame(testGameID1, 3000, -120_000)
  await archiveColdGames(archiveDir, 2000)
  makeGame(testGameID2, 3000, -60_000)
  await archiveColdGames(archiveDir, 2000)

  const restored = restoreArchivedGames(archiveFileWithGame(archiveDir, testGameID1), testGameID1)
  assert.equal(restored.length, 1)
  assert.equal(getArchivedGameRecord(testGameID1), null)
  assert.ok(getArchivedGameRecord(testGameID2) != null)
})
