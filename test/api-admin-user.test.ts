import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { createGame, getGameByID, getPlayerByID, saveFileContent, saveFilePreview } from '../src/database.js'
import {
  loginAsAdmin, loginAsPlayer, seedGameWithContent, seedPlayer, setupTestServer, testGameID1, testPassword,
  testPlayerID1, testPlayerID2, type TestServer,
} from './helpers.js'

let server: TestServer

beforeEach(() => {
  server = setupTestServer()
})

afterEach(() => {
  server.close()
})

test('管理员玩家接口覆盖列表、备注、密码和批量白名单', async () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)
  const cookie = await loginAsAdmin(server.app)

  const list = await server.app.request('/api/players?page=0&pageSize=300', { headers: { Cookie: cookie } })
  assert.equal(list.status, 200)
  const listBody = await list.json() as {
    items: Array<{ password?: string; createdAt: unknown; updatedAt: unknown }>; total: number
  }
  assert.equal(listBody.total, 2)
  assert.equal(listBody.items.every((player) => player.password === undefined), true)
  assert.equal(typeof listBody.items[0]?.createdAt, 'number')
  assert.equal(typeof listBody.items[0]?.updatedAt, 'number')

  const update = await server.app.request(`/api/players/${testPlayerID1}`, {
    method: 'PUT',
    headers: { Cookie: cookie },
    body: JSON.stringify({ whitelist: true, remark: '备注' }),
  })
  assert.equal(update.status, 204)
  assert.equal(getPlayerByID(testPlayerID1)?.remark, '备注')

  const password = await server.app.request(`/api/players/${testPlayerID1}/password`, { headers: { Cookie: cookie } })
  assert.deepEqual(await password.json(), { password: testPassword })

  const updatePassword = await server.app.request(`/api/players/${testPlayerID1}/password`, {
    method: 'PUT',
    headers: { Cookie: cookie },
    body: JSON.stringify({ password: 'newpass123' }),
  })
  assert.equal(updatePassword.status, 204)
  assert.equal(getPlayerByID(testPlayerID1)?.password, 'newpass123')

  const batch = await server.app.request('/api/players/batch', {
    method: 'PATCH',
    headers: { Cookie: cookie },
    body: JSON.stringify({ playerIds: [testPlayerID1, testPlayerID2], whitelist: true }),
  })
  assert.equal(batch.status, 204)
  assert.equal(getPlayerByID(testPlayerID2)?.whitelist, true)
})

test('管理员玩家接口返回预期错误状态', async () => {
  seedPlayer(testPlayerID1)
  const cookie = await loginAsAdmin(server.app)

  assert.equal((await server.app.request('/api/players/not-exist/password', { headers: { Cookie: cookie } })).status, 404)
  assert.equal((await server.app.request(`/api/players/${testPlayerID1}`, {
    method: 'PUT', headers: { Cookie: cookie }, body: '{',
  })).status, 400)
  assert.equal((await server.app.request(`/api/players/${testPlayerID1}/password`, {
    method: 'PUT',
    headers: { Cookie: cookie },
    body: JSON.stringify({ password: 'short' }),
  })).status, 400)
  assert.equal((await server.app.request('/api/players/batch', {
    method: 'PATCH',
    headers: { Cookie: cookie },
    body: JSON.stringify({ playerIds: [], whitelist: true }),
  })).status, 400)
})

test('管理员游戏接口覆盖列表、更新、批量和删除', async () => {
  seedGameWithContent()
  const cookie = await loginAsAdmin(server.app)

  const list = await server.app.request('/api/games?page=0&pageSize=200', { headers: { Cookie: cookie } })
  assert.equal(list.status, 200)
  const listBody = await list.json() as { items: Array<{ createdAt: unknown; updatedAt: unknown }>; total: number }
  assert.equal(listBody.total, 1)
  assert.equal(typeof listBody.items[0]?.createdAt, 'number')
  assert.equal(typeof listBody.items[0]?.updatedAt, 'number')

  const update = await server.app.request(`/api/games/${testGameID1}`, {
    method: 'PUT',
    headers: { Cookie: cookie },
    body: JSON.stringify({ whitelist: true, remark: '游戏备注' }),
  })
  assert.equal(update.status, 204)
  assert.equal(getGameByID(testGameID1)?.remark, '游戏备注')

  const batch = await server.app.request('/api/games/batch', {
    method: 'PATCH',
    headers: { Cookie: cookie },
    body: JSON.stringify({ gameIds: [testGameID1], whitelist: false }),
  })
  assert.equal(batch.status, 204)
  assert.equal(getGameByID(testGameID1)?.whitelist, false)

  const deleted = await server.app.request('/api/games/batch', {
    method: 'DELETE',
    headers: { Cookie: cookie },
    body: JSON.stringify({ gameIds: [testGameID1] }),
  })
  assert.equal(deleted.status, 204)
  assert.equal(getGameByID(testGameID1), null)
})

