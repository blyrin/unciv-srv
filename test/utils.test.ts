import assert from 'node:assert/strict'
import { test } from 'bun:test'
import {
  createArchive, decodeFile, decodeHeaderValue, encodeFile, errorResponse, fileResponse, generateRandomStr, getBaseGameID,
  getClientIP, getPlayerIDsFromGameData, HttpError, isPreviewID, jsonResponse, parseBasicAuthCredentials, parseGameData,
  readLimitedText, successResponse, textResponse, validateGameID, validatePlayerID,
} from '../src/utils.js'
import { basicAuth, testGameID1, testPassword, testPlayerID1 } from './helpers/server.js'

function encodedBasicAuth(payload: string): string {
  return `Basic ${btoa(payload)}`
}

function requestWithHeaders(headers: HeadersInit): Request {
  return new Request('http://localhost', { headers })
}

test('存档编码可以往返解码', () => {
  const data = JSON.stringify({ gameId: testGameID1, turns: 3 })
  assert.equal(decodeFile(encodeFile(data)), data)
})

test('ID 校验符合接口格式', () => {
  assert.equal(validateGameID(testGameID1), true)
  assert.equal(validateGameID(`${testGameID1}_Preview`), true)
  assert.equal(validateGameID('invalid'), false)
  assert.equal(validatePlayerID(testPlayerID1), true)
  assert.equal(validatePlayerID(`${testPlayerID1}_Preview`), false)
})

test('预览 ID 工具处理后缀', () => {
  assert.equal(isPreviewID(`${testGameID1}_Preview`), true)
  assert.equal(getBaseGameID(`${testGameID1}_Preview`), testGameID1)
})

test('Basic Auth 解析玩家凭证', () => {
  const credentials = parseBasicAuthCredentials(basicAuth())
  assert.equal(credentials.playerId, testPlayerID1)
  assert.equal(credentials.password, testPassword)
})

test('响应工具返回约定状态码和响应头', async () => {
  const json = jsonResponse({ ok: true }, 201)
  assert.equal(json.status, 201)
  assert.equal(json.headers.get('Content-Type'), 'application/json;charset=utf-8')
  assert.equal(await json.text(), '{"ok":true}')

  const text = textResponse('ok')
  assert.equal(text.headers.get('Content-Type'), 'text/plain; charset=utf-8')
  assert.equal(await text.text(), 'ok')

  const error = errorResponse(400, '错误')
  assert.equal(error.status, 400)
  assert.deepEqual(await error.json(), { type: 'error', message: '错误' })

  assert.equal(successResponse().status, 204)

  const file = fileResponse('application/json', 'test.json', '{"a":1}')
  assert.equal(file.headers.get('Content-Type'), 'application/json')
  assert.equal(file.headers.get('Content-Disposition'), 'attachment; filename=test.json')
})

test('客户端 IP 按代理头优先级解析', () => {
  assert.equal(getClientIP(requestWithHeaders({ 'X-Forwarded-For': '1.1.1.1, 2.2.2.2' })), '1.1.1.1')
  assert.equal(getClientIP(requestWithHeaders({ 'X-Forwarded-For': '::ffff:1.1.1.1, 2.2.2.2' })), '1.1.1.1')
  assert.equal(getClientIP(requestWithHeaders({ 'X-Real-IP': '3.3.3.3' })), '3.3.3.3')
  assert.equal(getClientIP(new Request('http://localhost'), '::ffff:4.4.4.4'), '4.4.4.4')
})

test('请求头文本可恢复 UTF-8 乱码', () => {
  const raw = 'Unciv/4.20.8-patch1 (æ\x9E\x84å»ºå\x8F· 1221)-GNU-Terry-Pratchett'
  assert.equal(decodeHeaderValue(raw), 'Unciv/4.20.8-patch1 (构建号 1221)-GNU-Terry-Pratchett')
  assert.equal(decodeHeaderValue('Unciv'), 'Unciv')
  assert.equal(decodeHeaderValue('构建号'), '构建号')
})

test('存档解码错误和游戏数据解析覆盖失败路径', () => {
  assert.throws(() => decodeFile(''))
  assert.throws(() => decodeFile('not-base64-gzip'))
  assert.throws(() => decodeFile(btoa('plain')))
  assert.throws(() => parseGameData('{'))
  assert.throws(() => parseGameData(JSON.stringify({ gameId: testGameID1, turns: -1 })), /无效的回合数/)
  assert.throws(() => parseGameData(JSON.stringify({ gameId: testGameID1, turns: 1.5 })), /无效的回合数/)
})

test('存档缺省回合数时按初始回合处理', () => {
  assert.equal(parseGameData(JSON.stringify({ gameId: testGameID1 })).turns, 0)
})

test('玩家列表只提取人类玩家', () => {
  const data = JSON.stringify({
    gameId: testGameID1,
    turns: 1,
    gameParameters: {
      players: [
        { playerId: testPlayerID1, playerType: 'Human' },
        { playerId: 'ai', playerType: 'AI' },
        { playerType: 'Human' },
      ],
    },
  })
  assert.deepEqual(getPlayerIDsFromGameData(data), [testPlayerID1])
  assert.deepEqual(getPlayerIDsFromGameData(JSON.stringify({ gameId: testGameID1, turns: 1 })), [])
})

test('随机字符串和历史存档压缩包可用', () => {
  const random = generateRandomStr(20)
  assert.equal(random.length, 20)
  assert.match(random, /^[0-9a-f]+$/)

  const entries = [
    { name: 'a.json', data: '{"a":1}' },
    { name: 'b.json', data: '{"b":2}' },
  ]

  // 进程内生成的标准 zip：校验本地文件头签名与结束记录签名
  const archive = createArchive(entries)
  assert.equal(archive.extension, 'zip')
  assert.equal(archive.contentType, 'application/zip')
  assert.ok(archive.data.length > 0)
  assert.deepEqual(archive.data.slice(0, 4), new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
  assert.deepEqual(archive.data.slice(-22, -18), new Uint8Array([0x50, 0x4b, 0x05, 0x06]))
})

test('Basic Auth 错误格式返回约定消息', () => {
  assert.throws(() => parseBasicAuthCredentials(null), /需要认证/)
  assert.throws(() => parseBasicAuthCredentials('Bearer token'), /无效的认证格式/)
  assert.throws(() => parseBasicAuthCredentials('Basic !!!'), /无效的认证数据/)
  assert.throws(() => parseBasicAuthCredentials(encodedBasicAuth('bad-pair')), /无效的认证格式/)
  assert.throws(() => parseBasicAuthCredentials(encodedBasicAuth('bad-player:password123')), /无效的玩家ID格式/)
  assert.throws(() => parseBasicAuthCredentials(encodedBasicAuth(`${testPlayerID1}:short`)), /密码至少6位/)
})

test('受限请求体读取覆盖空体、成功和超限', async () => {
  assert.equal(await readLimitedText(new Request('http://localhost')), '')
  assert.equal(await readLimitedText(new Request('http://localhost', { method: 'POST', body: 'hello' }), 10), 'hello')
  await assert.rejects(
    readLimitedText(new Request('http://localhost', { method: 'POST', body: 'hello' }), 4),
    (error: unknown) => error instanceof HttpError && error.status === 413 && error.message === '请求体过大',
  )
})
