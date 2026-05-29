import fs from 'node:fs'
import path from 'node:path'
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { AppVariables, Config } from './types.js'
import {
  adminOnly, basicAuthOnly, basicAuthWithRegister, logger, rateLimit, sessionAuth, validateGameIDMiddleware,
  validatePlayer,
} from './middleware.js'
import type { RateLimiter } from './rate-limit.js'
import {
  clearSessionCookieHeader, createSession, deleteSession, getSession, parseCookie, sessionCookieHeader,
  sessionCookieName,
} from './session.js'
import { projectRoot } from './paths.js'
import {
  createZip, decodeGameFile, encodeFile, errorResponse, fileResponse, getClientIP, getPlayerIDsFromParsedGameData,
  HttpError, jsonResponse, parseBasicAuthCredentials, readLimitedText, successResponse, textResponse,
} from './utils.js'
import {
  batchDeleteGames, batchUpdateGamesWhitelist, batchUpdatePlayersWhitelist, countGamesByPlayer, createGame, deleteGame,
  errRollbackPreviewNotFound, getAllStats, getAllTurnsForGame, getGameByID, getGamesByPlayer, getGamesCreatedByPlayer,
  getGamesPage, getLatestFileContent, getLatestFilePreview, getPlayerByID, getPlayerPassword, getPlayersPage,
  getTurnByID, getTurnsMetadata, isGameCreator, rollbackGameToTurn, saveFileContent, saveFilePreview, updateGameInfo,
  updateGamePlayers, updatePlayerInfo, updatePlayerPassword,
} from './database.js'
import { notifyGameUpdated } from './chat.js'

type Env = { Variables: AppVariables }

const healthCheckResponse = '{"authVersion":1,"chatVersion":1}'

/**
 * 解析分页查询参数。
 */
function parsePagination(c: Context<Env>): { page: number; pageSize: number; keyword: string } {
  const pageRaw = Number.parseInt(c.req.query('page') ?? '', 10)
  const pageSizeRaw = Number.parseInt(c.req.query('pageSize') ?? '', 10)
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1
  const pageSize = Math.min(Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 ? pageSizeRaw : 20, 100)
  return { page, pageSize, keyword: c.req.query('keyword') ?? '' }
}

/**
 * 解析 JSON 请求体。
 */
async function readJSONBody<T>(c: Context<Env>): Promise<T> {
  try {
    return await c.req.json<T>()
  } catch {
    throw new HttpError(400, '无效的请求格式')
  }
}

/**
 * 获取游戏并验证当前用户是参与者。
 */
function checkGamePlayerAccess(c: Context<Env>, gameId: string, forbiddenMessage: string): Response | null {
  const game = getGameByID(gameId)
  if (!game) {
    return errorResponse(404, '游戏不存在')
  }
  if (!c.get('sessionIsAdmin') && !game.players.includes(c.get('sessionUserId'))) {
    return errorResponse(403, forbiddenMessage)
  }
  return null
}

/**
 * 获取游戏并验证当前用户是创建者。
 */
function checkGameCreatorAccess(c: Context<Env>, gameId: string, forbiddenMessage: string): Response | null {
  const game = getGameByID(gameId)
  if (!game) {
    return errorResponse(404, '游戏不存在')
  }
  if (!c.get('sessionIsAdmin') && !isGameCreator(c.get('sessionUserId'), gameId)) {
    return errorResponse(403, forbiddenMessage)
  }
  return null
}

/**
 * 返回 Web 管理页面。
 */
function indexPageResponse(): Response {
  const html = fs.readFileSync(path.join(projectRoot, 'public/index.html'), 'utf8')
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}

/**
 * 创建 Hono 应用并注册所有 HTTP 路由。
 */
