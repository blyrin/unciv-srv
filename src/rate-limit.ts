interface AttemptInfo {
  count: number
  firstAt: number
  lockedAt: number
}

/**
 * 保存登录失败次数并按 IP 锁定。
 */
export class RateLimiter {
  private readonly attempts = new Map<string, AttemptInfo>()
  private readonly lockTimeMs: number
  private readonly timer: NodeJS.Timeout

  constructor(
    private readonly maxAttempts: number,
    lockTimeMinutes: number,
  ) {
    this.lockTimeMs = lockTimeMinutes * 60 * 1000
    this.timer = setInterval(() => this.pruneAttempts(), 60 * 1000)
    this.timer.unref()
  }

  /**
   * 停止清理定时器。
   */
  close(): void {
    clearInterval(this.timer)
  }

  /**
   * 判断 IP 是否仍处于锁定期。
   */
  isLocked(ip: string): boolean {
    const info = this.attempts.get(ip)
    if (!info || info.lockedAt === 0) {
      return false
    }
    return Date.now() - info.lockedAt < this.lockTimeMs
  }

  /**
   * 记录一次失败尝试，返回是否触发锁定。
   */
  recordAttempt(ip: string): boolean {
    const now = Date.now()
    const info = this.attempts.get(ip)
    if (!info) {
      this.attempts.set(ip, { count: 1, firstAt: now, lockedAt: 0 })
      return false
    }

    if (info.lockedAt !== 0 && now - info.lockedAt >= this.lockTimeMs) {
      info.count = 1
      info.firstAt = now
      info.lockedAt = 0
      return false
    }

    info.count += 1
    if (info.count >= this.maxAttempts) {
      info.lockedAt = now
      return true
    }
    return false
  }

  /**
   * 清除 IP 的失败记录。
   */
  resetAttempts(ip: string): void {
    this.attempts.delete(ip)
  }

  /**
   * 获取剩余可尝试次数。
   */
  getRemainingAttempts(ip: string): number {
    return Math.max(this.maxAttempts - (this.attempts.get(ip)?.count ?? 0), 0)
  }

  /**
   * 获取剩余锁定时间文本。
   */
  getLockRemainingText(ip: string): string {
    const info = this.attempts.get(ip)
    if (!info || info.lockedAt === 0) {
      return '0s'
    }
    const remaining = Math.max(this.lockTimeMs - (Date.now() - info.lockedAt), 0)
    return `${Math.round(remaining / 1000)}s`
  }

  /**
   * 清理过期的失败记录。
   */
  private pruneAttempts(): void {
    const now = Date.now()
    for (const [ip, info] of this.attempts) {
      const expired = info.lockedAt === 0
        ? now - info.firstAt > 24 * 60 * 60 * 1000
        : now - info.lockedAt > this.lockTimeMs
      if (expired) {
        this.attempts.delete(ip)
      }
    }
  }
}
