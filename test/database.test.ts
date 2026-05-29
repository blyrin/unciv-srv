import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import {
  createGame, getAllStats, getGameByID, getGamesByPlayer, getLatestFileContent, getPlayerByID, getPlayersPage,
  rollbackGameToTurn, saveFileContent, saveFilePreview,
} from '../src/database.js'
import { seedPlayer, setupTestServer, testGameID1, testPassword, testPlayerID1, type TestServer } from './helpers.js'

let server: TestServer

beforeEach(() => {
  server = setupTestServer()
})

afterEach(() => {
  server.close()
})

test('玩家和分页查询保持 JSON 字段形状', () => {
  seedPlayer()
  const player = getPlayerByID(testPlayerID1)
  assert.equal(player?.password, testPassword)
  assert.equal(player?.whitelist, false)

  const page = getPlayersPage('', 1, 20)
  assert.equal(page.total, 1)
  assert.equal(page.items[0]?.playerId, testPlayerID1)
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

  const firstTurn = getLatestFileContent(testGameID1)
  assert.equal(firstTurn?.turns, 2)
  const result = rollbackGameToTurn(testGameID1, 1)
  assert.deepEqual(result, { deletedTurns: 1, deletedPreviews: 1, currentTurns: 1 })
})
