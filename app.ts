// deno-lint-ignore-file no-explicit-any
import { Application, Router } from '@oak/oak'
import { decodeBase64, encodeBase64 } from '@std/encoding/base64'
import { type levellike, Logger } from '@libs/logger'
import postgres from 'npm:postgres'

const env = Deno.env

export const sql = postgres({
  host: env.get('DB_HOST') || 'localhost',
  port: +(env.get('DB_PORT') || 5432),
  database: env.get('DB_NAME') || 'unciv-srv',
  user: env.get('DB_USER') || 'postgres',
  password: env.get('DB_PASSWORD') || 'postgres',
  transform: postgres.camel,
})

const LOG_LEVEL = ['disabled', 'error', 'warn', 'info', 'log', 'debug']
    .includes(env.get('LOG_LEVEL') || '')
  ? env.get('LOG_LEVEL') as levellike
  : 'info'

export const log = new Logger({
  level: LOG_LEVEL,
  date: true,
  time: true,
  delta: false,
  caller: false,
})

export class UncivError extends Error {
  status: number
  override message: string
  info?: string
  constructor(status: number, message: string, info?: string) {
    super(message)
    this.status = status
    this.message = message
    this.info = info
  }
}

export const throwError = (status: number, message: string, info?: string): never => {
  throw new UncivError(status, message, info)
}

export enum AuthStatus {
  Valid = 0,
  Invalid = 1,
  Missing = 2,
}

export interface Player {
  playerId: string
  password: string
}

export interface PlayerWithAuth extends Player {
  status: AuthStatus
}

export const loadUser = async (playerId: string): Promise<Player | null> => {
  const players = await sql<Player[]>`SELECT * FROM sp_load_user(${playerId})`
  return players[0] ?? null
}

export const loadAuth = async (authHeader?: string | null): Promise<PlayerWithAuth> => {
  const invalidAuth = { playerId: '', password: '', status: AuthStatus.Invalid }
  if (!authHeader) return invalidAuth
  const [type, token] = authHeader.split(' ')
  if (type !== 'Basic' || !token) return invalidAuth
  const [playerId, password] = atob(token).split(':')
  if (!playerId || !password) return invalidAuth
  const player = await loadUser(playerId)
  if (!player) return { playerId, password, status: AuthStatus.Missing }
  if (player.password !== password) return invalidAuth
  return { playerId, password, status: AuthStatus.Valid }
}

export const loadPlayerId = async (authorization?: string | null): Promise<string> => {
  const { status: authStatus, playerId } = await loadAuth(authorization)
  if (authStatus !== AuthStatus.Valid) {
    throwError(401, '密码错误或未设置密码', '密码错误或未设置密码')
  }
  return playerId
}

export const decodeFile = async <T = unknown>(file?: string | null): Promise<T | null> => {
  if (!file) return null
  const blob = new Blob([decodeBase64(file)])
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'))
  const response = new Response(stream)
  return await response.json()
}

export const encodeFile = async <T = unknown>(file: Promise<T | null>): Promise<string> => {
  const blob = new Blob([JSON.stringify(file)])
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'))
  const response = new Response(stream)
  const buffer = await response.arrayBuffer()
  return encodeBase64(buffer)
}

export const loadFile = async (gameId: string, preview = false): Promise<string> => {
  const sp = preview ? 'sp_load_file_preview' : 'sp_load_file_content'
  const [file] = await sql`SELECT * FROM ${sql(sp)} (${gameId})`
  if (!file) {
    throwError(404, '😠', `找不到存档 ${gameId}`)
  }
  return await encodeFile(file.data)
}

export const getPlayerIdsFromGameId = async (gameId: string): Promise<string[]> => {
  const file = await sql<{ playerId: string }[]>`SELECT * FROM sp_get_player_ids_from_game(${gameId})`
  return file.map((f) => f.playerId)
}

export const getPlayerIdsFromFile = (decodedFile?: any): string[] => {
  return decodedFile?.gameParameters?.players
    ?.filter?.((player: any) => player.playerType === 'Human')
    ?.map?.((player: any) => player.playerId) ?? []
}

export const saveFile = async (
  playerId: string,
  gameId: string,
  text: string | null | undefined,
  preview = false,
  ip: string,
) => {
  const decoded: any = await decodeFile(text)
    .catch(() => throwError(400, '😠', `${playerId} 上传的存档 ${gameId} 无法解析`))
  if (gameId !== decoded.gameId) {
    throwError(400, '😠', `${playerId} 上传的存档 ${decoded.gameId} 不是 ${gameId}`)
  }
  const newPlayerIds = getPlayerIdsFromFile(decoded)
  if (!newPlayerIds.includes(playerId)) {
    throwError(400, '😠', `${playerId} 试图修改不是自己的存档 ${gameId}`)
  }
  const turns = decoded.turns ?? 0
  if (preview) {
    await sql`SELECT sp_save_file_preview(${playerId}, ${gameId}, ${newPlayerIds}, ${turns}, ${decoded}, ${ip})`
  } else {
    await sql`SELECT sp_save_file_content(${playerId}, ${gameId}, ${newPlayerIds}, ${turns}, ${decoded}, ${ip})`
  }
}

