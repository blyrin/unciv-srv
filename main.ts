import { Application, Router } from '@oak/oak'
import { type levellike, Logger } from '@libs/logger'
import postgres from 'npm:postgres'

const env = Deno.env

const sql = postgres({
  host: env.get('DB_HOST') || 'localhost',
  port: +(env.get('DB_PORT') || 5432),
  database: env.get('DB_NAME') || 'unciv-srv',
  user: env.get('DB_USER') || 'postgres',
  password: env.get('DB_PASSWORD') || 'postgres',
})

const GAME_ID_REGEX = /^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}(_Preview)?$/
const MAX_BODY_SIZE = 3 * 1024 * 1024

const PORT = +(env.get('PORT') || 11451)
const LOG_LEVEL = ['disabled', 'error', 'warn', 'info', 'log', 'debug']
    .includes(env.get('LOG_LEVEL') || '')
  ? env.get('LOG_LEVEL') as levellike
  : 'info'

const log = new Logger({
  level: LOG_LEVEL,
  date: true,
  time: true,
  delta: true,
  caller: true,
})

enum AuthStatus {
  Valid = 0,
  Invalid = 1,
  Missing = 2,
}

interface Player {
  playerId: string
  password: string
}

interface PlayerWithAuth extends Player {
  status: AuthStatus
}

const checkAuth = async (authHeader?: string | null): Promise<PlayerWithAuth> => {
  if (!authHeader) {
    return { playerId: '', password: '', status: AuthStatus.Invalid }
  }
  const { 0: type, 1: token } = authHeader.split(' ')
  if (type !== 'Basic') {
    return { playerId: '', password: '', status: AuthStatus.Invalid }
  }
  const { 0: playerId, 1: password } = atob(token).split(':')
  if (!playerId || !password) {
    return { playerId: '', password: '', status: AuthStatus.Invalid }
  }
  const players = await sql<Player[]>`select * from "players" where "playerId" = ${playerId}`
  if (players.length === 0) {
    return { playerId, password, status: AuthStatus.Missing }
  }
  if (players[0].password !== password) {
    return { playerId: '', password: '', status: AuthStatus.Invalid }
  }
  return { playerId, password, status: AuthStatus.Valid }
}

const saveAuth = async (playerId: string, password: string) => {
  const data = { playerId, password }
  await sql`insert into "players" ${
          sql(data, 'playerId', 'password')
  } on conflict("playerId") do
            update
            set "password" = ${password}, "updatedAt" = now()`
}

const loadFile = async (gameId: string, preview = false): Promise<string> => {
  const col = preview ? 'preview' : 'content'
  const files = await sql`select ${sql([col])} from "files" where "gameId" = ${gameId}`
  if (files.length === 0) {
    throw new Error('找不到存档')
  }
  return files[0][col]
}

const saveFile = async (gameId: string, text?: string | null, preview = false) => {
  const col = preview ? 'preview' :'content'
  const data = { gameId, [col]: text }
  await sql`insert into "files" ${
    sql(data, 'gameId', col)
  } on conflict ("gameId") do update set ${sql(col)} = ${text}, "updatedAt" = now()`
}

const router = new Router()

router.get('/', (ctx) => {
  ctx.response.body = 'Unciv Srv'
})

router.all('/isalive', (ctx) => {
  ctx.response.body = { authVersion: 1 }
})

router.get('/auth', async (ctx) => {
  const header = ctx.request.headers.get('authorization')
  const { playerId, password, status } = await checkAuth(header)
  if (status === AuthStatus.Invalid) {
    ctx.response.status = 401
    ctx.response.body = '密码错误'
    return
  }
  if (status === AuthStatus.Missing) {
    if (password.length < 6) {
      ctx.response.status = 400
      ctx.response.body = '密码太短'
      return
    }
    if (password.length > 128) {
      ctx.response.status = 400
      ctx.response.body = '密码太长'
      return
    }
    await saveAuth(playerId, password).catch(log.error)
    ctx.response.body = playerId
    return
  }
  ctx.response.body = playerId
})

router.put('/auth', async (ctx) => {
  const header = ctx.request.headers.get('authorization')
  const { playerId, status } = await checkAuth(header)
  if (status === AuthStatus.Invalid) {
    ctx.response.status = 401
    ctx.response.body = '密码错误'
    return
  }
  const password = await ctx.request.body.text()
  if (password.length < 6) {
    ctx.response.status = 400
    ctx.response.body = '密码太短'
    return
  }
  await saveAuth(playerId, password)
  ctx.response.body = playerId
})

router.get('/files/:gameId', async (ctx) => {
  const [gameId, isPreview] = ctx.params.gameId.split('_')
  try {
    ctx.response.body = await loadFile(gameId, !!isPreview)
  } catch {
    ctx.response.status = 404
    ctx.response.body = '找不到存档'
  }
})

router.all('/files/:gameId', async (ctx) => {
  const body = await ctx.request.body.text()
  if (!body.length || body.length > MAX_BODY_SIZE) {
    ctx.response.status = 400
    ctx.response.body = '存档太大'
    return
  }
  const [gameId, isPreview] = ctx.params.gameId.split('_')
  await saveFile(gameId, body, !!isPreview)
  ctx.response.body = gameId
})

export const app = new Application()

app.use(async (ctx, next) => {
  try {
    await next()
    log.info(ctx.request.method, ctx.request.url.pathname, ctx.response.status)
    // deno-lint-ignore no-explicit-any
  } catch (err: any) {
    log.error(err)
    ctx.response.status = err.status || 500
    ctx.response.body = err.message || '内部服务器错误'
  }
})

app.use(async (ctx, next) => {
  const path = ctx.request.url.pathname
  if (!path.startsWith('/files/')) {
    return next()
  }
  const { status: authStatus } = await checkAuth(ctx.request.headers.get('authorization'))
  if (authStatus === AuthStatus.Invalid) {
    ctx.response.status = 401
    ctx.response.body = '密码错误'
    return
  } else if (authStatus === AuthStatus.Missing) {
    ctx.response.status = 401
    ctx.response.body = '请设置密码'
    return
  }
  const ua = ctx.request.headers.get('user-agent')
  if (!ua?.startsWith('Unciv')) {
    ctx.response.status = 400
    ctx.response.body = '非法客户端'
    return
  }
  const gameId = path.match(/^\/files\/([^\/]+)/)?.[1]
  if (!gameId || !GAME_ID_REGEX.test(gameId)) {
    ctx.response.status = 400
    ctx.response.body = '非法游戏ID'
    return
  }
  return next()
})

app.use(router.routes())
app.use(router.allowedMethods())

if (import.meta.main) {
  app.listen({ port: PORT })
  log.info(`Listening on port: ${PORT}`)
}
