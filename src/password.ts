import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** 哈希前缀，用来区分加密存储的密码与旧库中的明文密码 */
const hashPrefix = 'scrypt$'
const logN = 15
const blockSize = 8
const parallelization = 1
const keyLength = 64
const saltLength = 16
/** scrypt 需要的内存 = 128 * N * r，留出余量避免超出 Node 默认 maxmem */
const maxmem = 128 * 1024 * 1024

const N = 2 ** logN

/** 校验成功的缓存时间：客户端每个请求都带 Basic Auth，缓存避免反复做 scrypt */
const positiveTtlMs = 5 * 60 * 1000
/** 校验失败的缓存时间：同样避免用错误密码刷 CPU */
const negativeTtlMs = 15 * 1000
const maxCacheSize = 4096

interface VerifyCacheEntry {
  /** 入库的哈希值：密码被重置后与缓存不一致，自动失效 */
  stored: string
  ok: boolean
  expiresAt: number
}

const verifyCache = new Map<string, VerifyCacheEntry>()

/**
 * 生成密码哈希，格式：scrypt$N$r$p$盐(Base64)$哈希(Base64)。
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(saltLength)
  const hash = scryptSync(password, salt, keyLength, { N, r: blockSize, p: parallelization, maxmem })
  return `${hashPrefix}${N}$${blockSize}$${parallelization}$${salt.toString('base64')}$${hash.toString('base64')}`
}

/**
 * 判断密码字段是否已是哈希形式。
 */
export function isHashedPassword(stored: string): boolean {
  return stored.startsWith(hashPrefix)
}

/**
 * 校验密码。
 * 哈希形式用定时安全比较；旧库中的明文密码仍按明文比较，由启动迁移替换为哈希。
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (stored === '') {
    return false
  }
  if (!isHashedPassword(stored)) {
    return stored === password
  }

  const parts = stored.split('$')
  if (parts.length !== 6) {
    return false
  }
  const storedN = Number.parseInt(parts[1], 10)
  const storedR = Number.parseInt(parts[2], 10)
  const storedP = Number.parseInt(parts[3], 10)
  if (!Number.isFinite(storedN) || !Number.isFinite(storedR) || !Number.isFinite(storedP)) {
    return false
  }
  // 限制参数范围，避免被篡改的数据库行触发超大内存分配
  if (storedN < 1024 || storedN > 2 ** 20 || (storedN & (storedN - 1)) !== 0) {
    return false
  }
  if (storedR < 1 || storedR > 32 || storedP < 1 || storedP > 8) {
    return false
  }

  const salt = Buffer.from(parts[4], 'base64')
  const expected = Buffer.from(parts[5], 'base64')
  if (salt.length === 0 || expected.length === 0) {
    return false
  }

  const actual = scryptSync(password, salt, expected.length, {
    N: storedN,
    r: storedR,
    p: storedP,
    maxmem: Math.max(maxmem, 128 * storedN * storedR),
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/**
 * 带缓存的密码校验：同一密码在缓存有效期内只做一次 scrypt。
 */
export function verifyPasswordCached(playerId: string, password: string, stored: string): boolean {
  const key = `${playerId}:${createHash('sha256').update(password).digest('base64')}`
  const now = Date.now()
  const cached = verifyCache.get(key)
  if (cached != null && cached.stored === stored && cached.expiresAt > now) {
    return cached.ok
  }

  const ok = verifyPassword(password, stored)
  if (verifyCache.size >= maxCacheSize) {
    // 容量控制从简：整体清空即可，缓存本身随时可重建
    verifyCache.clear()
  }
  verifyCache.set(key, { stored, ok, expiresAt: now + (ok ? positiveTtlMs : negativeTtlMs) })
  return ok
}

/**
 * 清空密码校验缓存（测试与管理员批量操作后使用）。
 */
export function clearPasswordCache(): void {
  verifyCache.clear()
}