const GAME_ID_REGEX = /^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}(_Preview)?$/
const MAX_BODY_SIZE = 4 * 1024 * 1024

export interface AdminAuth {
  username: string
  password: string
  isAdmin: boolean
}

export interface UserSession {
  playerId?: string
  isAdmin: boolean
  authenticated: boolean
}

const sessions = new Map<string, UserSession>()

const generateSessionId = (): string => {
  return crypto.randomUUID()
}

const setSessionCookie = (ctx: any, sessionId: string) => {
  ctx.response.headers.set('Set-Cookie', `session=${sessionId}; HttpOnly; Path=/; Max-Age=86400`)
}

const getSessionId = (ctx: any): string | null => {
  const cookies = ctx.request.headers.get('cookie')
  if (!cookies) return null

  const sessionMatch = cookies.match(/session=([^;]+)/)
  return sessionMatch ? sessionMatch[1] : null
}

export const loadAdminAuth = async (authHeader?: string | null): Promise<AdminAuth> => {
  const adminUsername = Deno.env.get('ADMIN_USERNAME')
  const adminPassword = Deno.env.get('ADMIN_PASSWORD')

  if (!authHeader) {
    return { username: '', password: '', isAdmin: false }
  }

  const [type, token] = authHeader.split(' ')
  if (type !== 'Basic' || !token) {
    return { username: '', password: '', isAdmin: false }
  }

  const [username, password] = atob(token).split(':')
  if (!username || !password) {
    return { username: '', password: '', isAdmin: false }
  }

  try {
    const result = await sql<AdminAuth[]>`SELECT * FROM sp_validate_admin_auth(${username}, ${password}, ${
      adminUsername || ''
    }, ${adminPassword || ''})`
    return result[0] || { username, password, isAdmin: false }
  } catch (error) {
    log.warn('Admin auth validation failed:', error)
    return { username, password, isAdmin: false }
  }
}

export const getUserSession = async (ctx: any): Promise<UserSession> => {
  const sessionId = getSessionId(ctx)
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!
  }

  const authHeader = ctx.request.headers.get('authorization')

  const adminAuth = await loadAdminAuth(authHeader)
  if (adminAuth.isAdmin) {
    return { isAdmin: true, authenticated: true }
  }

  try {
    const { status, playerId } = await loadAuth(authHeader)
    if (status === AuthStatus.Valid) {
      return { playerId, isAdmin: false, authenticated: true }
    }
  } catch (_error) { /* ignore */ }

  return { isAdmin: false, authenticated: false }
}

import type { GameInfo, PlayerInfo } from './templates.ts'

export const getAllPlayers = (): Promise<PlayerInfo[]> => {
  return sql<PlayerInfo[]>`SELECT * FROM sp_get_all_players()`
}

export const getAllGames = (): Promise<GameInfo[]> => {
  return sql<GameInfo[]>`SELECT * FROM sp_get_all_games()`
}

export const getUserGames = (playerId: string): Promise<GameInfo[]> => {
  return sql<GameInfo[]>`SELECT * FROM sp_get_user_games(${playerId})`
}

export const checkGameDeletePermission = async (gameId: string): Promise<string | null> => {
  const result = await sql<{ createdPlayer: string }[]>`SELECT * FROM sp_check_game_delete_permission(${gameId})`
  return result[0]?.createdPlayer ?? null
}

export const deleteGame = async (gameId: string): Promise<void> => {
  await sql`SELECT sp_delete_game(${gameId})`
}

export const updatePlayer = async (playerId: string, whitelist: boolean, remark?: string): Promise<void> => {
  await sql`SELECT sp_update_player(${playerId}, ${whitelist}, ${remark || null})`
}

export const getPlayerEditInfo = async (playerId: string): Promise<PlayerInfo | null> => {
  const players = await sql<PlayerInfo[]>`SELECT * FROM sp_get_player_edit_info(${playerId})`
  return players[0] ?? null
}

export const getGameEditInfo = async (gameId: string): Promise<GameInfo | null> => {
  const games = await sql<GameInfo[]>`SELECT * FROM sp_get_game_edit_info(${gameId})`
  return games[0] ?? null
}

export const updateGame = async (gameId: string, whitelist: boolean, remark?: string): Promise<void> => {
  await sql`SELECT sp_update_game(${gameId}, ${whitelist}, ${remark || null})`
}

export const router = new Router()

router.all('/isalive', (ctx) => {
  ctx.response.body = { authVersion: 1 }
})

