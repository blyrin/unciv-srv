import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'vitest'
import { once } from 'node:events'
import type { IncomingMessage } from 'node:http'
import WebSocket from 'ws'
import { parseWebSocketAuth } from '../src/chat.js'
import { createGame } from '../src/database.js'
import {
  basicAuth, buildGameData, seedPlayer, setupTestServer, startHttpServer, testGameID1, testPlayerID1, testPlayerID2,
  testPlayerID3, type TestServer,
} from './helpers/server.js'

let server: TestServer

beforeEach(() => {
  server = setupTestServer()
})

afterEach(() => {
  server.close()
})

function wsUrl(url: string, path = '/chat'): string {
  return `ws${url.slice('http'.length)}${path}`
}

async function openSocket(url: string, auth = basicAuth(), headers: Record<string, string> = {}): Promise<WebSocket> {
  const ws = new WebSocket(wsUrl(url), {
    headers: { ...headers, Authorization: auth },
  })
  await once(ws, 'open')
  return ws
}

async function closeSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) {
    return
  }
  const closed = once(ws, 'close')
  ws.close()
  await closed
}

async function readMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 WebSocket 消息超时')), 2000)
    timer.unref()
  })
  const [data] = await Promise.race([once(ws, 'message'), timeout])
  return JSON.parse(data.toString()) as Record<string, unknown>
}

async function readUnexpectedStatus(ws: WebSocket): Promise<number | undefined> {
  const [, response] = await once(ws, 'unexpected-response')
  response.resume()
  return response.statusCode
}

test('WebSocket Basic Auth 解析复用玩家校验', () => {
  seedPlayer(testPlayerID1)
  const request = { headers: { authorization: basicAuth() } } as IncomingMessage

  assert.equal(parseWebSocketAuth(request), testPlayerID1)
  assert.throws(() => parseWebSocketAuth({ headers: { authorization: basicAuth(testPlayerID1, 'wrong-pass') } } as IncomingMessage))
  assert.throws(() => parseWebSocketAuth({ headers: { authorization: 'Basic bad' } } as IncomingMessage))
})

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

  await closeSocket(ws1)
  await closeSocket(ws2)
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

  await closeSocket(ws1)
  await closeSocket(ws2)
  http.server.close()
})

test('订阅者与旧客户端广播目标去重', async () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)
  createGame(testGameID1, [testPlayerID1, testPlayerID2, testPlayerID3])
  const http = await startHttpServer(server.app)

  const ws1 = await openSocket(http.url, basicAuth(testPlayerID1))
  const ws2 = await openSocket(http.url, basicAuth(testPlayerID2))
  for (const ws of [ws1, ws2]) {
    ws.send(JSON.stringify({ type: 'join', gameIds: [testGameID1] }))
    await readMessage(ws)
  }

  ws1.send(JSON.stringify({ type: 'chat', gameId: testGameID1, civName: 'Rome', message: 'dedupe' }))
  assert.equal((await readMessage(ws1)).message, 'dedupe')
  assert.equal((await readMessage(ws2)).message, 'dedupe')

  await closeSocket(ws1)
  await closeSocket(ws2)
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

  await closeSocket(ws)
  http.server.close()
})

test('WebSocket 拒绝缺失和错误认证', async () => {
  seedPlayer(testPlayerID1)
  const http = await startHttpServer(server.app)

  try {
    const noAuth = new WebSocket(wsUrl(http.url))
    assert.equal(await readUnexpectedStatus(noAuth), 401)

    const wrongAuth = new WebSocket(wsUrl(http.url), {
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

  ws.send(JSON.stringify({ type: 'leave', gameIds: [testGameID1] }))
  ws.send(JSON.stringify({ type: 'join', gameIds: [testGameID1] }))
  await readMessage(ws)
  ws.send(JSON.stringify({ type: 'leave', gameIds: [testGameID1, 'invalid'] }))
  ws.send(JSON.stringify({ type: 'chat', gameId: testGameID1, civName: 'Rome', message: 'hello' }))
  assert.deepEqual(await readMessage(ws), { type: 'error', message: '未订阅此频道' })

  await closeSocket(ws)
  http.server.close()
})

test('未知消息、无频道 join 和未订阅在线状态会被忽略', async () => {
  seedPlayer(testPlayerID1)
  const http = await startHttpServer(server.app)
  const ws = await openSocket(http.url, basicAuth(), {
    'X-Forwarded-For': '::ffff:127.0.0.2, 10.0.0.1',
    'User-Agent': 'Unciv/4.0',
  })

  ws.send(JSON.stringify({ type: 'join' }))
  assert.deepEqual(await readMessage(ws), { type: 'joinSuccess', gameIds: [] })
  ws.send(JSON.stringify({ type: 'unknown' }))
  ws.send(JSON.stringify({ type: 'onlineQuery', gameId: 'invalid', civName: 'Rome' }))
  ws.send(JSON.stringify({ type: 'onlineResponse', gameId: testGameID1, civName: 'Rome' }))

  await closeSocket(ws)
  http.server.close()
})

test('非聊天路径的 WebSocket 升级会被拒绝', async () => {
  seedPlayer(testPlayerID1)
  const http = await startHttpServer(server.app)
  const ws = new WebSocket(wsUrl(http.url, '/not-chat'), {
    headers: { Authorization: basicAuth(), 'X-Real-IP': '127.0.0.9' },
  })

  await Promise.race([
    once(ws, 'error'),
    once(ws, 'close'),
  ])
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

  await closeSocket(ws1)
  await closeSocket(ws2)
  http.server.close()
})