export function createApp(config: Config, limiter: RateLimiter): Hono<Env> {
  const app = new Hono<Env>()

  app.onError((error) => {
    if (error instanceof HttpError) {
      return errorResponse(error.status, error.message)
    }
    console.error('请求处理失败', error)
    return errorResponse(500, '服务器错误')
  })

  app.get('/isalive', logger(), () => new Response(healthCheckResponse, { status: 200 }))

  app.get('/auth', logger(), basicAuthWithRegister(), () => successResponse())
  app.put('/auth', logger(), basicAuthWithRegister(), async (c) => {
    const playerId = c.get('playerId')
    const newPassword = await c.req.text()
    if (newPassword.length < 6) {
      return errorResponse(400, '密码至少6位')
    }
    updatePlayerPassword(playerId, newPassword, getClientIP(c))
    return successResponse()
  })

  app.get('/files/:gameId', logger(), validateGameIDMiddleware(), basicAuthOnly(), (c) => {
    const gameId = c.get('gameId')
    const file = c.get('isPreview') ? getLatestFilePreview(gameId) : getLatestFileContent(gameId)
    if (!file) {
      return errorResponse(404, '找不到存档')
    }
    return textResponse(encodeFile(file.data))
  })

  app.put('/files/:gameId', logger(), validateGameIDMiddleware(), basicAuthOnly(), async (c) => {
    const playerId = c.get('playerId')
    const gameId = c.get('gameId')
    const ip = getClientIP(c)

    let body: string
    try {
      body = await readLimitedText(c.req.raw)
    } catch {
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

    if (c.get('isPreview')) {
      saveFilePreview(gameId, gameData.turns, playerId, ip, decodedData)
    } else {
      saveFileContent(gameId, gameData.turns, playerId, ip, decodedData)
    }
    notifyGameUpdated(gameId)
    return successResponse()
  })

  app.get('/chat', logger(), (c) => {
    try {
      const credentials = parseBasicAuthCredentials(c.req.header('Authorization'))
      if (validatePlayer(credentials.playerId, credentials.password)) {
        return new Response('Bad Request\n', { status: 400 })
      }
    } catch {
    }
    return new Response('认证失败\n', { status: 401 })
  })

  app.post('/api/login', logger(), rateLimit(limiter), async (c) => {
    const ip = getClientIP(c)
    const req = await readJSONBody<{ username?: string; password?: string }>(c)
    const username = req.username ?? ''
    const password = req.password ?? ''

    if (username === config.adminUsername && password === config.adminPassword) {
      limiter.resetAttempts(ip)
      const sessionId = createSession(username, true)
      const response = jsonResponse({ isAdmin: true })
      response.headers.append('Set-Cookie', sessionCookieHeader(sessionId))
      return response
    }

    const player = getPlayerByID(username)
    if (player && player.password === password) {
      limiter.resetAttempts(ip)
      const sessionId = createSession(username, false)
      const response = jsonResponse({ playerId: username })
      response.headers.append('Set-Cookie', sessionCookieHeader(sessionId))
      return response
    }

    if (limiter.recordAttempt(ip)) {
      return errorResponse(429, '登录失败次数过多，请稍后再试')
    }
    return errorResponse(401, `用户名或密码错误，剩余尝试次数: ${limiter.getRemainingAttempts(ip)}`)
  })

  app.get('/api/logout', logger(), (c) => {
    const cookies = parseCookie(c.req.header('Cookie'))
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
  })

  app.get('/api/session', logger(), (c) => {
    const cookies = parseCookie(c.req.header('Cookie'))
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
  })

  app.get('/api/players', logger(), adminOnly(), (c) => {
    const { page, pageSize, keyword } = parsePagination(c)
    const result = getPlayersPage(keyword, page, pageSize)
    result.items = result.items.map((player) => ({ ...player, password: undefined }))
    return jsonResponse(result)
  })

  app.put('/api/players/:playerId', logger(), adminOnly(), async (c) => {
    const playerId = c.req.param('playerId')
    if (!playerId) {
      return errorResponse(400, '缺少玩家ID')
    }
    const req = await readJSONBody<{ whitelist?: boolean; remark?: string }>(c)
    updatePlayerInfo(playerId, Boolean(req.whitelist), req.remark ?? '')
    return successResponse()
  })

  app.get('/api/players/:playerId/password', logger(), adminOnly(), (c) => {
    const playerId = c.req.param('playerId')
    if (!playerId) {
      return errorResponse(400, '缺少玩家ID')
    }
    const password = getPlayerPassword(playerId)
    if (password === '') {
      return errorResponse(404, '玩家不存在')
    }
    return jsonResponse({ password })
  })

  app.put('/api/players/:playerId/password', logger(), adminOnly(), async (c) => {
    const playerId = c.req.param('playerId')
    if (!playerId) {
      return errorResponse(400, '缺少玩家ID')
    }
    const req = await readJSONBody<{ password?: string }>(c)
    if (!req.password || req.password.length < 6) {
      return errorResponse(400, '密码至少6位')
    }
    updatePlayerPassword(playerId, req.password, getClientIP(c))
    return successResponse()
  })

  app.patch('/api/players/batch', logger(), adminOnly(), async (c) => {
    const req = await readJSONBody<{ playerIds?: string[]; whitelist?: boolean }>(c)
    if (!req.playerIds || req.playerIds.length === 0) {
      return errorResponse(400, '未选择玩家')
    }
    batchUpdatePlayersWhitelist(req.playerIds, Boolean(req.whitelist))
    return successResponse()
  })

  app.get('/api/games', logger(), adminOnly(), (c) => {
    const { page, pageSize, keyword } = parsePagination(c)
    return jsonResponse(getGamesPage(keyword, page, pageSize))
  })

  app.put('/api/games/:gameId', logger(), adminOnly(), async (c) => {
    const gameId = c.req.param('gameId')
    if (!gameId) {
      return errorResponse(400, '缺少游戏ID')
    }
    const req = await readJSONBody<{ whitelist?: boolean; remark?: string }>(c)
    updateGameInfo(gameId, Boolean(req.whitelist), req.remark ?? '')
    return successResponse()
  })

  app.patch('/api/games/batch', logger(), adminOnly(), async (c) => {
    const req = await readJSONBody<{ gameIds?: string[]; whitelist?: boolean }>(c)
    if (!req.gameIds || req.gameIds.length === 0) {
      return errorResponse(400, '未选择游戏')
    }
    batchUpdateGamesWhitelist(req.gameIds, Boolean(req.whitelist))
    return successResponse()
  })

  app.delete('/api/games/batch', logger(), adminOnly(), async (c) => {
    const req = await readJSONBody<{ gameIds?: string[] }>(c)
    if (!req.gameIds || req.gameIds.length === 0) {
      return errorResponse(400, '未选择游戏')
    }
    batchDeleteGames(req.gameIds)
    return successResponse()
  })

  app.get('/api/stats', logger(), adminOnly(), () => jsonResponse(getAllStats()))

  app.get('/api/users/games', logger(), sessionAuth(), (c) => {
    const userId = c.get('sessionUserId')
    return jsonResponse({ playerId: userId, games: getGamesByPlayer(userId) })
  })

  app.get('/api/users/stats', logger(), sessionAuth(), (c) => {
    const userId = c.get('sessionUserId')
    return jsonResponse({
      gameCount: countGamesByPlayer(userId),
      createdCount: getGamesCreatedByPlayer(userId),
    })
  })

  app.put('/api/users/password', logger(), sessionAuth(), async (c) => {
    const userId = c.get('sessionUserId')
    const req = await readJSONBody<{ oldPassword?: string; newPassword?: string }>(c)
    if (!req.newPassword || req.newPassword.length < 6) {
      return errorResponse(400, '新密码至少6位')
    }
    if (getPlayerPassword(userId) !== req.oldPassword) {
      return errorResponse(400, '旧密码错误')
    }
    updatePlayerPassword(userId, req.newPassword, getClientIP(c))
    return successResponse()
  })

  app.delete('/api/games/:gameId', logger(), sessionAuth(), (c) => {
    const gameId = c.req.param('gameId')
    if (!gameId) {
      return errorResponse(400, '缺少游戏ID')
    }
    const accessError = checkGameCreatorAccess(c, gameId, '只能删除自己创建的游戏')
    if (accessError) {
      return accessError
    }
    deleteGame(gameId)
    return successResponse()
  })

  app.get('/api/games/:gameId/download', logger(), sessionAuth(), (c) => {
    const gameId = c.req.param('gameId')
    if (!gameId) {
      return errorResponse(400, '缺少游戏ID')
    }
    const accessError = checkGamePlayerAccess(c, gameId, '无权下载此游戏')
    if (accessError) {
      return accessError
    }

    const contents = getAllTurnsForGame(gameId)
    if (!contents.length) {
      return errorResponse(404, '没有存档数据')
    }
    const zipData = createZip(
      contents.map((content) => ({
        name: `turn_${content.turns}_${content.createdAt}.json`,
        data: content.data,
      })),
    )
    return fileResponse('application/zip', `game_${gameId}.zip`, zipData)
  })

  app.get('/api/games/:gameId/turns', logger(), sessionAuth(), (c) => {
    const gameId = c.req.param('gameId')
    if (!gameId) {
      return errorResponse(400, '缺少游戏ID')
    }
    const accessError = checkGamePlayerAccess(c, gameId, '无权查看此游戏')
    if (accessError) {
      return accessError
    }
    return jsonResponse(getTurnsMetadata(gameId))
  })

  app.get('/api/games/:gameId/turns/:turnId/download', logger(), sessionAuth(), (c) => {
    const gameId = c.req.param('gameId')
    const turnId = Number.parseInt(c.req.param('turnId'), 10)
    if (!gameId || !Number.isFinite(turnId)) {
      return errorResponse(400, !gameId ? '缺少参数' : '无效的回合ID')
    }
    const accessError = checkGamePlayerAccess(c, gameId, '无权下载此游戏')
    if (accessError) {
      return accessError
    }
    const turn = getTurnByID(turnId)
    if (!turn || turn.gameId !== gameId) {
      return errorResponse(404, '回合不存在')
    }
    return fileResponse('application/json', `game_${gameId}_turn_${turn.turns}.json`, turn.data)
  })

  app.post('/api/games/:gameId/turns/:turnId/rollback', logger(), sessionAuth(), (c) => {
    const gameId = c.req.param('gameId')
    const turnId = Number.parseInt(c.req.param('turnId'), 10)
    if (!gameId || !Number.isFinite(turnId)) {
      return errorResponse(400, !gameId ? '缺少参数' : '无效的回合ID')
    }
    const accessError = checkGameCreatorAccess(c, gameId, '只能回档自己创建的游戏')
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
  })

  app.get('/', logger(), indexPageResponse)
  app.get('/index.html', logger(), indexPageResponse)

  return app
}
