import { connect, sleep } from 'bun'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'bun:test'
import { notifyGameUpdated, parseWebSocketAuth } from '../src/chat.js'
import { createGame, createPlayer } from '../src/database.js'
import {
  basicAuth, buildGameData, seedPlayer, setupTestServer, startHttpServer, testGameID1, testPassword, testPlayerID1,
  testPlayerID2, testPlayerID3, type TestServer,
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

/** Bun 的 WebSocket 客户端支持自定义头，但类型只声明了子协议数组 */
function connectChat(url: string, headers: Record<string, string>): WebSocket {
  return new WebSocket(url, { headers } as unknown as string[])
}

function openSocket(url: string, auth = basicAuth(), headers: Record<string, string> = {}): Promise<WebSocket> {
  const ws = connectChat(wsUrl(url), { ...headers, Authorization: auth })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 WebSocket 连接超时')), 5000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve(ws)
    }, { once: true })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('WebSocket 连接失败'))
    }, { once: true })
  })
}

function closeSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000)
    ws.addEventListener('close', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
    ws.close()
  })
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 WebSocket 消息超时')), 2000)
    ws.addEventListener('message', (event) => {
      clearTimeout(timer)
      resolve(String((event as MessageEvent).data))
    }, { once: true })
  })
}

async function readMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return JSON.parse(await nextMessage(ws)) as Record<string, unknown>
}

/** 等待连接被拒绝（error 或 close） */
function waitForRejection(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000)
    for (const event of ['error', 'close']) {
      ws.addEventListener(event, () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    }
  })
}

/**
 * 直接发起 WebSocket 握手并返回服务器响应的 HTTP 状态码：
 * Bun 的 WebSocket 客户端拿不到非 101 响应的状态码，这里用裸 TCP 握手读取。
 */
