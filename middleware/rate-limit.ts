const MAX_ATTEMPTS = +(process.env.MAX_ATTEMPTS || 5)
const LOCK_TIME = +(process.env.LOCK_TIME || 5) * 60 * 1000

const loginAttempts = new Map<string, { attempts: number; lockUntil: number; lastAccess: number }>()

function cleanupOldRecords() {
  const now = Date.now()
  const expiryTime = now - LOCK_TIME
  for (const [ip, record] of loginAttempts.entries()) {
    if (record.lockUntil < now && record.lastAccess < expiryTime) {
      loginAttempts.delete(ip)
    }
  }
}

export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/login')) {
    return
  }
  if (Math.random() < 0.01) {
    cleanupOldRecords()
  }
  const ip = event.context.ip
  let record = loginAttempts.get(ip)
  const now = Date.now()
  if (record && record.lockUntil > now) {
    throw createError({ statusCode: 429, message: '请求次数过多，请稍后再试' })
  }
  if (!record || (record.lockUntil && record.lockUntil < now)) {
    record = { attempts: 0, lockUntil: 0, lastAccess: now }
  }
  record.attempts++
  record.lastAccess = now
  if (record.attempts >= MAX_ATTEMPTS) {
    record.lockUntil = now + LOCK_TIME
  }
  loginAttempts.set(ip, record)
})
