import { cleanupExpiredSessions } from './session.js'
import { runCleanup } from './database.js'

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
 * 启动数据和会话清理任务。
 */
export function startScheduler(): Scheduler {
  let cleanupTimer: NodeJS.Timeout
  let sessionTimer: NodeJS.Timeout

  const scheduleCleanup = () => {
    cleanupTimer = setTimeout(() => {
      try {
        runCleanup()
      } catch (error) {
        console.error('数据清理任务失败', error)
      }
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
