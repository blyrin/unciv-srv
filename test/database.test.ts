import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'vitest'
import {
  acquireSimultaneousTurnLock, appendSimultaneousTurnOperations, createGame, createPlayer, getDB, getAllStats,
  getGameByID, getGamesByPlayer, getLatestFileContent, getPlayerByID, getPlayersPage, getSimultaneousTurnOperations,
  maxSimultaneousTurn, releaseSimultaneousTurnLock, renewSimultaneousTurnLock, rollbackGameToTurn, saveFileContent, saveFilePreview,
  listSimultaneousTurnReservations, reserveSimultaneousTurnKeys,
  maxSimultaneousTurnOperations, SimultaneousTurnOperationLimitError,
  simultaneousTurnOperationsRetention, updatePlayerInfo,
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
test('锁释放只允许持有者本人，释放后其他玩家可以接管', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1])

  assert.equal(acquireSimultaneousTurnLock(testGameID1, 5, testPlayerID1), true)
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 5, testPlayerID2), false)

  // 非持有者释放是空操作
  releaseSimultaneousTurnLock(testGameID1, 5, testPlayerID2)
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 5, testPlayerID2), false)

  releaseSimultaneousTurnLock(testGameID1, 5, testPlayerID1)
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 5, testPlayerID2), true)
})

test('预占按回合先到者得，且一次动作要么全部拿到要么一个都不拿', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1, testPlayerID2])

  // 对象空闲时整组拿到
  assert.deepEqual(reserveSimultaneousTurnKeys(testGameID1, 3, testPlayerID1, ['tile:3,-2', 'unit:42']), [])
  // 同一玩家重复预占自己是幂等的：同一个单位要连续移动
  assert.deepEqual(reserveSimultaneousTurnKeys(testGameID1, 3, testPlayerID1, ['unit:42']), [])
  // 别人占用时报出占用者，客户端据此提示"正被谁占用"
  assert.deepEqual(reserveSimultaneousTurnKeys(testGameID1, 3, testPlayerID2, ['tile:3,-2']), [
    { key: 'tile:3,-2', owner: testPlayerID1 },
  ])
  // 一组里只要有一个被别人占用就整组失败，不能只占一半导致重放到一半的动作
  assert.deepEqual(reserveSimultaneousTurnKeys(testGameID1, 3, testPlayerID2, ['unit:7', 'tile:3,-2']), [
    { key: 'tile:3,-2', owner: testPlayerID1 },
  ])
  assert.deepEqual(listSimultaneousTurnReservations(testGameID1, 3), [
    { key: 'tile:3,-2', owner: testPlayerID1 },
    { key: 'unit:42', owner: testPlayerID1 },
  ])
})

test('预占只在该回合内生效，换回合后同一对象可以重新占用', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1, testPlayerID2])

  assert.deepEqual(reserveSimultaneousTurnKeys(testGameID1, 3, testPlayerID1, ['tile:3,-2']), [])
  // 占用是按回合记录的：下一回合同一格不该被上一回合的占用挡住
  assert.deepEqual(reserveSimultaneousTurnKeys(testGameID1, 4, testPlayerID2, ['tile:3,-2']), [])
  assert.deepEqual(listSimultaneousTurnReservations(testGameID1, 3), [{ key: 'tile:3,-2', owner: testPlayerID1 }])
})

test('取锁结算后清理已结算回合的预占，掉线玩家的占用不会永久挡路', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1, testPlayerID2])

  const staleTurn = 1
  assert.deepEqual(reserveSimultaneousTurnKeys(testGameID1, staleTurn, testPlayerID1, ['tile:3,-2']), [])
  // 取锁说明该回合正在结算：比保留窗口更早的回合必然已经结算，占用随之清理
  assert.equal(
    acquireSimultaneousTurnLock(testGameID1, staleTurn + simultaneousTurnOperationsRetention + 1, testPlayerID2),
    true,
  )
  assert.deepEqual(listSimultaneousTurnReservations(testGameID1, staleTurn), [])
})

test('已结算回合的操作按回合窗口裁剪，不会无限堆积', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1])
  const append = (turn: number, sequence = 0) => appendSimultaneousTurnOperations(
    testGameID1, testPlayerID1, [{ turn, sequence, type: 'move', playerId: testPlayerID1 }],
  )
  const read = () => JSON.parse(getSimultaneousTurnOperations(testGameID1) ?? '[]') as Array<{
    turn: number, sequence: number, playerId: string
  }>

  const totalTurns = simultaneousTurnOperationsRetention + 5
  for (let turn = 0; turn <= totalTurns; turn++) {
    append(turn)
  }

  const saved = read()
  assert.equal(saved.length, simultaneousTurnOperationsRetention + 1)
  assert.equal(saved[0]?.turn, totalTurns - simultaneousTurnOperationsRetention)
  assert.equal(saved.at(-1)?.turn, totalTurns)

  // 取锁意味着更早的回合已经结算，锁路径也会清掉窗口之外的操作
  assert.equal(acquireSimultaneousTurnLock(testGameID1, totalTurns + 3, testPlayerID1), true)
  for (const operation of read()) {
    assert.ok(operation.turn >= totalTurns + 3 - simultaneousTurnOperationsRetention)
  }
})

