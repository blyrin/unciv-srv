// deno-lint-ignore-file no-explicit-any
import {
  createApp,
  createRouter,
  defineEventHandler,
  getCookie,
  getHeader,
  getRouterParam,
  type H3Event,
  readBody,
  sendRedirect,
  serveStatic,
  setCookie,
  setResponseHeader,
  setResponseStatus,
  toWebHandler,
} from 'npm:h3'
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

const setSessionCookie = (event: H3Event, sessionId: string) => {
  setCookie(event, 'session', sessionId, { httpOnly: true, path: '/', maxAge: 86400 })
}

const getSessionId = (event: H3Event): string | null => {
  return getCookie(event, 'session') || null
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

export const getUserSession = async (event: H3Event): Promise<UserSession> => {
  const sessionId = getSessionId(event)
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!
  }

  const authHeader = getHeader(event, 'authorization')

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

interface PlayerInfo {
  playerId: string
  createdAt: Date
  updatedAt: Date
  whitelist: boolean
  remark?: string
  createIp?: string
  updateIp?: string
}

interface GameInfo {
  gameId: string
  players: string[]
  createdAt: Date
  updatedAt: Date
  whitelist: boolean
  remark?: string
  turns?: number
  createdPlayer?: string
}

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

export const updateGame = async (gameId: string, whitelist: boolean, remark?: string): Promise<void> => {
  await sql`SELECT sp_update_game(${gameId}, ${whitelist}, ${remark || null})`
}

export const router = createRouter()

router.get('/isalive', defineEventHandler(() => ({ authVersion: 1 })))

router.get(
  '/auth',
  defineEventHandler(async (event) => {
    const header = getHeader(event, 'authorization')
    const { playerId, password, status } = await loadAuth(header)
    if (status === AuthStatus.Invalid) {
      throwError(401, '密码错误')
    }
    if (status === AuthStatus.Missing) {
      if (password.length < 6 || password.length > 128) {
        throwError(400, '密码长度错误')
      }
      const ip = getHeader(event, 'x-forwarded-for') || event.node.req.socket?.remoteAddress || 'unknown'
      await sql`SELECT sp_save_auth(${playerId}, ${password}, ${ip})`
      return playerId
    }
    return playerId
  }),
)

router.put(
  '/auth',
  defineEventHandler(async (event) => {
    const header = getHeader(event, 'authorization')
    const { playerId, status } = await loadAuth(header)
    if (status === AuthStatus.Invalid) {
      throwError(401, '密码错误')
    }
    const password = await readBody(event)
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      throwError(401, '密码长度错误')
    }
    const ip = getHeader(event, 'x-forwarded-for') || event.node.req.socket?.remoteAddress || 'unknown'
    await sql`SELECT sp_save_auth(${playerId}, ${password}, ${ip})`
    return playerId
  }),
)

router.get(
  '/files/:gameId',
  defineEventHandler(async (event) => {
    await loadPlayerId(getHeader(event, 'authorization'))
    const gameIdParam = getRouterParam(event, 'gameId') || ''
    const [gameId, isPreview] = gameIdParam.split('_')
    return await loadFile(gameId, !!isPreview)
  }),
)

router.put(
  '/files/:gameId',
  defineEventHandler(async (event) => {
    const playerId = await loadPlayerId(getHeader(event, 'authorization'))
    const body = await readBody(event)
    if (!body || (typeof body === 'string' && body.length > MAX_BODY_SIZE)) {
      throwError(400, '😠', '无效的存档')
    }
    const gameIdParam = getRouterParam(event, 'gameId') || ''
    const [gameId, isPreview] = gameIdParam.split('_')
    const ip = getHeader(event, 'x-forwarded-for') || event.node.req.socket?.remoteAddress || 'unknown'
    await saveFile(playerId, gameId, typeof body === 'string' ? body : JSON.stringify(body), !!isPreview, ip)
    return gameId
  }),
)

router.get(
  '/',
  defineEventHandler((event) => {
    return sendRedirect(event, '/login.html', 302)
  }),
)

router.post(
  '/api/login',
  defineEventHandler(async (event) => {
    const body = await readBody(event)
    const username = body?.username?.toString() || ''
    const password = body?.password?.toString() || ''
    const authHeader = `Basic ${btoa(`${username}:${password}`)}`
    const tempEvent = {
      ...event,
      node: {
        ...event.node,
        req: {
          ...event.node.req,
          headers: {
            ...event.node.req.headers,
            authorization: authHeader,
          },
        },
      },
    } as H3Event
    const tempSession = await getUserSession(tempEvent)
    setResponseHeader(event, 'Content-Type', 'application/json')
    if (!tempSession.authenticated) {
      return { error: '用户名或密码错误' }
    }
    const sessionId = generateSessionId()
    sessions.set(sessionId, tempSession)
    setSessionCookie(event, sessionId)
    if (tempSession.isAdmin) {
      return { redirect: '/admin.html' }
    } else {
      return { redirect: '/user.html' }
    }
  }),
)

router.get(
  '/api/players',
  defineEventHandler(async (event) => {
    const session = await getUserSession(event)
    if (!session.authenticated || !session.isAdmin) {
      setResponseStatus(event, 401)
      return
    }
    const players = await getAllPlayers()
    return players
  }),
)

router.get(
  '/api/games',
  defineEventHandler(async (event) => {
    const session = await getUserSession(event)
    if (!session.authenticated || !session.isAdmin) {
      setResponseStatus(event, 401)
      return
    }
    const games = await getAllGames()
    return games
  }),
)

