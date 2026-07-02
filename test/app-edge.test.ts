import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'vitest'
import {
  closeDatabase, createGame, getLatestFilePreview, getPlayerByID, getTurnsMetadata, saveFileContent,
} from '../src/database.js'
import { encodeFile } from '../src/utils.js'
import {
  basicAuth, buildGameData, loginAsAdmin, loginAsPlayer, seedPlayer, setupTestServer, testGameID1, testGameID2,
  testPassword, testPlayerID1, testPlayerID2, testPlayerID3, type TestServer,
} from './helpers/server.js'

let server: TestServer

beforeEach(() => {
  server = setupTestServer()
})

afterEach(() => {
  server.close()
})

test('/auth 覆盖认证错误和修改密码', async () => {
  assert.equal((await server.app.request('/auth')).status, 401)

  const register = await server.app.request('/auth', {
    headers: { Authorization: basicAuth() },
  })
  assert.equal(register.status, 204)

  const short = await server.app.request('/auth', {
    method: 'PUT',
    headers: { Authorization: basicAuth() },
    body: 'short',
  })
  assert.equal(short.status, 400)

  const changed = await server.app.request('/auth', {
    method: 'PUT',
    headers: { Authorization: basicAuth() },
    body: 'newpass123',
  })
  assert.equal(changed.status, 204)
  assert.equal(getPlayerByID(testPlayerID1)?.password, 'newpass123')

  const wrongPassword = await server.app.request('/auth', {
    headers: { Authorization: basicAuth(testPlayerID1, testPassword) },
  })
  assert.equal(wrongPassword.status, 401)
})

test('/files 覆盖上传错误、既有游戏权限和预览存档', async () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)

  const missing = await server.app.request(`/files/${testGameID1}`, {
    headers: { Authorization: basicAuth(), 'User-Agent': 'Unciv' },
  })
  assert.equal(missing.status, 404)

  const invalidGameId = await server.app.request('/files/invalid', {
    method: 'PUT',
    headers: { Authorization: basicAuth(), 'User-Agent': 'Unciv' },
    body: buildGameData(testGameID1, 1, [testPlayerID1]),
  })
  assert.equal(invalidGameId.status, 400)

  const empty = await server.app.request(`/files/${testGameID1}`, {
    method: 'PUT',
    headers: { Authorization: basicAuth(), 'User-Agent': 'Unciv' },
    body: '',
  })
  assert.equal(empty.status, 400)

  const invalidData = await server.app.request(`/files/${testGameID1}`, {
    method: 'PUT',
    headers: { Authorization: basicAuth(), 'User-Agent': 'Unciv' },
    body: 'not-base64-gzip',
  })
  assert.equal(invalidData.status, 400)

  const mismatchedGame = await server.app.request(`/files/${testGameID1}`, {
    method: 'PUT',
    headers: { Authorization: basicAuth(), 'User-Agent': 'Unciv' },
    body: buildGameData(testGameID2, 1, [testPlayerID1]),
  })
  assert.equal(mismatchedGame.status, 400)

  const invalidPlayers = await server.app.request(`/files/${testGameID1}`, {
    method: 'PUT',
    headers: { Authorization: basicAuth(), 'User-Agent': 'Unciv' },
    body: encodeFile(JSON.stringify({ gameId: testGameID1, turns: 1, gameParameters: { players: {} } })),
  })
  assert.equal(invalidPlayers.status, 400)

  const notParticipant = await server.app.request(`/files/${testGameID1}`, {
    method: 'PUT',
    headers: { Authorization: basicAuth(), 'User-Agent': 'Unciv' },
    body: buildGameData(testGameID1, 1, [testPlayerID2]),
  })
  assert.equal(notParticipant.status, 403)

  createGame(testGameID1, [testPlayerID2])
  const existingForbidden = await server.app.request(`/files/${testGameID1}`, {
    method: 'PUT',
    headers: { Authorization: basicAuth(), 'User-Agent': 'Unciv' },
    body: buildGameData(testGameID1, 2, [testPlayerID1, testPlayerID2]),
  })
  assert.equal(existingForbidden.status, 403)

  const preview = await server.app.request(`/files/${testGameID2}_Preview`, {
    method: 'PUT',
    headers: { Authorization: basicAuth(), 'User-Agent': 'Unciv' },
    body: buildGameData(testGameID2, 3, [testPlayerID1]),
  })
  assert.equal(preview.status, 204)
  assert.equal(getLatestFilePreview(testGameID2)?.turns, 3)

  const previewDownload = await server.app.request(`/files/${testGameID2}_Preview`, {
    headers: { Authorization: basicAuth(), 'User-Agent': 'Unciv' },
  })
  assert.equal(previewDownload.status, 200)
})

