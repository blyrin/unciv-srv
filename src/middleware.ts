import type { Context, MiddlewareHandler } from 'hono'
import type { AppVariables } from './types.js'
import { createPlayer, getPlayerByID, updatePlayerLastActive } from './database.js'
import { clearSessionCookieHeader, getSession, parseCookie, sessionCookieName } from './session.js'
import {
  decodeHeaderValue, errorResponse, getBaseGameID, getClientIP, HttpError, isPreviewID, parseBasicAuthCredentials,
  validateGameID, validatePlayerID,
} from './utils.js'
import type { RateLimiter } from './rate-limit.js'

type Env = { Variables: AppVariables }

/**
 * 记录 HTTP 请求日志。
 */
export function logger(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const start = performance.now()
    try {
      await next()
    } finally {
      const duration = performance.now() - start
      console.info('HTTP', {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration: `${duration.toFixed(2)}ms`,
        ip: getClientIP(c),
        ua: decodeHeaderValue(c.req.header('User-Agent') ?? ''),
      })
    }
  }
}

/**
 * 验证已存在玩家的凭证。
 */
export function validatePlayer(playerId: string, password: string): string | null {
  if (!validatePlayerID(playerId)) {
    throw new Error('无效的玩家ID格式')
  }
  const player = getPlayerByID(playerId)
  return player?.password === password ? playerId : null
}

/**
 * 创建 Basic Auth 中间件。
 */
function basicAuth(allowRegister: boolean): MiddlewareHandler<Env> {
  return async (c, next) => {
    let credentials
    try {
      credentials = parseBasicAuthCredentials(c.req.header('Authorization'))
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(error.status, error.message)
      }
      return errorResponse(401, '需要认证')
    }

    const ip = getClientIP(c)
    const player = getPlayerByID(credentials.playerId)
    if (!player) {
      if (!allowRegister) {
        return errorResponse(401, '玩家不存在')
      }
      createPlayer(credentials.playerId, credentials.password, ip)
    } else {
      if (player.password !== credentials.password) {
        return errorResponse(401, '密码错误')
      }
      try {
        updatePlayerLastActive(credentials.playerId, ip)
      } catch (error) {
        console.error('更新最后活跃时间失败', error)
      }
    }

    c.set('playerId', credentials.playerId)
    await next()
  }
}

/**
 * 读取登录会话并写入请求上下文。
 */
function setSessionContext(c: Context<Env>): Response | null {
  const cookies = parseCookie(c.req.header('Cookie'))
  const sessionId = cookies[sessionCookieName]
  if (!sessionId) {
    return errorResponse(401, '未登录')
  }

  const session = getSession(sessionId)
  if (!session) {
    const response = errorResponse(401, '会话已过期')
    response.headers.append('Set-Cookie', clearSessionCookieHeader())
    return response
  }

  c.set('sessionUserId', session.userId)
  c.set('sessionIsAdmin', session.isAdmin)
  return null
}

/**
 * 验证 Basic Auth 并允许自动注册玩家。
 */
export function basicAuthWithRegister(): MiddlewareHandler<Env> {
  return basicAuth(true)
}

/**
 * 验证 Basic Auth 但不自动注册。
 */
export function basicAuthOnly(): MiddlewareHandler<Env> {
  return basicAuth(false)
}

/**
 * 验证 Unciv 文件接口的游戏 ID 和客户端标识。
 */
export function validateGameIDMiddleware(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const userAgent = decodeHeaderValue(c.req.header('User-Agent') ?? '')
    if (!userAgent.startsWith('Unciv')) {
      return errorResponse(403, '非法客户端')
    }

    const rawGameId = c.req.param('gameId')
    if (!rawGameId) {
      return errorResponse(400, '缺少游戏ID')
    }
    if (!validateGameID(rawGameId)) {
      return errorResponse(400, '无效的游戏ID格式')
    }

    c.set('gameId', getBaseGameID(rawGameId))
    c.set('isPreview', isPreviewID(rawGameId))
    await next()
  }
}

/**
 * 验证 Web 管理端登录会话。
 */
export function sessionAuth(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const response = setSessionContext(c)
    if (response) {
      return response
    }
    await next()
  }
}

/**
 * 验证管理员会话。
 */
export function adminOnly(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const response = setSessionContext(c)
    if (response) {
      return response
    }
    if (!c.get('sessionIsAdmin')) {
      return errorResponse(403, '需要管理员权限')
    }
    await next()
  }
}

/**
 * 检查登录限流状态。
 */
export function rateLimit(limiter: RateLimiter): MiddlewareHandler<Env> {
  return async (c, next) => {
    const ip = getClientIP(c)
    if (limiter.isLocked(ip)) {
      return errorResponse(429, `请求过于频繁，请稍后再试 (${limiter.getLockRemainingText(ip)})`)
    }
    await next()
  }
}