async function upgradeStatus(url: string, path: string, headers: Record<string, string>): Promise<number> {
  let first = ''
  let notify: () => void = () => {}
  const arrived = new Promise<void>((resolve) => {
    notify = resolve
  })
  const socket = await connect({
    hostname: '127.0.0.1',
    port: Number(new URL(url).port),
    socket: {
      data(_socket, chunk) {
        if (!first) {
          first = new TextDecoder().decode(chunk)
          notify()
        }
      },
    },
  })
  const target = new URL(wsUrl(url, path))
  await socket.write([
    `GET ${target.pathname} HTTP/1.1`,
    `Host: ${target.host}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    '',
    '',
  ].join('\r\n'))
  await Promise.race([arrived, sleep(2000)])
  socket.end()
  const status = Number(/^HTTP\/1\.1 (\d+)/.exec(first)?.[1])
  return Number.isFinite(status) ? status : 0
}

test('WebSocket Basic Auth 解析复用玩家校验', () => {
  seedPlayer(testPlayerID1)

  assert.equal(parseWebSocketAuth(basicAuth()), testPlayerID1)
  assert.throws(() => parseWebSocketAuth(basicAuth(testPlayerID1, 'wrong-pass')))
  assert.throws(() => parseWebSocketAuth('Basic bad'))
})

test('WebSocket 订阅后广播聊天消息', async () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)
  const http = await startHttpServer(server)

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
  http.server.stop(true)
})

test('旧客户端未订阅时按游戏玩家广播', async () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)
  createGame(testGameID1, [testPlayerID1, testPlayerID2])
  const http = await startHttpServer(server)

  const ws1 = await openSocket(http.url, basicAuth(testPlayerID1))
  const ws2 = await openSocket(http.url, basicAuth(testPlayerID2))
  ws1.send(JSON.stringify({ type: 'chat', gameId: testGameID1, civName: 'Rome', message: 'legacy' }))
  assert.equal((await readMessage(ws1)).message, 'legacy')
  assert.equal((await readMessage(ws2)).message, 'legacy')

  await closeSocket(ws1)
  await closeSocket(ws2)
  http.server.stop(true)
})

test('订阅者与旧客户端广播目标去重', async () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)
  createGame(testGameID1, [testPlayerID1, testPlayerID2, testPlayerID3])
  const http = await startHttpServer(server)

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
  http.server.stop(true)
})

test('待审核玩家无法建立 WebSocket 连接', () => {
  createPlayer(testPlayerID3, testPassword, '127.0.0.1', false)

  assert.throws(() => parseWebSocketAuth(basicAuth(testPlayerID3)), /账号待审核/)
})

test('关闭聊天后拒绝聊天消息但仍推送游戏更新', async () => {
  const gated = setupTestServer({ chatEnabled: false })
  try {
    seedPlayer(testPlayerID1)
    const http = await startHttpServer(gated)
    const ws = await openSocket(http.url)
    ws.send(JSON.stringify({ type: 'join', gameIds: [testGameID1] }))
    assert.deepEqual(await readMessage(ws), { type: 'joinSuccess', gameIds: [testGameID1] })

    ws.send(JSON.stringify({ type: 'chat', gameId: testGameID1, civName: 'Rome', message: 'hello' }))
    assert.deepEqual(await readMessage(ws), { type: 'error', message: '聊天功能已关闭' })

    const updateMessage = nextMessage(ws)
    notifyGameUpdated(testGameID1)
    assert.deepEqual(JSON.parse(await updateMessage), { type: 'gameUpdated', gameId: testGameID1 })

    await closeSocket(ws)
    http.server.stop(true)
  } finally {
    gated.close()
  }
})

test('PUT 存档后向订阅者发送 gameUpdated', async () => {
  seedPlayer(testPlayerID1)
  const http = await startHttpServer(server)
  const ws = await openSocket(http.url)

  ws.send(JSON.stringify({ type: 'join', gameIds: [testGameID1] }))
  await readMessage(ws)

  const updateMessage = nextMessage(ws)
  const response = await fetch(`${http.url}/files/${testGameID1}`, {
    method: 'PUT',
    headers: {
      Authorization: basicAuth(),
      'User-Agent': 'Unciv',
    },
    body: buildGameData(testGameID1, 2, [testPlayerID1]),
  })
  assert.equal(response.status, 204)
  assert.deepEqual(JSON.parse(await updateMessage), { type: 'gameUpdated', gameId: testGameID1 })

  await closeSocket(ws)
  http.server.stop(true)
})

test('WebSocket 拒绝缺失和错误认证', async () => {
  seedPlayer(testPlayerID1)
  const http = await startHttpServer(server)
  try {
    assert.equal(await upgradeStatus(http.url, '/chat', {}), 401)
    assert.equal(await upgradeStatus(http.url, '/chat', { Authorization: basicAuth(testPlayerID1, 'wrong-pass') }), 401)
  } finally {
    http.server.stop(true)
  }
})

test('无效消息、未订阅聊天和 leave 返回预期错误', async () => {
  seedPlayer(testPlayerID1)
  const http = await startHttpServer(server)
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
  http.server.stop(true)
})

test('未知消息、无频道 join 和未订阅在线状态会被忽略', async () => {
  seedPlayer(testPlayerID1)
  const http = await startHttpServer(server)
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
  http.server.stop(true)
})

test('非聊天路径的 WebSocket 升级会被拒绝', async () => {
  seedPlayer(testPlayerID1)
  const http = await startHttpServer(server)
  const ws = connectChat(wsUrl(http.url, '/not-chat'), {
    Authorization: basicAuth(),
    'X-Real-IP': '127.0.0.9',
  })

  await waitForRejection(ws)
  http.server.stop(true)
})

test('在线状态消息只在订阅频道内转发', async () => {
  seedPlayer(testPlayerID1)
  seedPlayer(testPlayerID2)
  const http = await startHttpServer(server)
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
  http.server.stop(true)
})