router.get('/auth', async (ctx) => {
  const header = ctx.request.headers.get('authorization')
  const { playerId, password, status } = await loadAuth(header)
  if (status === AuthStatus.Invalid) {
    throwError(401, '密码错误')
  }
  if (status === AuthStatus.Missing) {
    if (password.length < 6 || password.length > 128) {
      throwError(400, '密码长度错误')
    }
    const ip = ctx.request.ip
    await sql`SELECT sp_save_auth(${playerId}, ${password}, ${ip})`
    ctx.response.body = playerId
    return
  }
  ctx.response.body = playerId
})

router.put('/auth', async (ctx) => {
  const header = ctx.request.headers.get('authorization')
  const { playerId, status } = await loadAuth(header)
  if (status === AuthStatus.Invalid) {
    throwError(401, '密码错误')
  }
  const password = await ctx.request.body.text()
  if (password.length < 6 || password.length > 128) {
    throwError(401, '密码长度错误')
  }
  const ip = ctx.request.ip
  await sql`SELECT sp_save_auth(${playerId}, ${password}, ${ip})`
  ctx.response.body = playerId
})

router.get('/files/:gameId', async (ctx) => {
  await loadPlayerId(ctx.request.headers.get('authorization'))
  const [gameId, isPreview] = ctx.params.gameId.split('_')
  ctx.response.body = await loadFile(gameId, !!isPreview)
})

router.put('/files/:gameId', async (ctx) => {
  const playerId = await loadPlayerId(ctx.request.headers.get('authorization'))
  const body = await ctx.request.body.text()
  if (!body || body.length > MAX_BODY_SIZE) {
    throwError(400, '😠', '无效的存档')
  }
  const [gameId, isPreview] = ctx.params.gameId.split('_')
  const ip = ctx.request.ip
  await saveFile(playerId, gameId, body, !!isPreview, ip)
  ctx.response.body = gameId
})

import {
  renderAdminDashboard,
  renderGameEditModal,
  renderGamesTable,
  renderLoginPage,
  renderPlayerEditModal,
  renderPlayersTable,
  renderUserDashboard,
  renderUserGamesTable,
} from './templates.ts'

router.get('/', (ctx) => {
  ctx.response.headers.set('Content-Type', 'text/html; charset=utf-8')
  ctx.response.body = renderLoginPage()
})

router.post('/login', async (ctx) => {
  const body = await ctx.request.body.formData()
  const username = body.get('username')?.toString() || ''
  const password = body.get('password')?.toString() || ''
  const authHeader = `Basic ${btoa(`${username}:${password}`)}`
  const tempSession = await getUserSession({ request: { headers: { get: () => authHeader } } })
  if (!tempSession.authenticated) {
    ctx.response.body = '<div class="error">用户名或密码错误</div>'
    return
  }
  const sessionId = generateSessionId()
  sessions.set(sessionId, tempSession)
  setSessionCookie(ctx, sessionId)
  if (tempSession.isAdmin) {
    ctx.response.headers.set('HX-Redirect', '/dashboard')
  } else {
    ctx.response.headers.set('HX-Redirect', '/user')
  }
  ctx.response.body = ''
})

router.get('/dashboard', async (ctx) => {
  const session = await getUserSession(ctx)
  if (!session.authenticated || !session.isAdmin) {
    ctx.response.status = 302
    ctx.response.headers.set('Location', '/')
    return
  }
  const [players, games] = await Promise.all([
    getAllPlayers(),
    getAllGames(),
  ])
  ctx.response.headers.set('Content-Type', 'text/html; charset=utf-8')
  ctx.response.body = renderAdminDashboard(players, games)
})

router.get('/user', async (ctx) => {
  const session = await getUserSession(ctx)
  if (!session.authenticated || session.isAdmin || !session.playerId) {
    ctx.response.status = 302
    ctx.response.headers.set('Location', '/')
    return
  }
  const games = await getUserGames(session.playerId)
  ctx.response.headers.set('Content-Type', 'text/html; charset=utf-8')
  ctx.response.body = renderUserDashboard(session.playerId, games)
})

router.get('/logout', (ctx) => {
  const sessionId = getSessionId(ctx)
  if (sessionId) {
    sessions.delete(sessionId)
  }
  ctx.response.headers.set('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0')
  ctx.response.headers.set('Location', '/')
  ctx.response.status = 302
})

router.get('/player/:playerId/edit', async (ctx) => {
  const session = await getUserSession(ctx)
  if (!session.authenticated || !session.isAdmin) {
    ctx.response.status = 401
    return
  }
  const playerId = ctx.params.playerId
  const player = await getPlayerEditInfo(playerId)
  if (!player) {
    ctx.response.status = 404
    return
  }

  ctx.response.headers.set('Content-Type', 'text/html; charset=utf-8')
  ctx.response.body = renderPlayerEditModal(player)
})

