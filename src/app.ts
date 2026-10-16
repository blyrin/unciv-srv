import fs from 'node:fs'
import path from 'node:path'
import type { Server } from 'bun'
import type { Config } from './types.js'
import type { PlayerListSort, PlayerListStatusFilter, PlayerListWhitelistFilter } from './database.js'
import type { PlayerAuthResult, RequestContext, Routes } from './middleware.js'
import {
  adminOnly, authenticatePlayer, basicAuthOnly, basicAuthWithRegister, coldArchiveNotice, logger,
  pendingApprovalMessage, rateLimit, routeHandler, sessionAuth, validateGameIDMiddleware,
} from './middleware.js'
import { isHashedPassword, verifyPasswordCached } from './password.js'
import type { RateLimiter } from './rate-limit.js'
import {
  clearSessionCookieHeader, createSession, deleteSession, getSession, parseCookie, sessionCookieHeader,
  sessionCookieName,
} from './session.js'
import {
  createArchive, decodeGameFile, encodeFile, errorResponse, fileResponse, getBaseGameID, getClientIP,
  getPlayerIDsFromParsedGameData, HttpError, jsonResponse, maxJsonBodySize, maxTextBodySize, maxTurnOperationsSize,
  parseBasicAuthCredentials, projectRoot, readLimitedText, successResponse, textResponse,
} from './utils.js'
import {
  batchDeleteGames, batchUpdateGamesWhitelist, batchUpdatePlayersApproval, batchUpdatePlayersWhitelist,
  clearArchivedGame, countGamesByPlayer, createGame, deleteGame, getRestoreRequests,
  acquireSimultaneousTurnLock, releaseSimultaneousTurnLock, renewSimultaneousTurnLock, SimultaneousTurnOperationLimitError, errRollbackPreviewNotFound, getAllStats, getAllTurnsForGame, getGameByID, getGamesByPlayer, getGamesCreatedByPlayer,
  getGamesPage, getLatestFileContent, getLatestFilePreview, getSimultaneousTurnOperations, getPlayerPassword, getPlayersPage, maxSimultaneousTurn,
  getTurnByID, getTurnsMetadata, isDatabaseHealthy, isGameCreator, rollbackGameToTurn, saveFileContent, saveFilePreview, setPlayerApproved,
  updateGameInfo, updateGamePlayers, updatePlayerInfo, updatePlayerPassword, appendSimultaneousTurnOperations,
} from './database.js'
import { notifyGameUpdated } from './chat.js'
import type { ChatWebSocket, PeerData } from './chat.js'
import { createDownloadsRoutes } from './downloads.js'

const healthCheckResponse = '{"authVersion":1,"chatVersion":1}'

const indexPagePath = path.join(projectRoot, 'public/index.html')

/**
 * 开发模式每个请求都从硬盘读前端页面。
 */
const devMode = process.argv.includes('--dev')

/** 管理后台是单页应用，生产模式启动时读一次。 */
const indexPageHtml: string | null = devMode ? null : fs.readFileSync(indexPagePath, 'utf8')

/**
 * 解析分页查询参数。
 */
function parsePagination(ctx: RequestContext): { page: number; pageSize: number; keyword: string; params: URLSearchParams } {
  const params = new URL(ctx.req.url).searchParams
  const pageRaw = Number.parseInt(params.get('page') ?? '', 10)
  const pageSizeRaw = Number.parseInt(params.get('pageSize') ?? '', 10)
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1
  const pageSize = Math.min(Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 ? pageSizeRaw : 20, 100)
  return { page, pageSize, keyword: params.get('keyword') ?? '', params }
}

/** 解析玩家列表的审核状态筛选，非法值按「全部」处理 */
function parsePlayerStatusFilter(value: string | undefined): PlayerListStatusFilter {
  return value === 'pending' || value === 'approved' ? value : 'all'
}

/** 解析玩家列表的白名单筛选，非法值按「全部」处理 */
function parsePlayerWhitelistFilter(value: string | undefined): PlayerListWhitelistFilter {
  return value === 'yes' || value === 'no' ? value : 'all'
}

