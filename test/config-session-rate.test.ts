import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { loadConfig, loadEnvFile } from '../src/config.js'
import { RateLimiter } from '../src/rate-limit.js'
import {
  clearSessionCookieHeader, createSession, deleteSession, getSession, parseCookie, resetSessions, sessionCookieHeader,
  sessionCookieName,
} from '../src/session.js'

const savedEnv = { ...process.env }

afterEach(() => {
  process.env = { ...savedEnv }
  resetSessions()
})

test('配置默认值和环境变量覆盖符合约定', () => {
  delete process.env.PORT
  delete process.env.DB_PATH
  delete process.env.ADMIN_USERNAME
  delete process.env.ADMIN_PASSWORD
  delete process.env.MAX_ATTEMPTS
  delete process.env.LOCK_TIME

  const defaults = loadConfig()
  assert.equal(defaults.port, '11451')
  assert.equal(defaults.dbPath.endsWith(path.join('data', 'unciv-srv.db')), true)
  assert.equal(defaults.adminUsername, 'admin')
  assert.equal(defaults.adminPassword, 'admin123')
  assert.equal(defaults.maxAttempts, 5)
  assert.equal(defaults.lockTime, 5)

  process.env.PORT = '18080'
  process.env.DB_PATH = '/tmp/custom.db'
  process.env.ADMIN_USERNAME = 'root'
  process.env.ADMIN_PASSWORD = 'secret'
  process.env.MAX_ATTEMPTS = '7'
  process.env.LOCK_TIME = '9'
  const overridden = loadConfig()
  assert.equal(overridden.port, '18080')
  assert.equal(overridden.dbPath, '/tmp/custom.db')
  assert.equal(overridden.adminUsername, 'root')
  assert.equal(overridden.adminPassword, 'secret')
  assert.equal(overridden.maxAttempts, 7)
  assert.equal(overridden.lockTime, 9)
})

test('.env 文件只填充未设置的环境变量', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unciv-env-'))
  const envFile = path.join(dir, '.env')
  fs.writeFileSync(envFile, 'PORT=10000\nADMIN_USERNAME=from_file\nADMIN_PASSWORD=\"quoted\"\n# comment\nBAD_LINE\n')
  process.env.PORT = 'already_set'

  loadEnvFile(envFile)

  assert.equal(process.env.PORT, 'already_set')
  assert.equal(process.env.ADMIN_USERNAME, 'from_file')
  assert.equal(process.env.ADMIN_PASSWORD, 'quoted')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('Session 创建、读取、删除和 Cookie 头符合接口约定', () => {
  const sessionId = createSession('user1', false)
  const session = getSession(sessionId)
  assert.equal(session?.userId, 'user1')
  assert.equal(session?.isAdmin, false)

  const cookie = sessionCookieHeader(sessionId)
  assert.equal(cookie.includes(`${sessionCookieName}=${sessionId}`), true)
  assert.equal(cookie.includes('HttpOnly'), true)
  assert.equal(cookie.includes('SameSite=Lax'), true)
  assert.equal(parseCookie(`a=1; ${sessionCookieName}=${sessionId}`)[sessionCookieName], sessionId)

  deleteSession(sessionId)
  assert.equal(getSession(sessionId), null)
  assert.equal(clearSessionCookieHeader().includes('Max-Age=0'), true)
})

test('登录限流记录失败、锁定和重置', () => {
  const limiter = new RateLimiter(2, 5)
  try {
    assert.equal(limiter.isLocked('127.0.0.1'), false)
    assert.equal(limiter.recordAttempt('127.0.0.1'), false)
    assert.equal(limiter.getRemainingAttempts('127.0.0.1'), 1)
    assert.equal(limiter.recordAttempt('127.0.0.1'), true)
    assert.equal(limiter.isLocked('127.0.0.1'), true)
    assert.match(limiter.getLockRemainingText('127.0.0.1'), /^\d+s$/)
    limiter.resetAttempts('127.0.0.1')
    assert.equal(limiter.isLocked('127.0.0.1'), false)
  } finally {
    limiter.close()
  }
})