router.put('/player/:playerId', async (ctx) => {
  const session = await getUserSession(ctx)
  if (!session.authenticated || !session.isAdmin) {
    ctx.response.status = 401
    return
  }
  const playerId = ctx.params.playerId
  const body = await ctx.request.body.formData()
  const whitelist = body.get('whitelist') === 'true'
  const remark = body.get('remark')?.toString() || ''
  await updatePlayer(playerId, whitelist, remark)
  const players = await getAllPlayers()
  ctx.response.headers.set('Content-Type', 'text/html; charset=utf-8')
  ctx.response.body = renderPlayersTable(players)
})

router.get('/game/:gameId/edit', async (ctx) => {
  const session = await getUserSession(ctx)
  if (!session.authenticated || !session.isAdmin) {
    ctx.response.status = 401
    return
  }
  const gameId = ctx.params.gameId
  const game = await getGameEditInfo(gameId)
  if (!game) {
    ctx.response.status = 404
    return
  }
  ctx.response.headers.set('Content-Type', 'text/html; charset=utf-8')
  ctx.response.body = renderGameEditModal(game)
})

router.put('/game/:gameId', async (ctx) => {
  const session = await getUserSession(ctx)
  if (!session.authenticated || !session.isAdmin) {
    ctx.response.status = 401
    return
  }
  const gameId = ctx.params.gameId
  const body = await ctx.request.body.formData()
  const whitelist = body.get('whitelist') === 'true'
  const remark = body.get('remark')?.toString() || ''
  await updateGame(gameId, whitelist, remark)
  const games = await getAllGames()
  ctx.response.headers.set('Content-Type', 'text/html; charset=utf-8')
  ctx.response.body = renderGamesTable(games)
})

router.delete('/game/:gameId', async (ctx) => {
  const session = await getUserSession(ctx)
  if (!session.authenticated) {
    ctx.response.status = 401
    return
  }
  const gameId = ctx.params.gameId
  if (!session.isAdmin && session.playerId) {
    const createdPlayer = await checkGameDeletePermission(gameId)
    if (!createdPlayer || createdPlayer !== session.playerId) {
      ctx.response.status = 403
      return
    }
  }
  await deleteGame(gameId)
  if (session.isAdmin) {
    const games = await getAllGames()
    ctx.response.headers.set('Content-Type', 'text/html; charset=utf-8')
    ctx.response.body = renderGamesTable(games)
  } else if (session.playerId) {
    const games = await getUserGames(session.playerId)
    ctx.response.headers.set('Content-Type', 'text/html; charset=utf-8')
    ctx.response.body = renderUserGamesTable(games, session.playerId)
  }
})

export const app = new Application()

app.use(async (ctx, next) => {
  const startTime = Date.now()
  const path = ctx.request.url.pathname
  const ip = ctx.request.ip
  try {
    if (path.startsWith('/files/')) {
      const ua = ctx.request.headers.get('user-agent')
      if (!ua?.startsWith('Unciv')) {
        throwError(400, '😠', `使用了错误的客户端`)
      }
      const gameId = path.match(/^\/files\/([^\/]+)/)?.[1]
      if (!gameId || !GAME_ID_REGEX.test(gameId)) {
        throwError(400, '😠', `id格式错误`)
      }
    }
    await next()
    const endTime = Date.now()
    log.with({ ip, t: endTime - startTime, s: ctx.response.status })
      .info(`${ctx.request.method} ${path}`)
  } catch (err: unknown) {
    const endTime = Date.now()
    if (err instanceof UncivError) {
      log.with({ ip, t: endTime - startTime, s: err.status })
        .warn(`${ctx.request.method} ${path}`)
        .warn(err.message, err.info)
      ctx.response.status = err.status
      ctx.response.body = err.message
    } else if (err instanceof Error) {
      log.with({ ip, t: endTime - startTime, s: 500 })
        .error(`${ctx.request.method} ${path}`)
        .error(err.message)
      ctx.response.status = 500
      ctx.response.body = '服务器错误'
    } else {
      log.with({ ip, t: endTime - startTime, s: 500 })
        .error(`${ctx.request.method} ${path}`)
        .error(err)
      ctx.response.status = 500
      ctx.response.body = '未知错误'
    }
  }
})

app.use(router.routes())
app.use(router.allowedMethods())

const PORT = +(Deno.env.get('PORT') || 11451)

if (import.meta.main) {
  const abortController = new AbortController()
  Deno.addSignalListener('SIGINT', () => {
    log.info('关闭中...')
    abortController.abort()
    Deno.exit()
  })
  try {
    log.info(`监听端口: ${PORT}`)
    app.listen({ port: PORT, signal: abortController.signal })
  } catch (err) {
    log.error(err)
    Deno.exit()
  }
}