/** 解析玩家列表排序，非法值按注册时间倒序 */
function parsePlayerSort(value: string | undefined): PlayerListSort {
  return value === 'created_asc' || value === 'updated_desc' || value === 'updated_asc' ? value : 'created_desc'
}

/**
 * 解析 JSON 请求体。
 */
async function readJSONBody<T>(ctx: RequestContext): Promise<T> {
  let text: string
  try {
    text = await readLimitedText(ctx.req, maxJsonBodySize)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, '无效的请求格式')
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new HttpError(400, '无效的请求格式')
  }
}

/**
 * 获取游戏并验证当前用户是参与者。
 */
function checkGamePlayerAccess(ctx: RequestContext, gameId: string, forbiddenMessage: string): Response | null {
  const game = getGameByID(gameId)
  if (!game) {
    return errorResponse(404, '游戏不存在')
  }
  const userId = ctx.get('sessionUserId') || ctx.get('playerId')
  if (!ctx.get('sessionIsAdmin') && !game.players.includes(userId)) {
    return errorResponse(403, forbiddenMessage)
  }
  return null
}

/**
 * 获取游戏并验证当前用户是创建者。
 */
function checkGameCreatorAccess(ctx: RequestContext, gameId: string, forbiddenMessage: string): Response | null {
  const game = getGameByID(gameId)
  if (!game) {
    return errorResponse(404, '游戏不存在')
  }
  if (!ctx.get('sessionIsAdmin') && !isGameCreator(ctx.get('sessionUserId'), gameId)) {
    return errorResponse(403, forbiddenMessage)
  }
  return null
}

/**
 * 返回 Web 管理页面。
 */
function indexPageResponse(): Response {
  const html = indexPageHtml ?? fs.readFileSync(indexPagePath, 'utf8')
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}

/**
 * 判断请求是否为 /chat 的 WebSocket 升级。
 */
function isChatUpgrade(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket'
    && new URL(request.url).pathname === '/chat'
}

/**
 * /chat 的 HTTP 探测：客户端先用普通请求验证凭证，通过后才升级 WebSocket。
 */
async function chatProbeResponse(request: Request): Promise<Response> {
  try {
    const credentials = parseBasicAuthCredentials(request.headers.get('Authorization'))
    const result = await authenticatePlayer(credentials.playerId, credentials.password)
    if (result.type === 'ok') {
      return new Response('Bad Request\n', { status: 400 })
    }
    if (result.type === 'pending') {
      return new Response(`${pendingApprovalMessage}\n`, { status: 403 })
    }
  } catch {
  }
  return new Response('认证失败\n', { status: 401 })
}

export interface App {
  routes: Routes
  /**
   * 兜底处理器：/chat 的 WebSocket 升级与 HTTP 探测、未命中路由的 404。
   */
  fetch: (request: Request, server: Server<PeerData>) => Promise<Response | undefined>
}

/**
 * 创建 HTTP 应用
 */
