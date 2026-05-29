import { generateRandomStr } from './utils.js'

export const sessionCookieName = 'session_id'
export const sessionDurationMs = 24 * 60 * 60 * 1000

export interface Session {
  id: string
  userId: string
  isAdmin: boolean
  createdAt: number
  expiresAt: number
}

const sessions = new Map<string, Session>()

export function createSession(userId: string, isAdmin: boolean): string {
  const id = generateRandomStr(20)
  const now = Date.now()
  sessions.set(id, {
    id,
    userId,
    isAdmin,
    createdAt: now,
    expiresAt: now + sessionDurationMs,
  })
  return id
}

/**
 * 获取未过期的会话。
 */
export function getSession(id: string): Session | null {
  const session = sessions.get(id)
  if (!session) {
    return null
  }
  if (Date.now() > session.expiresAt) {
    sessions.delete(id)
    return null
  }
  return session
}

/**
 * 删除指定会话。
 */
export function deleteSession(id: string): void {
  sessions.delete(id)
}

/**
 * 清理过期会话。
 */
export function cleanupExpiredSessions(): void {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(id)
    }
  }
}

/**
 * 清空会话，供测试隔离使用。
 */
export function resetSessions(): void {
  sessions.clear()
}

/**
 * 解析 Cookie 头。
 */
export function parseCookie(header: string | null | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!header) {
    return result
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) {
      continue
    }
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key) {
      result[key] = value
    }
  }
  return result
}

/**
 * 生成登录会话 Cookie。
 */
export function sessionCookieHeader(sessionId: string): string {
  return `${sessionCookieName}=${sessionId}; Path=/; Max-Age=${Math.floor(sessionDurationMs / 1000)}; HttpOnly; SameSite=Lax`
}

/**
 * 生成清除会话 Cookie。
 */
export function clearSessionCookieHeader(): string {
  return `${sessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
}
