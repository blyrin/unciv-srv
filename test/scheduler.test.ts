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

afterEach(() => {
  vi.mocked(runCleanup).mockReset()
  vi.mocked(cleanupExpiredSessions).mockReset()
})

test('调度器按下一整点和凌晨四点执行并可停止', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 0, 1, 3, 59, 50))

  const scheduler = startScheduler()
  vi.advanceTimersByTime(10_000)

  assert.equal(vi.mocked(cleanupExpiredSessions).mock.calls.length, 1)
  assert.equal(vi.mocked(runCleanup).mock.calls.length, 1)

  scheduler.stop()
  vi.advanceTimersByTime(60 * 60 * 1000)
  assert.equal(vi.mocked(cleanupExpiredSessions).mock.calls.length, 1)
  assert.equal(vi.mocked(runCleanup).mock.calls.length, 1)
})

test('数据清理失败不会停止后续调度', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 0, 1, 3, 59, 59))
  vi.mocked(runCleanup).mockImplementationOnce(() => {
    throw new Error('cleanup failed')
  })

  const scheduler = startScheduler()
  vi.advanceTimersByTime(1_000)
  vi.advanceTimersByTime(24 * 60 * 60 * 1000)

  assert.equal(vi.mocked(runCleanup).mock.calls.length, 2)
  scheduler.stop()
})