test('/chat HTTP 探测区分有效和无效认证', async () => {
  seedPlayer(testPlayerID1)

  const valid = await server.app.request('/chat', {
    headers: { Authorization: basicAuth() },
  })
  assert.equal(valid.status, 400)

  const invalid = await server.app.request('/chat', {
    headers: { Authorization: basicAuth(testPlayerID1, 'wrong-pass') },
  })
  assert.equal(invalid.status, 401)
})

test('Web 会话、管理统计和页面路由覆盖边界行为', async () => {
  seedPlayer(testPlayerID1)
  const adminCookie = await loginAsAdmin(server.app)

  const adminSession = await server.app.request('/api/session', { headers: { Cookie: adminCookie } })
  assert.deepEqual(await adminSession.json(), { isLoggedIn: true, isAdmin: true })

  const noSession = await server.app.request('/api/session')
  assert.deepEqual(await noSession.json(), { isLoggedIn: false })

  const staleSession = await server.app.request('/api/session', { headers: { Cookie: 'session_id=missing' } })
  assert.deepEqual(await staleSession.json(), { isLoggedIn: false })
  assert.ok(staleSession.headers.get('set-cookie')?.includes('Max-Age=0'))

  const stats = await server.app.request('/api/stats', { headers: { Cookie: adminCookie } })
  assert.equal(stats.status, 200)

  const emptyGamePatch = await server.app.request('/api/games/batch', {
    method: 'PATCH',
    headers: { Cookie: adminCookie },
    body: JSON.stringify({ gameIds: [], whitelist: true }),
  })
  assert.equal(emptyGamePatch.status, 400)

  const emptyGameDelete = await server.app.request('/api/games/batch', {
    method: 'DELETE',
    headers: { Cookie: adminCookie },
    body: JSON.stringify({ gameIds: [] }),
  })
  assert.equal(emptyGameDelete.status, 400)

  const index = await server.app.request('/')
  assert.equal(index.status, 200)
  assert.match(await index.text(), /Unciv/i)

  const logout = await server.app.request('/api/logout', { headers: { Cookie: adminCookie } })
  assert.equal(logout.status, 302)
  assert.equal(logout.headers.get('Location'), '/')
})

test('游戏下载、回合下载和回档覆盖权限与错误分支', async () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)
  seedPlayer(testPlayerID3)
  createGame(testGameID1, [testPlayerID1, testPlayerID2])
  saveFileContent(testGameID1, 1, testPlayerID1, '127.0.0.1', '{"turns":1}')

  const creatorCookie = await loginAsPlayer(server.app, testPlayerID1)
  const otherCookie = await loginAsPlayer(server.app, testPlayerID2)
  const outsiderCookie = await loginAsPlayer(server.app, testPlayerID3)
  const turnId = getTurnsMetadata(testGameID1)[0]!.id

  const outsiderTurns = await server.app.request(`/api/games/${testGameID1}/turns`, {
    headers: { Cookie: outsiderCookie },
  })
  assert.equal(outsiderTurns.status, 403)

  const missingGameTurns = await server.app.request(`/api/games/${testGameID2}/turns`, {
    headers: { Cookie: creatorCookie },
  })
  assert.equal(missingGameTurns.status, 404)

  const turnDownload = await server.app.request(`/api/games/${testGameID1}/turns/${turnId}/download`, {
    headers: { Cookie: otherCookie },
  })
  assert.equal(turnDownload.status, 200)
  assert.equal(turnDownload.headers.get('Content-Type'), 'application/json')
  assert.equal(await turnDownload.text(), '{"turns":1}')

  const missingTurn = await server.app.request(`/api/games/${testGameID1}/turns/${turnId + 999}/download`, {
    headers: { Cookie: creatorCookie },
  })
  assert.equal(missingTurn.status, 404)

  const missingRollbackPreview = await server.app.request(`/api/games/${testGameID1}/turns/${turnId}/rollback`, {
    method: 'POST',
    headers: { Cookie: creatorCookie },
  })
  assert.equal(missingRollbackPreview.status, 404)

  const missingRollbackTurn = await server.app.request(`/api/games/${testGameID1}/turns/${turnId + 999}/rollback`, {
    method: 'POST',
    headers: { Cookie: creatorCookie },
  })
  assert.equal(missingRollbackTurn.status, 404)
})

test('应用未处理异常统一返回 500', async () => {
  const adminCookie = await loginAsAdmin(server.app)
  closeDatabase()

  const response = await server.app.request('/api/stats', {
    headers: { Cookie: adminCookie },
  })
  assert.equal(response.status, 500)
})
