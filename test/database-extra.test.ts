import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import {
  batchDeleteGames, batchUpdateGamesWhitelist, batchUpdatePlayersWhitelist, cleanupExpiredGames, cleanupOldContents,
  cleanupOldPreviews, countGamesByPlayer, createGame, createPlayer, deleteGame, getAllTurnsForGame, getDB, getGameByID,
  getGamesCreatedByPlayer, getGamesPage, getLatestFileContent, getLatestFilePreview, getPlayerByID, getPlayerPassword,
  getTurnByID, getTurnsMetadata, rollbackGameToTurn, saveFileContent, saveFilePreview, updateGameInfo,
  updateGamePlayers, updatePlayerInfo, updatePlayerLastActive, updatePlayerPassword,
} from '../src/database.js'
import {
  seedPlayer, setupTestServer, testGameID1, testPassword, testPlayerID1, testPlayerID2, type TestServer,
} from './helpers.js'

let server: TestServer

beforeEach(() => {
  server = setupTestServer()
})

afterEach(() => {
  server.close()
})

test('玩家数据库操作覆盖重复、更新、搜索和批量', () => {
  seedPlayer(testPlayerID1)
  assert.throws(() => createPlayer(testPlayerID1, testPassword, '127.0.0.1'))
  const timeTypes = getDB().prepare(`
    select typeof(created_at) as created_type,
           typeof(updated_at) as updated_type
    from players
    where player_id = ?
  `).get(testPlayerID1) as { created_type: string; updated_type: string }
  assert.equal(timeTypes.created_type, 'integer')
  assert.equal(timeTypes.updated_type, 'integer')

  updatePlayerPassword(testPlayerID1, 'newpass123', '10.0.0.1')
  assert.equal(getPlayerPassword(testPlayerID1), 'newpass123')
  updatePlayerInfo(testPlayerID1, true, 'keyword-remark')
  updatePlayerLastActive(testPlayerID1, '10.0.0.2')
  const player = getPlayerByID(testPlayerID1)
  assert.equal(typeof player?.createdAt, 'number')
  assert.equal(typeof player?.updatedAt, 'number')
  assert.equal(player?.whitelist, true)
  assert.equal(player?.remark, 'keyword-remark')
  assert.equal(player?.updateIp, '10.0.0.2')

  seedPlayer(testPlayerID2)
  batchUpdatePlayersWhitelist([testPlayerID1, testPlayerID2], false)
  assert.equal(getPlayerByID(testPlayerID1)?.whitelist, false)
  assert.equal(getPlayerByID(testPlayerID2)?.whitelist, false)
})

test('游戏数据库操作覆盖参与者、创建者、分页和级联删除', () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)
  createGame(testGameID1, [testPlayerID1])
  updateGamePlayers(testGameID1, [testPlayerID1, testPlayerID2])
  updateGameInfo(testGameID1, true, 'game-keyword')
  saveFileContent(testGameID1, 1, testPlayerID1, '127.0.0.1', '{"turns":1}')

  assert.deepEqual(getGameByID(testGameID1)?.players, [testPlayerID1, testPlayerID2])
  assert.equal(countGamesByPlayer(testPlayerID2), 1)
  assert.equal(getGamesCreatedByPlayer(testPlayerID1), 1)
  assert.equal(getGamesPage('game-keyword', 1, 20).total, 1)

  batchUpdateGamesWhitelist([testGameID1], false)
  assert.equal(getGameByID(testGameID1)?.whitelist, false)
  deleteGame(testGameID1)
  assert.equal(getGameByID(testGameID1), null)
  assert.equal(getLatestFileContent(testGameID1), null)
})

