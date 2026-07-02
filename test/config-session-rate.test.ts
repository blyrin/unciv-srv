import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test, vi } from 'vitest'
import { loadConfig, loadEnvFile } from '../src/config.js'
import { RateLimiter } from '../src/rate-limit.js'
import {
  cleanupExpiredSessions, clearSessionCookieHeader, createSession, deleteSession, getSession, parseCookie, resetSessions,
  sessionCookieHeader, sessionCookieName,
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
  fs.writeFileSync(envFile, 'PORT=10000\nADMIN_USERNAME=from_file\nADMIN_PASSWORD="quoted"\n# comment\nBAD_LINE\n')
  process.env.PORT = 'already_set'

  loadEnvFile(envFile)

  assert.equal(process.env.PORT, 'already_set')
  assert.equal(process.env.ADMIN_USERNAME, 'from_file')
  assert.equal(process.env.ADMIN_PASSWORD, 'quoted')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('.env 文件不存在时保持环境变量不变', () => {
  process.env.PORT = '12345'
  const missingFile = path.join(os.tmpdir(), `unciv-env-missing-${Date.now()}`, '.env')

  loadEnvFile(missingFile)

  assert.equal(process.env.PORT, '12345')
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

test('Session 过期读取和批量清理符合约定', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  const expiredByRead = createSession('expired-read', false)
  const expiredByCleanup = createSession('expired-cleanup', true)

  vi.setSystemTime(new Date('2026-01-02T00:00:00.001Z'))
  assert.equal(getSession(expiredByRead), null)
  cleanupExpiredSessions()
  assert.equal(getSession(expiredByCleanup), null)
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

test('登录限流锁定过期后重新计数并清理旧记录', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  const limiter = new RateLimiter(2, 1)
  try {
    assert.equal(limiter.recordAttempt('locked'), false)
    assert.equal(limiter.recordAttempt('locked'), true)
    vi.setSystemTime(new Date('2026-01-01T00:01:00.001Z'))
    assert.equal(limiter.recordAttempt('locked'), false)
    assert.equal(limiter.getRemainingAttempts('locked'), 1)

    assert.equal(limiter.recordAttempt('stale'), false)
    vi.setSystemTime(new Date('2026-01-02T00:01:00.002Z'))
    vi.advanceTimersByTime(60 * 1000)
    assert.equal(limiter.getRemainingAttempts('stale'), 2)
  } finally {
    limiter.close()
  }
})
