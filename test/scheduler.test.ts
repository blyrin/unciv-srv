import assert from 'node:assert/strict'
import { afterEach, jest, mock, test } from 'bun:test'
import type { Config } from '../src/types.js'

// 用「包装真实模块 + 只替换被测函数」的方式打桩：mock.module 是进程级且不可恢复，
// 包装层对其他测试文件保持与真实模块一致的行为，避免相互影响。
const realDatabase = await import('../src/database.js')
const realSession = await import('../src/session.js')
const runCleanupSpy = mock(realDatabase.runCleanup)
const cleanupExpiredSessionsSpy = mock(realSession.cleanupExpiredSessions)
mock.module('../src/database.js', () => ({ ...realDatabase, runCleanup: runCleanupSpy }))
mock.module('../src/session.js', () => ({ ...realSession, cleanupExpiredSessions: cleanupExpiredSessionsSpy }))

const { startScheduler } = await import('../src/scheduler.js')

const oneSecondMs = 1000
const oneHourMs = 60 * 60 * 1000
const oneDayMs = 24 * oneHourMs
const testConfig = { archiveEnabled: true, archiveDir: '/tmp/unciv-srv-archive-test' } as Config

afterEach(async () => {
  runCleanupSpy.mockClear()
  cleanupExpiredSessionsSpy.mockClear()
})

test('调度器按下一整点和凌晨四点执行并可停止', () => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date(2026, 0, 1, 3, 59, 50))

  const scheduler = startScheduler(testConfig)
  jest.advanceTimersByTime(10 * oneSecondMs)

  assert.equal(cleanupExpiredSessionsSpy.mock.calls.length, 1)
  assert.equal(runCleanupSpy.mock.calls.length, 1)

  scheduler.stop()
  jest.advanceTimersByTime(oneHourMs)
  assert.equal(cleanupExpiredSessionsSpy.mock.calls.length, 1)
  assert.equal(runCleanupSpy.mock.calls.length, 1)
})

test('数据清理失败不会停止后续调度', () => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date(2026, 0, 1, 3, 59, 59))
  runCleanupSpy.mockImplementationOnce(() => {
    throw new Error('cleanup failed')
  })

  const scheduler = startScheduler(testConfig)
  jest.advanceTimersByTime(oneSecondMs)
  jest.advanceTimersByTime(oneDayMs)

  assert.equal(runCleanupSpy.mock.calls.length, 2)
  scheduler.stop()
})
