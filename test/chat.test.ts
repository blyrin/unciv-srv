import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { once } from 'node:events'
import WebSocket from 'ws'
import { createGame } from '../src/database.js'
import {
  basicAuth, buildGameData, seedPlayer, setupTestServer, startHttpServer, testGameID1, testPlayerID1, testPlayerID2,
  type TestServer,
} from './helpers.js'

let server: TestServer

beforeEach(() => {
  server = setupTestServer()
})

afterEach(() => {
  server.close()
})

/**
 * 建立测试 WebSocket 连接。
 */
async function openSocket(url: string, auth = basicAuth()): Promise<WebSocket> {
  const ws = new WebSocket(`ws${url.slice('http'.length)}/chat`, {
    headers: { Authorization: auth },
  })
  await once(ws, 'open')
  return ws
}

/**
 * 读取一条 JSON 消息。
 */
async function readMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 WebSocket 消息超时')), 2000)
    timer.unref()
  })
  const [data] = await Promise.race([once(ws, 'message'), timeout])
  return JSON.parse(data.toString()) as Record<string, unknown>
}

/**
 * 读取握手失败状态并消费响应体。
 */
async function readUnexpectedStatus(ws: WebSocket): Promise<number | undefined> {
  const [, response] = await once(ws, 'unexpected-response')
  response.resume()
  return response.statusCode
}

test('WebSocket 订阅后广播聊天消息', async () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)
  const http = await startHttpServer(server.app)

  const ws1 = await openSocket(http.url, basicAuth(testPlayerID1))
  const ws2 = await openSocket(http.url, basicAuth(testPlayerID2))
  ws1.send(JSON.stringify({ type: 'join', gameIds: [testGameID1, `${testGameID1}_Preview`, 'invalid'] }))
  assert.deepEqual(await readMessage(ws1), { type: 'joinSuccess', gameIds: [testGameID1] })

  ws2.send(JSON.stringify({ type: 'join', gameIds: [testGameID1] }))
  assert.deepEqual(await readMessage(ws2), { type: 'joinSuccess', gameIds: [testGameID1] })

  ws1.send(JSON.stringify({ type: 'chat', gameId: testGameID1, civName: 'Rome', message: 'hello' }))
  assert.equal((await readMessage(ws1)).message, 'hello')
  assert.equal((await readMessage(ws2)).message, 'hello')

  ws1.close()
  ws2.close()
  http.server.close()
})

test('旧客户端未订阅时按游戏玩家广播', async () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)
  createGame(testGameID1, [testPlayerID1, testPlayerID2])
  const http = await startHttpServer(server.app)

  const ws1 = await openSocket(http.url, basicAuth(testPlayerID1))
  const ws2 = await openSocket(http.url, basicAuth(testPlayerID2))
  ws1.send(JSON.stringify({ type: 'chat', gameId: testGameID1, civName: 'Rome', message: 'legacy' }))
  assert.equal((await readMessage(ws1)).message, 'legacy')
  assert.equal((await readMessage(ws2)).message, 'legacy')

  ws1.close()
  ws2.close()
  http.server.close()
})

test('PUT 存档后向订阅者发送 gameUpdated', async () => {
  seedPlayer(testPlayerID1)
  const http = await startHttpServer(server.app)
  const ws = await openSocket(http.url)

  ws.send(JSON.stringify({ type: 'join', gameIds: [testGameID1] }))
  await readMessage(ws)

  const updateMessage = readMessage(ws)
  const response = await fetch(`${http.url}/files/${testGameID1}`, {
    method: 'PUT',
    headers: {
      Authorization: basicAuth(),
      'User-Agent': 'Unciv',
    },
    body: buildGameData(testGameID1, 2, [testPlayerID1]),
  })
  assert.equal(response.status, 204)
  assert.deepEqual(await updateMessage, { type: 'gameUpdated', gameId: testGameID1 })

  ws.close()
  http.server.close()
})

test('WebSocket 拒绝缺失和错误认证', async () => {
  seedPlayer(testPlayerID1)
  const http = await startHttpServer(server.app)

  try {
    const noAuth = new WebSocket(`ws${http.url.slice('http'.length)}/chat`)
    assert.equal(await readUnexpectedStatus(noAuth), 401)

    const wrongAuth = new WebSocket(`ws${http.url.slice('http'.length)}/chat`, {
      headers: { Authorization: basicAuth(testPlayerID1, 'wrong-pass') },
    })
    assert.equal(await readUnexpectedStatus(wrongAuth), 401)
  } finally {
    http.server.close()
  }
})

test('无效消息、未订阅聊天和 leave 返回预期错误', async () => {
  seedPlayer(testPlayerID1)
  const http = await startHttpServer(server.app)
  const ws = await openSocket(http.url)

  ws.send('{')
  assert.deepEqual(await readMessage(ws), { type: 'error', message: '无效的消息格式' })

  ws.send(JSON.stringify({ type: 'chat', gameId: 'invalid', civName: 'Rome', message: 'hello' }))
  const invalidGame = await readMessage(ws)
  assert.equal(invalidGame.type, 'chat')
  assert.equal(invalidGame.civName, 'Server')

  ws.send(JSON.stringify({ type: 'chat', gameId: testGameID1, civName: 'Rome', message: 'hello' }))
  assert.deepEqual(await readMessage(ws), { type: 'error', message: '未订阅此频道' })

  ws.send(JSON.stringify({ type: 'join', gameIds: [testGameID1] }))
  await readMessage(ws)
  ws.send(JSON.stringify({ type: 'leave', gameIds: [testGameID1] }))
  ws.send(JSON.stringify({ type: 'chat', gameId: testGameID1, civName: 'Rome', message: 'hello' }))
  assert.deepEqual(await readMessage(ws), { type: 'error', message: '未订阅此频道' })

  ws.close()
  http.server.close()
})

test('在线状态消息只在订阅频道内转发', async () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)
  const http = await startHttpServer(server.app)
  const ws1 = await openSocket(http.url, basicAuth(testPlayerID1))
  const ws2 = await openSocket(http.url, basicAuth(testPlayerID2))

  for (const ws of [ws1, ws2]) {
    ws.send(JSON.stringify({ type: 'join', gameIds: [testGameID1] }))
    await readMessage(ws)
  }

  ws1.send(JSON.stringify({ type: 'onlineQuery', gameId: testGameID1, civName: 'Rome' }))
  assert.deepEqual(await readMessage(ws1), { type: 'onlineQuery', gameId: testGameID1, civName: 'Rome' })
  assert.deepEqual(await readMessage(ws2), { type: 'onlineQuery', gameId: testGameID1, civName: 'Rome' })

  ws2.send(JSON.stringify({ type: 'onlineResponse', gameId: testGameID1, civName: 'Egypt' }))
  assert.deepEqual(await readMessage(ws1), { type: 'onlineResponse', gameId: testGameID1, civName: 'Egypt' })
  assert.deepEqual(await readMessage(ws2), { type: 'onlineResponse', gameId: testGameID1, civName: 'Egypt' })

  ws1.close()
  ws2.close()
  http.server.close()
})
