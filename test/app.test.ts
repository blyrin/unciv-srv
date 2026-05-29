import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { getPlayerByID } from '../src/database.js'
import { decodeFile } from '../src/utils.js'
import {
  basicAuth, buildGameData, seedGameWithContent, seedPlayer, setupTestServer, startHttpServer, testGameID1,
  testPassword, testPlayerID1, type TestServer,
} from './helpers.js'

let server: TestServer

beforeEach(() => {
  server = setupTestServer()
})

afterEach(() => {
  server.close()
})

test('/isalive 返回健康检查内容', async () => {
  const response = await server.app.request('/isalive')
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '{"authVersion":1,"chatVersion":1}')
})

test('/auth 自动注册并返回 204', async () => {
  const response = await server.app.request('/auth', {
    headers: { Authorization: basicAuth() },
  })
  assert.equal(response.status, 204)
})

test('HTTP 直连请求写入真实远端 IP', async () => {
  const http = await startHttpServer(server.app)
  try {
    const response = await fetch(`${http.url}/auth`, {
      headers: { Authorization: basicAuth() },
    })
    assert.equal(response.status, 204)
    const player = getPlayerByID(testPlayerID1)
    assert.ok(player?.createIp)
    assert.notEqual(player.createIp, 'unknown')
    assert.doesNotMatch(player.createIp, /^::ffff:/)
  } finally {
    http.server.close()
  }
})

test('/files 上传和下载正式存档', async () => {
  seedPlayer()
  const body = buildGameData(testGameID1, 4, [testPlayerID1])
  const put = await server.app.request(`/files/${testGameID1}`, {
    method: 'PUT',
    headers: {
      Authorization: basicAuth(),
      'User-Agent': 'Unciv',
    },
    body,
  })
  assert.equal(put.status, 204)

  const get = await server.app.request(`/files/${testGameID1}`, {
    headers: {
      Authorization: basicAuth(),
      'User-Agent': 'Unciv',
    },
  })
  assert.equal(get.status, 200)
  assert.equal(JSON.parse(decodeFile(await get.text())).turns, 4)
})

test('/files 拒绝非 Unciv 客户端', async () => {
  const response = await server.app.request(`/files/${testGameID1}`, {
    headers: { Authorization: basicAuth() },
  })
  assert.equal(response.status, 403)
})

test('/api/login 和 /api/session 保持 Cookie 会话行为', async () => {
  seedPlayer()
  const login = await server.app.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: testPlayerID1, password: testPassword }),
  })
  assert.equal(login.status, 200)
  assert.deepEqual(await login.json(), { playerId: testPlayerID1 })

  const cookie = login.headers.get('set-cookie')
  assert.ok(cookie?.includes('session_id='))
  const session = await server.app.request('/api/session', {
    headers: { Cookie: cookie ?? '' },
  })
  assert.deepEqual(await session.json(), { isLoggedIn: true, playerId: testPlayerID1 })
})

test('用户可以下载参与游戏的回合列表和 ZIP', async () => {
  seedGameWithContent()
  const login = await server.app.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: testPlayerID1, password: testPassword }),
  })
  const cookie = login.headers.get('set-cookie') ?? ''

  const turns = await server.app.request(`/api/games/${testGameID1}/turns`, {
    headers: { Cookie: cookie },
  })
  assert.equal(turns.status, 200)
  assert.equal((await turns.json()).length, 1)

  const download = await server.app.request(`/api/games/${testGameID1}/download`, {
    headers: { Cookie: cookie },
  })
  assert.equal(download.status, 200)
  assert.equal(download.headers.get('Content-Type'), 'application/zip')
})
