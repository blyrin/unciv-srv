import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'

vi.mock('../src/database.js', () => ({
  runCleanup: vi.fn(),
}))

vi.mock('../src/session.js', () => ({
  cleanupExpiredSessions: vi.fn(),
}))

const { startScheduler } = await import('../src/scheduler.js')
const { runCleanup } = await import('../src/database.js')
const { cleanupExpiredSessions } = await import('../src/session.js')

const runCleanupMock = vi.mocked(runCleanup)
const cleanupExpiredSessionsMock = vi.mocked(cleanupExpiredSessions)
const oneSecondMs = 1000
const oneHourMs = 60 * 60 * 1000
const oneDayMs = 24 * oneHourMs

afterEach(() => {
  runCleanupMock.mockReset()
  cleanupExpiredSessionsMock.mockReset()
})

test('调度器按下一整点和凌晨四点执行并可停止', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 0, 1, 3, 59, 50))

  const scheduler = startScheduler()
  vi.advanceTimersByTime(10 * oneSecondMs)

  assert.equal(cleanupExpiredSessionsMock.mock.calls.length, 1)
  assert.equal(runCleanupMock.mock.calls.length, 1)

  scheduler.stop()
  vi.advanceTimersByTime(oneHourMs)
  assert.equal(cleanupExpiredSessionsMock.mock.calls.length, 1)
  assert.equal(runCleanupMock.mock.calls.length, 1)
})

test('数据清理失败不会停止后续调度', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 0, 1, 3, 59, 59))
  runCleanupMock.mockImplementationOnce(() => {
    throw new Error('cleanup failed')
  })

  const scheduler = startScheduler()
  vi.advanceTimersByTime(oneSecondMs)
  vi.advanceTimersByTime(oneDayMs)

  assert.equal(runCleanupMock.mock.calls.length, 2)
  scheduler.stop()
})