test('文件数据库操作覆盖最新记录、元数据、单回合和预览', () => {
  seedPlayer(testPlayerID1)
  createGame(testGameID1, [testPlayerID1])
  saveFileContent(testGameID1, 1, testPlayerID1, '127.0.0.1', '{"turns":1}')
  saveFileContent(testGameID1, 3, testPlayerID1, '127.0.0.1', '{"turns":3}')
  saveFilePreview(testGameID1, 2, testPlayerID1, '127.0.0.1', '{"preview":2}')

  assert.equal(getLatestFileContent(testGameID1)?.turns, 3)
  assert.equal(getLatestFilePreview(testGameID1)?.turns, 2)
  assert.equal(getAllTurnsForGame(testGameID1).length, 2)
  const turns = getTurnsMetadata(testGameID1)
  assert.equal(turns.length, 2)
  assert.equal(getTurnByID(turns[0]!.id)?.turns, 1)
})

test('回档使用最早匹配预览，同时间记录按 ID 判断', () => {
  seedPlayer(testPlayerID1)
  createGame(testGameID1, [testPlayerID1])
  const conn = getDB()
  const earlyTime = Date.UTC(2026, 0, 1)
  const lateTime = Date.UTC(2026, 0, 2)
  conn.prepare(`
    insert into files_content (game_id, turns, created_player, created_ip, created_at, data)
    values (?, ?, ?, ?, ?, ?)
  `).run(testGameID1, 1, testPlayerID1, '127.0.0.1', earlyTime, '{"turns":1}')
  const targetId = Number((conn.prepare('select id from files_content where turns = 1').get() as { id: number }).id)
  conn.prepare(`
    insert into files_content (game_id, turns, created_player, created_ip, created_at, data)
    values (?, ?, ?, ?, ?, ?),
           (?, ?, ?, ?, ?, ?)
  `).run(
    testGameID1, 2, testPlayerID1, '127.0.0.1', earlyTime, '{"turns":2}',
    testGameID1, 2, testPlayerID1, '127.0.0.1', lateTime, '{"turns":2-later}',
  )
  conn.prepare(`
    insert into files_preview (game_id, turns, created_player, created_ip, created_at, data)
    values (?, ?, ?, ?, ?, ?),
           (?, ?, ?, ?, ?, ?),
           (?, ?, ?, ?, ?, ?)
  `).run(
    testGameID1, 1, testPlayerID1, '127.0.0.1', earlyTime, '{"preview":1}',
    testGameID1, 1, testPlayerID1, '127.0.0.1', earlyTime, '{"preview":1-duplicate}',
    testGameID1, 2, testPlayerID1, '127.0.0.1', lateTime, '{"preview":2}',
  )

  const result = rollbackGameToTurn(testGameID1, targetId)
  assert.deepEqual(result, { deletedTurns: 2, deletedPreviews: 2, currentTurns: 1 })
})

test('清理任务删除过期游戏并只保留最新存档和预览', () => {
  seedPlayer(testPlayerID1)
  createGame(testGameID1, [testPlayerID1])
  const conn = getDB()
  const expiredTime = Date.now() - 121 * 24 * 60 * 60 * 1000
  conn.prepare(`
    update files
    set whitelist  = 0,
        created_at = ?,
        updated_at = ?
    where game_id = ?
  `).run(expiredTime, expiredTime, testGameID1)
  assert.equal(cleanupExpiredGames(), 1)
  assert.equal(getGameByID(testGameID1), null)

  createGame(testGameID1, [testPlayerID1])
  saveFileContent(testGameID1, 1, testPlayerID1, '127.0.0.1', '{"turns":1}')
  saveFileContent(testGameID1, 2, testPlayerID1, '127.0.0.1', '{"turns":2}')
  saveFilePreview(testGameID1, 1, testPlayerID1, '127.0.0.1', '{"preview":1}')
  saveFilePreview(testGameID1, 2, testPlayerID1, '127.0.0.1', '{"preview":2}')
  assert.equal(cleanupOldContents(), 1)
  assert.equal(cleanupOldPreviews(), 1)
  assert.equal(getAllTurnsForGame(testGameID1).length, 1)
  assert.equal(getLatestFilePreview(testGameID1)?.turns, 2)
})

test('批量删除空列表保持空操作', () => {
  batchDeleteGames([])
  batchUpdateGamesWhitelist([], true)
  batchUpdatePlayersWhitelist([], true)
  assert.equal(getGameByID(testGameID1), null)
})
