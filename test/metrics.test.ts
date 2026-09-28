import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'vitest'
import { closeDatabase } from '../src/database.js'
import { resetMetrics } from '../src/metrics.js'
import { createSession } from '../src/session.js'
import { setupTestServer, type TestServer } from './helpers/server.js'

let server: TestServer

beforeEach(() => {
  resetMetrics()
  server = setupTestServer()
})

afterEach(() => {
  server.close()
})

test('/metrics 以 Prometheus 文本格式暴露进程与应用指标', async () => {
  createSession('metrics-user', false)

  const response = await server.app.request('/metrics')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /^text\/plain; version=0\.0\.4/)
  const body = await response.text()
  for (const name of [
    'process_uptime_seconds',
    'process_resident_memory_bytes',
    'nodejs_heap_used_bytes',
    'nodejs_heap_total_bytes',
    'unciv_http_requests_total',
    'unciv_active_sessions',
    'unciv_chat_messages_total',
  ]) {
    assert.match(body, new RegExp(`^# TYPE ${name} (counter|gauge)$`, 'm'))
    assert.match(body, new RegExp(`^${name} -?\\d+(\\.\\d+)?$`, 'm'))
  }
  assert.match(body, /^unciv_active_sessions 1$/m)
})

test('/ready 在数据库可用时返回 200，不可用时返回 503', async () => {
  const healthy = await server.app.request('/ready')
  assert.equal(healthy.status, 200)
  assert.deepEqual(await healthy.json(), { ready: true })

  closeDatabase()

  const unhealthy = await server.app.request('/ready')
  assert.equal(unhealthy.status, 503)
  assert.deepEqual(await unhealthy.json(), { ready: false })
})

test('全局中间件累计 HTTP 请求数', async () => {
  const before = await (await server.app.request('/metrics')).text()
  const beforeCount = Number(/^unciv_http_requests_total (\d+)$/m.exec(before)?.[1])
  await server.app.request('/isalive')
  const after = await (await server.app.request('/metrics')).text()
  const afterCount = Number(/^unciv_http_requests_total (\d+)$/m.exec(after)?.[1])
  assert.equal(afterCount > beforeCount, true)
})