test('用户接口覆盖游戏、统计和修改密码', async () => {
  seedGameWithContent()
  const cookie = await loginAsPlayer(server.app)

  const games = await server.app.request('/api/users/games', { headers: { Cookie: cookie } })
  assert.equal(games.status, 200)
  assert.equal((await games.json() as { playerId: string; games: unknown[] }).playerId, testPlayerID1)

  const stats = await server.app.request('/api/users/stats', { headers: { Cookie: cookie } })
  assert.deepEqual(await stats.json(), { gameCount: 1, createdCount: 1 })

  const wrongOld = await server.app.request('/api/users/password', {
    method: 'PUT',
    headers: { Cookie: cookie },
    body: JSON.stringify({ oldPassword: 'wrong', newPassword: 'newpass123' }),
  })
  assert.equal(wrongOld.status, 400)

  const changed = await server.app.request('/api/users/password', {
    method: 'PUT',
    headers: { Cookie: cookie },
    body: JSON.stringify({ oldPassword: testPassword, newPassword: 'newpass123' }),
  })
  assert.equal(changed.status, 204)
  assert.equal(getPlayerByID(testPlayerID1)?.password, 'newpass123')
})

test('游戏权限接口覆盖创建者、非创建者、下载和回档错误', async () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)
  createGame(testGameID1, [testPlayerID1, testPlayerID2])
  saveFileContent(testGameID1, 1, testPlayerID1, '127.0.0.1', '{"turns":1}')
  saveFilePreview(testGameID1, 1, testPlayerID1, '127.0.0.1', '{"turns":1}')
  saveFileContent(testGameID1, 2, testPlayerID1, '127.0.0.1', '{"turns":2}')
  saveFilePreview(testGameID1, 2, testPlayerID1, '127.0.0.1', '{"turns":2}')
  const creatorCookie = await loginAsPlayer(server.app, testPlayerID1)
  const otherCookie = await loginAsPlayer(server.app, testPlayerID2)

  const turns = await server.app.request(`/api/games/${testGameID1}/turns`, { headers: { Cookie: otherCookie } })
  const turnList = await turns.json() as Array<{ id: number }>
  assert.equal(turns.status, 200)

  const forbiddenRollback = await server.app.request(`/api/games/${testGameID1}/turns/${turnList[0]!.id}/rollback`, {
    method: 'POST',
    headers: { Cookie: otherCookie },
  })
  assert.equal(forbiddenRollback.status, 403)

  const invalidTurn = await server.app.request(`/api/games/${testGameID1}/turns/abc/download`, { headers: { Cookie: creatorCookie } })
  assert.equal(invalidTurn.status, 400)

  const rollback = await server.app.request(`/api/games/${testGameID1}/turns/${turnList[0]!.id}/rollback`, {
    method: 'POST',
    headers: { Cookie: creatorCookie },
  })
  assert.equal(rollback.status, 200)
  assert.equal((await rollback.json() as { currentTurns: number }).currentTurns, 1)

  const deleted = await server.app.request(`/api/games/${testGameID1}`, {
    method: 'DELETE',
    headers: { Cookie: creatorCookie },
  })
  assert.equal(deleted.status, 204)
})

test('登录、Session 和管理员权限错误符合接口约定', async () => {
  seedPlayer(testPlayerID1)
  const badJson = await server.app.request('/api/login', { method: 'POST', body: '{' })
  assert.equal(badJson.status, 400)

  for (let i = 0; i < 4; i += 1) {
    const response = await server.app.request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: testPlayerID1, password: 'wrong-pass' }),
    })
    assert.equal(response.status, 401)
  }
  const locked = await server.app.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: testPlayerID1, password: 'wrong-pass' }),
  })
  assert.equal(locked.status, 429)
  server.limiter.resetAttempts('unknown')

  const noSession = await server.app.request('/api/users/games')
  assert.equal(noSession.status, 401)

  const playerCookie = await loginAsPlayer(server.app)
  const adminOnly = await server.app.request('/api/players', { headers: { Cookie: playerCookie } })
  assert.equal(adminOnly.status, 403)
})
