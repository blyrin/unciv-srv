import type { Context, MiddlewareHandler } from 'hono'
import type { AppVariables, Config, RegisterMode } from './types.js'
import {
  createPlayer, getArchivedGameRecord, getPlayerByID, requestArchivedGameRestore, updatePlayerLastActive,
} from './database.js'
import { verifyPasswordCached } from './password.js'
import { ipForLog } from './privacy.js'
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
        ip: ipForLog(getClientIP(c)),
        ua: decodeHeaderValue(c.req.header('User-Agent') ?? ''),
      })
    }
  }
}

/**
 * 冷存档提示：对局被归档后数据库里已经没有记录，如果按普通的不存在处理，
 * 客户端只会显示「File could not be found on the multiplayer server」。
 * 这里回 503 与纯文本说明（客户端会把纯文本原样当作错误消息展示给玩家），
 * 并登记一次恢复请求；预览请求（客户端定时刷新会用到）不登记，避免产生大量请求。
 */
export function coldArchiveNotice(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const rawGameId = c.req.param('gameId')
    if (rawGameId == null || rawGameId === '') {
      await next()
      return
    }
    const gameId = getBaseGameID(rawGameId)
    const archived = getArchivedGameRecord(gameId)
    if (archived == null) {
      await next()
      return
    }
    if (!isPreviewID(rawGameId)) {
      requestArchivedGameRestore(gameId, c.get('playerId'))
    }
    const detail = archived.archiveFile === ''
      ? '该对局没有保存过存档内容，无法恢复。'
      : '存档保存在加密网盘中，管理员取回后即可继续游戏，通常需要几分钟到半小时。'
    const detailEn = archived.archiveFile === ''
      ? 'This game never had a save file uploaded, so it cannot be restored.'
      : 'The save file is in encrypted cloud storage; an admin has to restore it, which usually takes minutes to half an hour.'
    return c.text(
      `该对局已被冷归档（服务器存档总量超过上限后，按最久未使用的顺序归档）。\n` +
      `${detail}\n` +
      `请稍后重试；如果长时间没有恢复，请在社区群提醒管理员。\n` +
      `[EN] This game was cold-archived (oldest saves are archived when the server runs out of space).\n` +
      `${detailEn}\n` +
      `Please retry later, and remind the admins in the community group if it stays unavailable.`,
      503,
      { 'Retry-After': '600' },
    )
  }
}

/**
 * 待审核账号的提示信息。
 */
export const pendingApprovalMessage = '账号待审核，请联系管理员开通'

/**
 * 玩家认证结果。
 */
export type PlayerAuthResult =
  | { type: 'ok'; playerId: string }
  | { type: 'pending' }
  | { type: 'invalid' }

/**
 * 验证已存在玩家的凭证，并检查账号是否通过审核。
 */
export function authenticatePlayer(playerId: string, password: string): PlayerAuthResult {
  if (!validatePlayerID(playerId)) {
    throw new Error('无效的玩家ID格式')
  }
  const player = getPlayerByID(playerId)
  const stored = player?.password
  if (player == null || stored == null || !verifyPasswordCached(playerId, password, stored)) {
    return { type: 'invalid' }
  }
  if (!player.approved) {
    return { type: 'pending' }
  }
  return { type: 'ok', playerId }
}

/**
 * 创建 Basic Auth 中间件。
 * registerMode 为 null 时不允许自动注册。
 */
function basicAuth(registerMode: RegisterMode | null): MiddlewareHandler<Env> {
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
      if (registerMode == null || registerMode === 'closed') {
        return errorResponse(401, '玩家不存在，本服务器不开放自助注册')
      }
      const approved = registerMode !== 'approval'
      createPlayer(credentials.playerId, credentials.password, ip, approved)
      if (!approved) {
        return errorResponse(403, pendingApprovalMessage)
      }
    } else {
      const result = authenticatePlayer(credentials.playerId, credentials.password)
      if (result.type === 'invalid') {
        return errorResponse(401, '密码错误')
      }
      if (result.type === 'pending') {
        return errorResponse(403, pendingApprovalMessage)
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
 * 验证 Basic Auth，并按配置决定是否允许自动注册玩家。
 */
export function basicAuthWithRegister(config: Config): MiddlewareHandler<Env> {
  return basicAuth(config.registerMode)
}

/**
 * 验证 Basic Auth 但不自动注册。
 */
export function basicAuthOnly(): MiddlewareHandler<Env> {
  return basicAuth(null)
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
