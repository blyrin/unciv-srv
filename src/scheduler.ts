import { cleanupFlag } from './config.js'
import { cleanupExpiredSessions } from './session.js'

export interface Scheduler {
  stop: () => void
}

/**
 * 计算下一整点前的毫秒数。
 */
function millisUntilNextHour(now = new Date()): number {
  const next = new Date(now)
  next.setHours(now.getHours() + 1, 0, 0, 0)
  return next.getTime() - now.getTime()
}

/**
 * 计算下一次凌晨四点前的毫秒数。
 */
function millisUntilNextFourAM(now = new Date()): number {
  const next = new Date(now)
  next.setHours(4, 0, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next.getTime() - now.getTime()
}

/**
 * 在独立进程里执行一次数据清理。
 */
function runCleanupInSubprocess(): void {
  const entry = process.argv[1]
  if (!entry) {
    console.error('无法确定入口脚本路径，跳过本次数据清理')
    return
  }
  const child = Bun.spawn({
    cmd: [process.execPath, entry, cleanupFlag],
    stdout: 'inherit',
    stderr: 'inherit',
  })
  void child.exited.then((code) => {
    if (code !== 0) {
      console.error('数据清理子进程失败', { code })
    }
  })
}

/**
 * 启动数据和会话清理任务。
 */
export function startScheduler(): Scheduler {
  let cleanupTimer: ReturnType<typeof setTimeout>
  let sessionTimer: ReturnType<typeof setTimeout>

  const scheduleCleanup = () => {
    cleanupTimer = setTimeout(() => {
      runCleanupInSubprocess()
      scheduleCleanup()
    }, millisUntilNextFourAM())
    cleanupTimer.unref()
  }

  const scheduleSessionCleanup = () => {
    sessionTimer = setTimeout(() => {
      cleanupExpiredSessions()
      scheduleSessionCleanup()
    }, millisUntilNextHour())
    sessionTimer.unref()
  }

  scheduleCleanup()
  scheduleSessionCleanup()
  console.info('定时任务调度器已启动')

  return {
    stop: () => {
      clearTimeout(cleanupTimer)
      clearTimeout(sessionTimer)
      console.info('定时任务调度器已停止')
    },
  }
}