export function createApp(config: Config, limiter: RateLimiter, chat?: ChatWebSocket): App {
  const routes: Routes = {
    // 安装包直链与版本清单（/dl 跳转 + /api/downloads/latest.json），详见 downloads.ts
    ...createDownloadsRoutes(config),

    '/isalive': { GET: routeHandler(logger(), () => new Response(healthCheckResponse, { status: 200 })) },

    // 就绪探针：数据库可用返回 200，否则 503
    '/ready': {
      GET: routeHandler(logger(), () => {
        const healthy = isDatabaseHealthy()
        return jsonResponse({ ready: healthy }, healthy ? 200 : 503)
      }),
    },

    '/auth': {
      GET: routeHandler(logger(), basicAuthWithRegister(config), () => successResponse()),
      PUT: routeHandler(logger(), basicAuthWithRegister(config), async (ctx) => {
        const playerId = ctx.get('playerId')
        const newPassword = await readLimitedText(ctx.req, maxTextBodySize)
        if (newPassword.length < 6) {
          return errorResponse(400, '密码至少6位')
        }
        await updatePlayerPassword(playerId, newPassword, getClientIP(ctx.req, ctx.remoteAddress))
        return successResponse()
      }),
    },

    '/files/:gameId': {
      GET: routeHandler(logger(), validateGameIDMiddleware(), basicAuthOnly(), coldArchiveNotice(), (ctx) => {
        const gameId = ctx.get('gameId')
        const file = ctx.get('isPreview') ? getLatestFilePreview(gameId) : getLatestFileContent(gameId)
        if (!file) {
          return errorResponse(404, '找不到存档')
        }
        return textResponse(encodeFile(file.data))
      }),
      PUT: routeHandler(logger(), validateGameIDMiddleware(), basicAuthOnly(), coldArchiveNotice(), async (ctx) => {
        const playerId = ctx.get('playerId')
        const gameId = ctx.get('gameId')
        const ip = getClientIP(ctx.req, ctx.remoteAddress)

        let body: string
        try {
          body = await readLimitedText(ctx.req)
        } catch (error) {
          if (error instanceof HttpError) throw error
          return errorResponse(400, '读取请求体失败')
        }
        if (!body) {
          return errorResponse(400, '存档数据不能为空')
        }

        let decodedFile: ReturnType<typeof decodeGameFile>
        try {
          decodedFile = decodeGameFile(body)
        } catch {
          return errorResponse(400, '存档格式无效')
        }
        const { data: decodedData, gameData } = decodedFile
        if (gameData.gameId !== gameId) {
          return errorResponse(400, '游戏ID不匹配')
        }

        let playerIds: string[]
        try {
          playerIds = getPlayerIDsFromParsedGameData(gameData)
        } catch {
          return errorResponse(400, '无法获取玩家列表')
        }
        if (!playerIds.includes(playerId)) {
          return errorResponse(403, '你不是该游戏的玩家')
        }

        const existingGame = getGameByID(gameId)
        if (!existingGame) {
          createGame(gameId, playerIds)
        } else {
          if (!existingGame.players.includes(playerId)) {
            return errorResponse(403, '无权操作此游戏')
          }
          try {
            updateGamePlayers(gameId, playerIds)
          } catch (error) {
            console.error('更新玩家列表失败', error)
          }
        }

        if (ctx.get('isPreview')) {
          saveFilePreview(gameId, gameData.turns, playerId, ip, decodedData)
        } else {
          saveFileContent(gameId, gameData.turns, playerId, ip, decodedData)
        }
        notifyGameUpdated(gameId)
        return successResponse()
      }),
    },

    '/simultaneous-turn-lock/:gameId': {
      POST: routeHandler(logger(), validateGameIDMiddleware(), basicAuthOnly(), coldArchiveNotice(), async (ctx) => {
        const gameId = ctx.get('gameId')
        const accessError = checkGamePlayerAccess(ctx, gameId, '你不是该游戏的玩家')
        if (accessError) return accessError
        const body = (await readLimitedText(ctx.req, maxTextBodySize)).split(':', 2)
        const turn = Number.parseInt(body[0] ?? '', 10)
        const owner = body[1] ?? ''
        if (!Number.isInteger(turn) || turn < 0 || turn > maxSimultaneousTurn || owner !== ctx.get('playerId')) return errorResponse(400, '锁参数无效')
        const acquired = acquireSimultaneousTurnLock(gameId, turn, owner)
        return new Response(null, { status: acquired ? 201 : 409 })
      }),
      DELETE: routeHandler(logger(), validateGameIDMiddleware(), basicAuthOnly(), coldArchiveNotice(), async (ctx) => {
        const gameId = ctx.get('gameId')
        const accessError = checkGamePlayerAccess(ctx, gameId, '你不是该游戏的玩家')
        if (accessError) return accessError
        const body = (await readLimitedText(ctx.req, maxTextBodySize)).split(':', 2)
        const turn = Number.parseInt(body[0] ?? '', 10)
        const owner = body[1] ?? ''
        if (Number.isInteger(turn) && owner === ctx.get('playerId')) releaseSimultaneousTurnLock(gameId, turn, owner)
        return successResponse()
      }),
    },

    '/simultaneous-turn-lock/:gameId/renew': {
      POST: routeHandler(logger(), validateGameIDMiddleware(), basicAuthOnly(), coldArchiveNotice(), async (ctx) => {
        const gameId = ctx.get('gameId')
        const accessError = checkGamePlayerAccess(ctx, gameId, '你不是该游戏的玩家')
        if (accessError) return accessError
        const body = (await readLimitedText(ctx.req, maxTextBodySize)).split(':', 2)
        const turn = Number.parseInt(body[0] ?? '', 10)
        const owner = body[1] ?? ''
        if (!Number.isInteger(turn) || turn < 0 || turn > maxSimultaneousTurn || owner !== ctx.get('playerId')) return errorResponse(400, '锁参数无效')
        const renewed = renewSimultaneousTurnLock(gameId, turn, owner)
        // 续期失败说明锁已被接管或已过期，与取锁竞争失败一致返回 409，客户端应重新取锁。
        return renewed ? successResponse() : new Response(null, { status: 409 })
      }),
    },

    '/simultaneous-turn-operations/:gameId': {
      GET: routeHandler(logger(), validateGameIDMiddleware(), basicAuthOnly(), coldArchiveNotice(), (ctx) => {
        const gameId = ctx.get('gameId')
        const accessError = checkGamePlayerAccess(ctx, gameId, '你不是该游戏的玩家')
        if (accessError) return accessError
        const data = getSimultaneousTurnOperations(gameId)
        return data == null ? errorResponse(404, '找不到同步回合操作') : textResponse(data)
      }),
      POST: routeHandler(logger(), validateGameIDMiddleware(), basicAuthOnly(), coldArchiveNotice(), async (ctx) => {
        const gameId = ctx.get('gameId')
        const accessError = checkGamePlayerAccess(ctx, gameId, '你不是该游戏的玩家')
        if (accessError) return accessError
        let incoming: unknown
        try {
          incoming = JSON.parse(await readLimitedText(ctx.req, maxTurnOperationsSize))
        } catch (error) {
          if (error instanceof HttpError) throw error
          return errorResponse(400, '操作数据格式无效')
        }
        if (!Array.isArray(incoming)) return errorResponse(400, '操作数据格式无效')
        try {
          appendSimultaneousTurnOperations(gameId, ctx.get('playerId'), incoming)
        } catch (error) {
          if (error instanceof SimultaneousTurnOperationLimitError) {
            return errorResponse(400, '同步回合操作数量超过上限')
          }
          console.error('合并同步回合操作失败', { gameId, playerId: ctx.get('playerId') }, error)
          return errorResponse(400, '操作数据无效')
        }
        return new Response(null, { status: 200 })
      }),
    },

    '/api/login': {
      POST: routeHandler(logger(), rateLimit(limiter), async (ctx) => {
        const ip = getClientIP(ctx.req, ctx.remoteAddress)
        const req = await readJSONBody<{ username?: string; password?: string }>(ctx)
        const username = req.username ?? ''
        const password = req.password ?? ''

        if (username === config.adminUsername && password === config.adminPassword) {
          limiter.resetAttempts(ip)
          const sessionId = createSession(username, true)
          const response = jsonResponse({ isAdmin: true })
          response.headers.append('Set-Cookie', sessionCookieHeader(sessionId))
          return response
        }

        let playerAuth: PlayerAuthResult = { type: 'invalid' }
        try {
          playerAuth = await authenticatePlayer(username, password)
        } catch {
          // 用户名不是合法的玩家ID格式时按认证失败处理
        }

        if (playerAuth.type === 'ok') {
          limiter.resetAttempts(ip)
          const sessionId = createSession(username, false)
          const response = jsonResponse({ playerId: username })
          response.headers.append('Set-Cookie', sessionCookieHeader(sessionId))
          return response
        }

        if (limiter.recordAttempt(ip)) {
          return errorResponse(429, '登录失败次数过多，请稍后再试')
        }
        if (playerAuth.type === 'pending') {
          return errorResponse(403, pendingApprovalMessage)
        }
        return errorResponse(401, `用户名或密码错误，剩余尝试次数: ${limiter.getRemainingAttempts(ip)}`)
      }),
    },

    '/api/logout': {
      GET: routeHandler(logger(), (ctx) => {
        const cookies = parseCookie(ctx.req.headers.get('Cookie'))
        const sessionId = cookies[sessionCookieName]
        if (sessionId) {
          deleteSession(sessionId)
        }
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/',
            'Set-Cookie': clearSessionCookieHeader(),
          },
        })
      }),
    },

    '/api/session': {
      GET: routeHandler(logger(), (ctx) => {
        const cookies = parseCookie(ctx.req.headers.get('Cookie'))
        const sessionId = cookies[sessionCookieName]
        if (!sessionId) {
          return jsonResponse({ isLoggedIn: false })
        }
        const session = getSession(sessionId)
        if (!session) {
          const response = jsonResponse({ isLoggedIn: false })
          response.headers.append('Set-Cookie', clearSessionCookieHeader())
          return response
        }
        if (session.isAdmin) {
          return jsonResponse({ isLoggedIn: true, isAdmin: true })
        }
        return jsonResponse({ isLoggedIn: true, playerId: session.userId })
      }),
    },

    '/api/players': {
      GET: routeHandler(logger(), adminOnly(), (ctx) => {
        const { page, pageSize, keyword, params } = parsePagination(ctx)
        const result = getPlayersPage({
          page,
          pageSize,
          keyword,
          status: parsePlayerStatusFilter(params.get('status') ?? undefined),
          whitelist: parsePlayerWhitelistFilter(params.get('whitelist') ?? undefined),
          sort: parsePlayerSort(params.get('sort') ?? undefined),
        })
        result.items = result.items.map((player) => ({ ...player, password: undefined }))
        return jsonResponse(result)
      }),
    },

    '/api/players/:playerId': {
      PUT: routeHandler(logger(), adminOnly(), async (ctx) => {
        const playerId = ctx.params.playerId
        if (!playerId) {
          return errorResponse(400, '缺少玩家ID')
        }
        const req = await readJSONBody<{ whitelist?: boolean; remark?: string; approved?: boolean }>(ctx)
        updatePlayerInfo(playerId, Boolean(req.whitelist), req.remark ?? '')
        if (req.approved != null) {
          setPlayerApproved(playerId, req.approved)
        }
        return successResponse()
      }),
    },

    '/api/restore-requests': {
      GET: routeHandler(logger(), sessionAuth(), adminOnly(), () => jsonResponse({ requests: getRestoreRequests() })),
    },

    '/api/restore-requests/:gameId': {
      DELETE: routeHandler(logger(), sessionAuth(), adminOnly(), (ctx) => {
        const gameId = ctx.params.gameId
        if (!gameId) {
          return errorResponse(400, '缺少对局ID')
        }
        clearArchivedGame(getBaseGameID(gameId))
        return successResponse()
      }),
    },

    '/api/players/:playerId/password': {
      GET: routeHandler(logger(), adminOnly(), (ctx) => {
        const playerId = ctx.params.playerId
        if (!playerId) {
          return errorResponse(400, '缺少玩家ID')
        }
        const password = getPlayerPassword(playerId)
        if (password === '') {
          return errorResponse(404, '玩家不存在')
        }
        if (isHashedPassword(password)) {
          return jsonResponse({ password: null, hashed: true })
        }
        return jsonResponse({ password, hashed: false })
      }),
      PUT: routeHandler(logger(), adminOnly(), async (ctx) => {
        const playerId = ctx.params.playerId
        if (!playerId) {
          return errorResponse(400, '缺少玩家ID')
        }
        const req = await readJSONBody<{ password?: string }>(ctx)
        if (!req.password || req.password.length < 6) {
          return errorResponse(400, '密码至少6位')
        }
        await updatePlayerPassword(playerId, req.password, getClientIP(ctx.req, ctx.remoteAddress))
        return successResponse()
      }),
    },

    '/api/players/batch': {
      PATCH: routeHandler(logger(), adminOnly(), async (ctx) => {
        const req = await readJSONBody<{ playerIds?: string[]; whitelist?: boolean; approved?: boolean }>(ctx)
        if (!req.playerIds || req.playerIds.length === 0) {
          return errorResponse(400, '未选择玩家')
        }
        if (req.whitelist == null && req.approved == null) {
          return errorResponse(400, '缺少要更新的字段')
        }
        if (req.whitelist != null) {
          batchUpdatePlayersWhitelist(req.playerIds, req.whitelist)
        }
        if (req.approved != null) {
          batchUpdatePlayersApproval(req.playerIds, req.approved)
        }
        return successResponse()
      }),
    },

    '/api/games': {
      GET: routeHandler(logger(), adminOnly(), (ctx) => {
        const { page, pageSize, keyword } = parsePagination(ctx)
        return jsonResponse(getGamesPage(keyword, page, pageSize))
      }),
    },

    '/api/games/:gameId': {
      PUT: routeHandler(logger(), adminOnly(), async (ctx) => {
        const gameId = ctx.params.gameId
        if (!gameId) {
          return errorResponse(400, '缺少游戏ID')
        }
        const req = await readJSONBody<{ whitelist?: boolean; remark?: string }>(ctx)
        updateGameInfo(gameId, Boolean(req.whitelist), req.remark ?? '')
        return successResponse()
      }),
      DELETE: routeHandler(logger(), sessionAuth(), (ctx) => {
        const gameId = ctx.params.gameId
        if (!gameId) {
          return errorResponse(400, '缺少游戏ID')
        }
        const accessError = checkGameCreatorAccess(ctx, gameId, '只能删除自己创建的游戏')
        if (accessError) {
          return accessError
        }
        deleteGame(gameId)
        return successResponse()
      }),
    },

    '/api/games/batch': {
      PATCH: routeHandler(logger(), adminOnly(), async (ctx) => {
        const req = await readJSONBody<{ gameIds?: string[]; whitelist?: boolean }>(ctx)
        if (!req.gameIds || req.gameIds.length === 0) {
          return errorResponse(400, '未选择游戏')
        }
        batchUpdateGamesWhitelist(req.gameIds, Boolean(req.whitelist))
        return successResponse()
      }),
      DELETE: routeHandler(logger(), adminOnly(), async (ctx) => {
        const req = await readJSONBody<{ gameIds?: string[] }>(ctx)
        if (!req.gameIds || req.gameIds.length === 0) {
          return errorResponse(400, '未选择游戏')
        }
        batchDeleteGames(req.gameIds)
        return successResponse()
      }),
    },

    '/api/stats': {
      GET: routeHandler(logger(), adminOnly(), () => jsonResponse(getAllStats())),
    },

    '/api/users/games': {
      GET: routeHandler(logger(), sessionAuth(), (ctx) => {
        const userId = ctx.get('sessionUserId')
        return jsonResponse({ playerId: userId, games: getGamesByPlayer(userId) })
      }),
    },

    '/api/users/stats': {
      GET: routeHandler(logger(), sessionAuth(), (ctx) => {
        const userId = ctx.get('sessionUserId')
        return jsonResponse({
          gameCount: countGamesByPlayer(userId),
          createdCount: getGamesCreatedByPlayer(userId),
        })
      }),
    },

    '/api/users/password': {
      PUT: routeHandler(logger(), sessionAuth(), async (ctx) => {
        const userId = ctx.get('sessionUserId')
        const req = await readJSONBody<{ oldPassword?: string; newPassword?: string }>(ctx)
        if (!req.newPassword || req.newPassword.length < 6) {
          return errorResponse(400, '新密码至少6位')
        }
        const stored = getPlayerPassword(userId)
        if (stored === '' || !(await verifyPasswordCached(userId, req.oldPassword ?? '', stored))) {
          return errorResponse(400, '旧密码错误')
        }
        await updatePlayerPassword(userId, req.newPassword, getClientIP(ctx.req, ctx.remoteAddress))
        return successResponse()
      }),
    },

    '/api/games/:gameId/download': {
      GET: routeHandler(logger(), sessionAuth(), async (ctx) => {
        const gameId = ctx.params.gameId
        if (!gameId) {
          return errorResponse(400, '缺少游戏ID')
        }
        const accessError = checkGamePlayerAccess(ctx, gameId, '无权下载此游戏')
        if (accessError) {
          return accessError
        }

        const contents = getAllTurnsForGame(gameId)
        if (!contents.length) {
          return errorResponse(404, '没有存档数据')
        }
        const archive = createArchive(
          contents.map((content) => ({
            name: `turn_${content.turns}_${content.createdAt}.json`,
            data: content.data,
          })),
        )
        return fileResponse(archive.contentType, `game_${gameId}.${archive.extension}`, archive.data)
      }),
    },

    '/api/games/:gameId/turns': {
      GET: routeHandler(logger(), sessionAuth(), (ctx) => {
        const gameId = ctx.params.gameId
        if (!gameId) {
          return errorResponse(400, '缺少游戏ID')
        }
        const accessError = checkGamePlayerAccess(ctx, gameId, '无权查看此游戏')
        if (accessError) {
          return accessError
        }
        return jsonResponse(getTurnsMetadata(gameId))
      }),
    },

    '/api/games/:gameId/turns/:turnId/download': {
      GET: routeHandler(logger(), sessionAuth(), (ctx) => {
        const gameId = ctx.params.gameId
        const turnId = Number.parseInt(ctx.params.turnId ?? '', 10)
        if (!gameId || !Number.isFinite(turnId)) {
          return errorResponse(400, !gameId ? '缺少参数' : '无效的回合ID')
        }
        const accessError = checkGamePlayerAccess(ctx, gameId, '无权下载此游戏')
        if (accessError) {
          return accessError
        }
        const turn = getTurnByID(turnId)
        if (!turn || turn.gameId !== gameId) {
          return errorResponse(404, '回合不存在')
        }
        return fileResponse('application/json', `game_${gameId}_turn_${turn.turns}.json`, turn.data)
      }),
    },

    '/api/games/:gameId/turns/:turnId/rollback': {
      POST: routeHandler(logger(), sessionAuth(), (ctx) => {
        const gameId = ctx.params.gameId
        const turnId = Number.parseInt(ctx.params.turnId ?? '', 10)
        if (!gameId || !Number.isFinite(turnId)) {
          return errorResponse(400, !gameId ? '缺少参数' : '无效的回合ID')
        }
        const accessError = checkGameCreatorAccess(ctx, gameId, '只能回档自己创建的游戏')
        if (accessError) {
          return accessError
        }

        try {
          const result = rollbackGameToTurn(gameId, turnId)
          if (!result) {
            return errorResponse(404, '指定存档不存在')
          }
          return jsonResponse(result)
        } catch (error) {
          if (error === errRollbackPreviewNotFound) {
            return errorResponse(404, '找不到对应预览存档')
          }
          throw error
        }
      }),
    },

    '/': { GET: routeHandler(logger(), indexPageResponse) },
    '/index.html': { GET: routeHandler(logger(), indexPageResponse) },
  }

  return {
    routes,
    fetch: async (request, server) => {
      if (chat && isChatUpgrade(request)) {
        return await chat.upgrade(request, server)
      }
      if (new URL(request.url).pathname === '/chat') {
        return chatProbeResponse(request)
      }
      return errorResponse(404, 'Not Found')
    },
  }
}
