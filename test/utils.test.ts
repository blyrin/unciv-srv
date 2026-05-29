import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unzipSync } from 'fflate'
import {
  createZip, decodeFile, decodeHeaderValue, encodeFile, errorResponse, fileResponse, generateRandomStr, getBaseGameID,
  getClientIP, getPlayerIDsFromGameData, isPreviewID, jsonResponse, parseBasicAuthCredentials, parseGameData,
  successResponse, textResponse, validateGameID, validatePlayerID,
} from '../src/utils.js'
import { basicAuth, testGameID1, testPassword, testPlayerID1 } from './helpers.js'

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
  assert.equal(json.headers.get('Content-Type'), 'application/json; charset=utf-8')
  assert.equal(await json.text(), '{"ok":true}\n')

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
  assert.equal(getClientIP(new Request('http://localhost', { headers: { 'X-Forwarded-For': '1.1.1.1, 2.2.2.2' } })), '1.1.1.1')
  assert.equal(getClientIP(new Request('http://localhost', { headers: { 'X-Forwarded-For': '::ffff:1.1.1.1, 2.2.2.2' } })), '1.1.1.1')
  assert.equal(getClientIP(new Request('http://localhost', { headers: { 'X-Real-IP': '3.3.3.3' } })), '3.3.3.3')
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
  assert.throws(() => decodeFile(Buffer.from('plain').toString('base64')))
  assert.throws(() => parseGameData('{'))
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

test('随机字符串和 ZIP 生成可用', () => {
  const random = generateRandomStr(20)
  assert.equal(random.length, 20)
  assert.match(random, /^[A-Za-z0-9]+$/)

  const zip = unzipSync(createZip([
    { name: 'a.json', data: '{"a":1}' },
    { name: 'b.json', data: '{"b":2}' },
  ]))
  assert.equal(Buffer.from(zip['a.json']!).toString('utf8'), '{"a":1}')
  assert.equal(Buffer.from(zip['b.json']!).toString('utf8'), '{"b":2}')
})

test('Basic Auth 错误格式返回约定消息', () => {
  assert.throws(() => parseBasicAuthCredentials(null), /需要认证/)
  assert.throws(() => parseBasicAuthCredentials('Bearer token'), /无效的认证格式/)
  assert.throws(() => parseBasicAuthCredentials('Basic !!!'), /无效的认证数据/)
  assert.throws(() => parseBasicAuthCredentials(`Basic ${Buffer.from('bad-pair').toString('base64')}`), /无效的认证格式/)
  assert.throws(() => parseBasicAuthCredentials(`Basic ${Buffer.from(`${testPlayerID1}:short`).toString('base64')}`), /密码至少6位/)
})
