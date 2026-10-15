import type { Server } from 'bun'
import type { AppVariables, Config, RegisterMode } from './types.js'
import {
  createPlayer, getArchivedGameRecord, getPlayerByID, requestArchivedGameRestore, updatePlayerLastActive,
} from './database.js'
import { recordHttpRequest } from './metrics.js'
import { verifyPasswordCached } from './password.js'
import { ipForLog } from './privacy.js'
import { clearSessionCookieHeader, getSession, parseCookie, sessionCookieName } from './session.js'
import {
  decodeHeaderValue, errorResponse, getBaseGameID, getClientIP, HttpError, isPreviewID, parseBasicAuthCredentials,
  textResponse, validateGameID, validatePlayerID,
} from './utils.js'
import type { RateLimiter } from './rate-limit.js'

/** 请求上下文：只保留本项目用到的能力 */
export interface RequestContext {
  readonly req: Request
  /** 路径参数，由 Bun 路由匹配并解码后挂在 req.params 上 */
  readonly params: Record<string, string>
  /** 连接对端地址，来自 Bun 的 server.requestIP */
  readonly remoteAddress: string
  get<K extends keyof AppVariables>(key: K): AppVariables[K]
  set<K extends keyof AppVariables>(key: K, value: AppVariables[K]): void
  /** 返回 302 跳转响应 */
  redirect(url: string): Response
}

/** 路由处理器 */
export type Handler = (ctx: RequestContext) => Response | Promise<Response>

/** 中间件 */
export type Middleware = (ctx: RequestContext, next: () => Promise<Response>) => Response | Promise<Response>

/** 注册路由用的统一签名：最后一个参数是处理器，其余是中间件 */
type Endpoint = (ctx: RequestContext, next: () => Promise<Response>) => Response | Promise<Response>

/** Bun routes 处理器的请求对象：路径参数挂在 req.params 上 */
type RouteRequest = Request & { readonly params: Record<string, string> }

/** Bun routes 处理器 */
export type RouteHandler = (req: RouteRequest, server: Server<unknown>) => Promise<Response>

type MethodHandlers = Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', RouteHandler>>

/** 路由表 */
export type Routes = Record<string, MethodHandlers>

function createContext(req: RouteRequest, server: Server<unknown>): RequestContext {
  const variables = {} as AppVariables
  return {
    req,
    params: req.params,
    remoteAddress: server.requestIP(req)?.address ?? '',
    get: (key) => variables[key],
    set: (key, value) => {
      variables[key] = value
    },
    redirect: (url) => new Response(null, { status: 302, headers: { Location: url } }),
  }
}

/**
 * 依次执行中间件链，最后调用处理器。
 */
async function runChain(ctx: RequestContext, middlewares: Middleware[], handler: Handler): Promise<Response> {
  const run = async (index: number): Promise<Response> =>
    index < middlewares.length ? middlewares[index](ctx, () => run(index + 1)) : handler(ctx)
  return run(0)
}

/**
 * 把中间件链与处理器包装成 Bun routes 处理器：建上下文、跑链、统一错误响应并计数。
 */
export function routeHandler(...endpoints: Endpoint[]): RouteHandler {
  const handler = endpoints.pop()
  if (!handler) {
    throw new Error('routeHandler 缺少处理器')
  }
  const middlewares = endpoints as Middleware[]
  return async (req, server) => {
    recordHttpRequest()
    const ctx = createContext(req, server)
    try {
      return await runChain(ctx, middlewares, handler as Handler)
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(error.status, error.message)
      }
      console.error('请求处理失败', error)
      return errorResponse(500, '服务器错误')
    }
  }
}

/**
 * 记录 HTTP 请求日志。
 */
