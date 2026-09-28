import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'vitest'
import {
  acquireSimultaneousTurnLock, createGame, createPlayer, getDB, getAllStats, getGameByID, getGamesByPlayer,
  getLatestFileContent, getPlayerByID, getPlayersPage, rollbackGameToTurn, saveFileContent, saveFilePreview, updatePlayerInfo,
} from '../src/database.js'
import { isHashedPassword, verifyPassword } from '../src/password.js'
import {
  seedPlayer, setupTestServer, testGameID1, testPassword, testPlayerID1, testPlayerID2, testPlayerID3, type TestServer,
} from './helpers/server.js'

let server: TestServer

beforeEach(() => {
  server = setupTestServer()
})

afterEach(() => {
  server.close()
})

test('同步回合结算锁对同一游戏回合提供互斥且支持幂等重试', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1])

  assert.equal(acquireSimultaneousTurnLock(testGameID1, 3, testPlayerID1), true)
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 3, testPlayerID1), true)
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 3, 'other-player'), false)
})

test('上一回合遗留的结算锁不会永久阻塞后续回合', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1])
  const now = Date.now()

  // 玩家在第 3 回合获取锁后崩溃，锁未释放也未过期
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 3, testPlayerID1, now), true)
  // 第 4 回合必须能够接管上一回合的锁，否则该局永久卡死
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 4, testPlayerID1, now), true)
  // 同一回合内仍然互斥
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 4, 'other-player', now), false)
})
test('玩家和分页查询保持 JSON 字段形状', () => {
  seedPlayer()
  const player = getPlayerByID(testPlayerID1)
  assert.equal(isHashedPassword(player?.password ?? ''), true)
  assert.equal(verifyPassword(testPassword, player?.password ?? ''), true)
  assert.equal(player?.whitelist, false)
  assert.equal(player?.approved, true)

  const page = getPlayersPage({ page: 1, pageSize: 20 })
  assert.equal(page.total, 1)
  assert.equal(page.items[0]?.playerId, testPlayerID1)
})

test('玩家列表支持按审核状态、白名单、关键词与排序筛选', () => {
  seedPlayer(testPlayerID1)
  createPlayer(testPlayerID2, testPassword, '127.0.0.1', false)
  seedPlayer(testPlayerID3)
  updatePlayerInfo(testPlayerID3, true, '白名单玩家')
  createGame(testGameID1, [testPlayerID1])
  // 手动拉开注册时间，保证排序断言稳定
  getDB().prepare('update players set created_at = ? where player_id = ?').run(1000, testPlayerID1)
  getDB().prepare('update players set created_at = ? where player_id = ?').run(2000, testPlayerID2)
  getDB().prepare('update players set created_at = ? where player_id = ?').run(3000, testPlayerID3)

  const pending = getPlayersPage({ page: 1, pageSize: 20, status: 'pending' })
  assert.deepEqual(pending.items.map((item) => item.playerId), [testPlayerID2])
  assert.equal(pending.total, 1)

  const approved = getPlayersPage({ page: 1, pageSize: 20, status: 'approved' })
  assert.equal(approved.total, 2)

  const whitelist = getPlayersPage({ page: 1, pageSize: 20, whitelist: 'yes' })
  assert.deepEqual(whitelist.items.map((item) => item.playerId), [testPlayerID3])
  assert.equal(getPlayersPage({ page: 1, pageSize: 20, whitelist: 'no' }).total, 2)

  const keyword = getPlayersPage({ page: 1, pageSize: 20, keyword: '白名单' })
  assert.deepEqual(keyword.items.map((item) => item.playerId), [testPlayerID3])

  const pendingAndKeyword = getPlayersPage({ page: 1, pageSize: 20, status: 'pending', keyword: testPlayerID3 })
  assert.equal(pendingAndKeyword.total, 0)

  const asc = getPlayersPage({ page: 1, pageSize: 20, sort: 'created_asc' })
  assert.deepEqual(asc.items.map((item) => item.playerId), [testPlayerID1, testPlayerID2, testPlayerID3])
  const desc = getPlayersPage({ page: 1, pageSize: 20, sort: 'created_desc' })
  assert.deepEqual(desc.items.map((item) => item.playerId), [testPlayerID3, testPlayerID2, testPlayerID1])

  // 对局数：只有 testPlayerID1 参与了对局
  assert.deepEqual(asc.items.map((item) => item.gameCount), [1, 0, 0])
})

test('游戏和最新存档查询使用项目表结构', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1])
  saveFileContent(testGameID1, 2, testPlayerID1, '127.0.0.1', '{"turns":2}')

  const game = getGameByID(testGameID1)
  assert.deepEqual(game?.players, [testPlayerID1])
  assert.equal(getGamesByPlayer(testPlayerID1)[0]?.turns, 2)
  assert.equal(getLatestFileContent(testGameID1)?.data, '{"turns":2}')
})

test('统计和回档返回接口字段', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1])
  saveFileContent(testGameID1, 1, testPlayerID1, '127.0.0.1', '{"turns":1}')
  saveFilePreview(testGameID1, 1, testPlayerID1, '127.0.0.1', '{"turns":1}')
  saveFileContent(testGameID1, 2, testPlayerID1, '127.0.0.1', '{"turns":2}')
  saveFilePreview(testGameID1, 2, testPlayerID1, '127.0.0.1', '{"turns":2}')

  const stats = getAllStats()
  assert.equal(stats.playerCount, 1)
  assert.equal(stats.gameCount, 1)
  assert.equal(stats.totalSaves, 2)

  const latestTurn = getLatestFileContent(testGameID1)
  assert.equal(latestTurn?.turns, 2)
  const result = rollbackGameToTurn(testGameID1, 1)
  assert.deepEqual(result, { deletedTurns: 1, deletedPreviews: 1, currentTurns: 1 })
})