test('同一玩家重复提交同一操作是幂等的', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1])
  const marker = { turn: 4, sequence: 1, type: 'done', playerId: testPlayerID1 }
  const read = () => JSON.parse(getSimultaneousTurnOperations(testGameID1) ?? '[]') as Array<{
    turn: number, sequence: number, playerId: string
  }>

  appendSimultaneousTurnOperations(testGameID1, testPlayerID1, [marker])
  assert.equal(read().length, 1)

  appendSimultaneousTurnOperations(testGameID1, testPlayerID1, [marker])
  assert.equal(read().length, 1)

  appendSimultaneousTurnOperations(testGameID1, testPlayerID1, [marker, marker])
  assert.equal(read().length, 1)
})

test('结算锁拒绝超出上限的回合号', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1])

  assert.equal(acquireSimultaneousTurnLock(testGameID1, maxSimultaneousTurn + 1, testPlayerID1), false)
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 5, testPlayerID1), true)
})

test('结算锁只能由持有者续期，续期后过期时间被延长', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1])
  const now = Date.now()

  assert.equal(acquireSimultaneousTurnLock(testGameID1, 7, testPlayerID1, now), true)
  // 锁存在但持有者不匹配时续期失败，且不会改变过期时间
  assert.equal(renewSimultaneousTurnLock(testGameID1, 7, testPlayerID2, now + 60_000), false)
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 7, testPlayerID2, now + 119_000), false)

  // 持有者在过期前续期，把过期点从 now+120s 推到 now+180s+120s
  assert.equal(renewSimultaneousTurnLock(testGameID1, 7, testPlayerID1, now + 60_000), true)
  // 按原过期点（now+120s）本可以接管的其他玩家，此刻仍然拿不到锁
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 7, testPlayerID2, now + 150_000), false)
  // 续期后的过期点（now+180s）之后，接管语义保持不变：其他玩家仍可接手
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 7, testPlayerID2, now + 180_001), true)
})

test('续期失败时锁已过期，其他玩家仍可接管', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1])
  const now = Date.now()

  assert.equal(acquireSimultaneousTurnLock(testGameID1, 8, testPlayerID1, now), true)
  // 超过 120 秒既未续期也未释放后，其他玩家接管
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 8, testPlayerID2, now + 120_001), true)
  // 原持有者此时续期应失败（锁已易主），且无法因此抢回锁
  assert.equal(renewSimultaneousTurnLock(testGameID1, 8, testPlayerID1, now + 121_000), false)
  assert.equal(acquireSimultaneousTurnLock(testGameID1, 8, testPlayerID1, now + 121_000), false)
})

test('单局操作总量达到上限后拒绝追加，且不影响已有数据', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1])
  const makeOperations = (from: number, count: number) => Array.from({ length: count }, (_, index) => ({
    turn: 0, sequence: from + index, type: 'move', playerId: testPlayerID1,
  }))
  const read = () => JSON.parse(getSimultaneousTurnOperations(testGameID1) ?? '[]') as unknown[]

  // 恰好达到上限的提交允许通过
  appendSimultaneousTurnOperations(testGameID1, testPlayerID1, makeOperations(0, maxSimultaneousTurnOperations))
  assert.equal(read().length, maxSimultaneousTurnOperations)

  // 再多一条就会超限，必须抛错并回滚，已有数据元素数量保持不变
  assert.throws(
    () => appendSimultaneousTurnOperations(
      testGameID1, testPlayerID1, [{ turn: 0, sequence: maxSimultaneousTurnOperations, type: 'move', playerId: testPlayerID1 }],
    ),
    (error: unknown) => error instanceof SimultaneousTurnOperationLimitError,
  )
  assert.equal(read().length, maxSimultaneousTurnOperations)
})

test('单局操作总量超限时优先丢弃最旧回合，而不是拒绝提交', () => {
  seedPlayer()
  createGame(testGameID1, [testPlayerID1])
  const makeOperations = (turn: number, from: number, count: number) => Array.from({ length: count }, (_, index) => ({
    turn, sequence: from + index, type: 'move', playerId: testPlayerID1,
  }))
  const read = () => JSON.parse(getSimultaneousTurnOperations(testGameID1) ?? '[]') as Array<{ turn: number }>

  const half = Math.floor(maxSimultaneousTurnOperations / 2)
  appendSimultaneousTurnOperations(testGameID1, testPlayerID1, makeOperations(5, 0, half))
  assert.equal(read().length, half)

  // 新回合的操作让总量超过上限：最旧的第 5 回合应被整回合丢弃，新回合的操作仍然写入
  const second = maxSimultaneousTurnOperations - half + 1
  appendSimultaneousTurnOperations(testGameID1, testPlayerID1, makeOperations(10, 0, second))
  const retained = read()
  assert.equal(retained.length, second)
  assert.equal(retained.every((operation) => operation.turn === 10), true)
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
