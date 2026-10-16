import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, jest, mock, spyOn, test } from 'bun:test'

// 用「包装真实模块 + 只替换被测函数」的方式打桩：mock.module 是进程级且不可恢复，
// 包装层对其他测试文件保持与真实模块一致的行为，避免相互影响。
const realSession = await import('../src/session.js')
const cleanupExpiredSessionsSpy = mock(realSession.cleanupExpiredSessions)
mock.module('../src/session.js', () => ({ ...realSession, cleanupExpiredSessions: cleanupExpiredSessionsSpy }))

const { startScheduler } = await import('../src/scheduler.js')
const { cleanupFlag } = await import('../src/config.js')

const oneSecondMs = 1000
const oneHourMs = 60 * 60 * 1000
const oneDayMs = 24 * oneHourMs

let spawnCommands: string[][]
let cleanupExitCode: number
let spawnSpy: ReturnType<typeof spyOn>
let errorSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  spawnCommands = []
  cleanupExitCode = 0
  spawnSpy = spyOn(Bun, 'spawn').mockImplementation(((options: { cmd: string[] }) => {
    spawnCommands.push(options.cmd)
    return { exited: Promise.resolve(cleanupExitCode), pid: 0 }
  }) as never)
  errorSpy = spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  spawnSpy.mockRestore()
  errorSpy.mockRestore()
  cleanupExpiredSessionsSpy.mockClear()
})

test('调度器按下一整点和凌晨四点执行并可停止', () => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date(2026, 0, 1, 3, 59, 50))

  const scheduler = startScheduler()
  jest.advanceTimersByTime(10 * oneSecondMs)

  assert.equal(cleanupExpiredSessionsSpy.mock.calls.length, 1)
  // 数据清理在独立进程里跑，父进程只负责拉起子进程，不被归档写盘和 VACUUM 堵住
  assert.equal(spawnCommands.length, 1)
  assert.deepEqual(spawnCommands[0], [process.execPath, process.argv[1], cleanupFlag])

  scheduler.stop()
  jest.advanceTimersByTime(oneHourMs)
  assert.equal(cleanupExpiredSessionsSpy.mock.calls.length, 1)
  assert.equal(spawnCommands.length, 1)
  jest.useRealTimers()
})

test('清理子进程失败不会停止后续调度', async () => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date(2026, 0, 1, 3, 59, 59))
  cleanupExitCode = 1

  const scheduler = startScheduler()
  jest.advanceTimersByTime(oneSecondMs)
  assert.equal(spawnCommands.length, 1)
  // 退出码经已 resolve 的 promise 回来，需要一次微任务才能落到 console.error
  await Promise.resolve()
  assert.equal(errorSpy.mock.calls.length, 1)

  jest.advanceTimersByTime(oneDayMs)
  assert.equal(spawnCommands.length, 2)
  scheduler.stop()
  jest.useRealTimers()
})

test('--cleanup 入口能在独立进程里完成一次清理后退出', async () => {
  // 这个用例要跑真实子进程，先撤掉前两个用例对 Bun.spawn 的打桩
  spawnSpy.mockRestore()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unciv-srv-cleanup-'))
  const child = Bun.spawn({
    cmd: [process.execPath, path.join(import.meta.dir, '..', 'src', 'main.ts'), cleanupFlag],
    env: { ...process.env, DB_PATH: path.join(dir, 'cleanup.db') },
    stdout: 'ignore',
    stderr: 'ignore',
  })
  try {
    assert.equal(await child.exited, 0)
    assert.ok(fs.existsSync(path.join(dir, 'cleanup.db')))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