router.get(
  '/api/user/games',
  defineEventHandler(async (event) => {
    const session = await getUserSession(event)
    if (!session.authenticated || session.isAdmin || !session.playerId) {
      setResponseStatus(event, 401)
      return
    }
    const games = await getUserGames(session.playerId)
    return { playerId: session.playerId, games }
  }),
)

router.get(
  '/api/logout',
  defineEventHandler((event) => {
    const sessionId = getSessionId(event)
    if (sessionId) {
      sessions.delete(sessionId)
    }
    setCookie(event, 'session', '', { httpOnly: true, path: '/', maxAge: 0 })
    return sendRedirect(event, '/login.html', 302)
  }),
)

router.put(
  '/api/player/:playerId',
  defineEventHandler(async (event) => {
    const session = await getUserSession(event)
    if (!session.authenticated || !session.isAdmin) {
      setResponseStatus(event, 401)
      return
    }
    const playerId = getRouterParam(event, 'playerId')
    if (!playerId) {
      setResponseStatus(event, 400)
      return { error: 'Missing playerId' }
    }
    const body = await readBody(event)
    await updatePlayer(playerId, body.whitelist, body.remark)
    setResponseStatus(event, 200)
    return 'OK'
  }),
)

router.put(
  '/api/game/:gameId',
  defineEventHandler(async (event) => {
    const session = await getUserSession(event)
    if (!session.authenticated || !session.isAdmin) {
      setResponseStatus(event, 401)
      return
    }
    const gameId = getRouterParam(event, 'gameId')
    if (!gameId) {
      setResponseStatus(event, 400)
      return { error: 'Missing gameId' }
    }
    const body = await readBody(event)
    await updateGame(gameId, body.whitelist, body.remark)
    setResponseStatus(event, 200)
    return 'OK'
  }),
)

router.delete(
  '/api/game/:gameId',
  defineEventHandler(async (event) => {
    const session = await getUserSession(event)
    if (!session.authenticated) {
      setResponseStatus(event, 401)
      return
    }
    const gameId = getRouterParam(event, 'gameId')
    if (!gameId) {
      setResponseStatus(event, 400)
      return { error: 'Missing gameId' }
    }
    if (!session.isAdmin && session.playerId) {
      const createdPlayer = await checkGameDeletePermission(gameId)
      if (!createdPlayer || createdPlayer !== session.playerId) {
        setResponseStatus(event, 403)
        return
      }
    }
    await deleteGame(gameId)
    setResponseStatus(event, 200)
    return 'OK'
  }),
)

export const app = createApp({
  onError: (error, event) => {
    const endTime = Date.now()
    const startTime = event.context.startTime || endTime
    const path = event.node.req.url || ''
    const ip = getHeader(event, 'x-forwarded-for') || event.node.req.socket?.remoteAddress || 'unknown'

    if (error instanceof UncivError) {
      log.with({ ip, t: endTime - startTime, s: error.status })
        .warn(`${event.node.req.method} ${path}`)
        .warn(error.message, error.info)
      setResponseStatus(event, error.status)
      return error.message
    } else if (error instanceof Error) {
      log.with({ ip, t: endTime - startTime, s: 500 })
        .error(`${event.node.req.method} ${path}`)
        .error(error.message)
      setResponseStatus(event, 500)
      return '服务器错误'
    } else {
      log.with({ ip, t: endTime - startTime, s: 500 })
        .error(`${event.node.req.method} ${path}`)
        .error(error)
      setResponseStatus(event, 500)
      return '未知错误'
    }
  },
})

app.use(defineEventHandler((event) => {
  const startTime = Date.now()
  event.context.startTime = startTime
  const path = event.node.req.url || ''
  if (path.startsWith('/files/')) {
    const ua = getHeader(event, 'user-agent')
    if (!ua?.startsWith('Unciv')) {
      throwError(400, '😠', `使用了错误的客户端`)
    }
    const gameId = path.match(/^\/files\/([^\/]+)/)?.[1]
    if (!gameId || !GAME_ID_REGEX.test(gameId)) {
      throwError(400, '😠', `id格式错误`)
    }
  }
}))

app.use(router.handler)

app.use(
  defineEventHandler(async (event) => {
    const url = event.node.req.url || ''
    if (url.endsWith('.html') || url.endsWith('.css') || url.endsWith('.js') || url.endsWith('.ico')) {
      log.debug(`Serving static file: ${url}`)
      return await serveStatic(event, {
        getContents: async (id) => {
          const filePath = `./public${id}`
          try {
            log.debug(`Reading file: ${filePath}`)
            return await Deno.readFile(filePath)
          } catch (error) {
            log.debug(`Failed to read file ${filePath}:`, error)
            return undefined
          }
        },
        getMeta: async (id) => {
          const filePath = `./public${id}`
          try {
            log.debug(`Getting meta for file: ${filePath}`)
            const stats = await Deno.stat(filePath)
            if (!stats.isFile) {
              return undefined
            }
            return {
              size: stats.size,
              mtime: stats.mtime?.getTime() || 0,
            }
          } catch (error) {
            log.debug(`Failed to get meta for file ${filePath}:`, error)
            return undefined
          }
        },
      })
    }
  }),
)

const PORT = +(Deno.env.get('PORT') || 11451)

if (import.meta.main) {
  Deno.serve({
    port: PORT,
    handler: (req, _info) => {
      return toWebHandler(app)(req, {})
    },
  })
}