export function logger(): Middleware {
  return async (ctx, next) => {
    const start = performance.now()
    let status = 0
    try {
      const response = await next()
      status = response.status
      return response
    } finally {
      const duration = performance.now() - start
      console.info('HTTP', {
        method: ctx.req.method,
        path: new URL(ctx.req.url).pathname,
        status,
        duration: `${duration.toFixed(2)}ms`,
        ip: ipForLog(getClientIP(ctx.req, ctx.remoteAddress)),
        ua: decodeHeaderValue(ctx.req.headers.get('User-Agent') ?? ''),
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
export function coldArchiveNotice(): Middleware {
  return async (ctx, next) => {
    const rawGameId = ctx.params.gameId
    if (rawGameId == null || rawGameId === '') {
      return next()
    }
    const gameId = getBaseGameID(rawGameId)
    const archived = getArchivedGameRecord(gameId)
    if (archived == null) {
      return next()
    }
    if (!isPreviewID(rawGameId)) {
      requestArchivedGameRestore(gameId, ctx.get('playerId'))
    }
    const detail = archived.archiveFile === ''
      ? '该对局没有保存过存档内容，无法恢复。'
      : '存档保存在加密网盘中，管理员取回后即可继续游戏，通常需要几分钟到半小时。'
    const detailEn = archived.archiveFile === ''
      ? 'This game never had a save file uploaded, so it cannot be restored.'
      : 'The save file is in encrypted cloud storage; an admin has to restore it, which usually takes minutes to half an hour.'
    const response = textResponse(
      `该对局已被冷归档（服务器存档总量超过上限后，按最久未使用的顺序归档）。\n` +
      `${detail}\n` +
      `请稍后重试；如果长时间没有恢复，请在社区群提醒管理员。\n` +
      `[EN] This game was cold-archived (oldest saves are archived when the server runs out of space).\n` +
      `${detailEn}\n` +
      `Please retry later, and remind the admins in the community group if it stays unavailable.`,
      503,
    )
    response.headers.set('Retry-After', '600')
    return response
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
function basicAuth(registerMode: RegisterMode | null): Middleware {
  return async (ctx, next) => {
    let credentials
    try {
      credentials = parseBasicAuthCredentials(ctx.req.headers.get('Authorization'))
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(error.status, error.message)
      }
      return errorResponse(401, '需要认证')
    }

    const ip = getClientIP(ctx.req, ctx.remoteAddress)
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

    ctx.set('playerId', credentials.playerId)
    return next()
  }
}

/**
 * 读取登录会话并写入请求上下文。
 */
function setSessionContext(ctx: RequestContext): Response | null {
  const cookies = parseCookie(ctx.req.headers.get('Cookie'))
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

  ctx.set('sessionUserId', session.userId)
  ctx.set('sessionIsAdmin', session.isAdmin)
  return null
}

/**
 * 验证 Basic Auth，并按配置决定是否允许自动注册玩家。
 */
export function basicAuthWithRegister(config: Config): Middleware {
  return basicAuth(config.registerMode)
}

/**
 * 验证 Basic Auth 但不自动注册。
 */
export function basicAuthOnly(): Middleware {
  return basicAuth(null)
}

/**
 * 验证 Unciv 文件接口的游戏 ID 和客户端标识。
 */
export function validateGameIDMiddleware(): Middleware {
  return async (ctx, next) => {
    const userAgent = decodeHeaderValue(ctx.req.headers.get('User-Agent') ?? '')
    if (!userAgent.startsWith('Unciv')) {
      return errorResponse(403, '非法客户端')
    }

    const rawGameId = ctx.params.gameId
    if (!rawGameId) {
      return errorResponse(400, '缺少游戏ID')
    }
    if (!validateGameID(rawGameId)) {
      return errorResponse(400, '无效的游戏ID格式')
    }

    ctx.set('gameId', getBaseGameID(rawGameId))
    ctx.set('isPreview', isPreviewID(rawGameId))
    return next()
  }
}

/**
 * 验证 Web 管理端登录会话。
 */
export function sessionAuth(): Middleware {
  return async (ctx, next) => {
    const response = setSessionContext(ctx)
    if (response) {
      return response
    }
    return next()
  }
}

/**
 * 验证管理员会话。
 */
export function adminOnly(): Middleware {
  return async (ctx, next) => {
    const response = setSessionContext(ctx)
    if (response) {
      return response
    }
    if (!ctx.get('sessionIsAdmin')) {
      return errorResponse(403, '需要管理员权限')
    }
    return next()
  }
}

/**
 * 检查登录限流状态。
 */
export function rateLimit(limiter: RateLimiter): Middleware {
  return async (ctx, next) => {
    const ip = getClientIP(ctx.req, ctx.remoteAddress)
    if (limiter.isLocked(ip)) {
      return errorResponse(429, `请求过于频繁，请稍后再试 (${limiter.getLockRemainingText(ip)})`)
    }
    return next()
  }
}
