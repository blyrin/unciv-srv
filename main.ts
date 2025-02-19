// deno-lint-ignore-file no-explicit-any
import { Application, Router } from '@oak/oak'
import { type levellike, Logger } from '@libs/logger'
import { decodeBase64 } from '@std/encoding/base64'
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
const MAX_BODY_SIZE = 4 * 1024 * 1024

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
  await sql`insert into "players" ${sql(data, 'playerId', 'password')} on conflict("playerId") do
            update
            set "password" = ${password}, "updatedAt" = now()`
}

const decodeFile = async (file?: string | null) => {
  if (!file) return null
  try {
    const blob = new Blob([decodeBase64(file)])
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'))
    const response = new Response(stream)
    return await response.json()
  } catch (err) {
    log.error(err)
    return null
  }
}

const loadFile = async (gameId: string, preview = false): Promise<string> => {
  const col = preview ? 'preview' : 'content'
  const files = await sql`select ${sql([col])} from "files" where "gameId" = ${gameId}`
  if (files.length === 0) {
    throw new Error('找不到存档')
  }
  return files[0][col]
}

const saveFile = async (
  playerId: string,
  gameId: string,
  text?: string | null,
  preview = false,
) => {
  await sql.begin(async (sql) => {
    const col = preview ? 'preview' : 'content'
    const existsFile = (await sql`select "gameId", "playerIds" from "files" where "gameId" = ${gameId}`)[0]
    const exists = !!existsFile
    if (exists) {
      const playerIds: string[] = existsFile.playerIds ?? []
      if (!playerIds.includes(playerId)) {
        throw new Error('这不是你的存档')
      }
      const decoded = await decodeFile(text)
      const newPlayerIds: string[] = decoded?.civilizations
        ?.filter((c?: { playerType: string }) => c?.playerType === 'Human')
        ?.map((c: { playerId: string }) => c.playerId) ?? []
      const data = { playerIds: newPlayerIds, [col]: text, updatedAt: new Date() }
      await sql`update "files"
                set ${sql(data, 'playerIds', col, 'updatedAt')}
                where "gameId" = ${gameId}`
    } else {
      const decoded = await decodeFile(text)
      const playerIds: string[] = decoded?.civilizations
        ?.filter((c?: { playerType: string }) => c?.playerType === 'Human')
        ?.map((c: { playerId: string }) => c.playerId) ?? []
      const data = { gameId, playerIds, [col]: text }
      await sql`insert into "files" ${sql(data, 'gameId', 'playerIds', col)}`
    }
  })
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
    if (password.length < 6 || password.length > 128) {
      ctx.response.status = 400
      ctx.response.body = '密码长度错误'
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
  if (password.length < 6 || password.length > 128) {
    ctx.response.status = 400
    ctx.response.body = '密码长度错误'
    return
  }
  await saveAuth(playerId, password)
  ctx.response.body = playerId
})

router.get('/files/:gameId', async (ctx) => {
  const { status: authStatus, playerId } = await checkAuth(ctx.request.headers.get('authorization'))
  log.info('playerId', playerId)
  if (authStatus !== AuthStatus.Valid) {
    ctx.response.status = 401
    ctx.response.body = '密码错误或未设置密码'
    return
  }
  const [gameId, isPreview] = ctx.params.gameId.split('_')
  try {
    ctx.response.body = await loadFile(gameId, !!isPreview)
  } catch {
    ctx.response.status = 404
    ctx.response.body = '找不到存档'
  }
})

router.all('/files/:gameId', async (ctx) => {
  const { status: authStatus, playerId } = await checkAuth(ctx.request.headers.get('authorization'))
  log.info('playerId', playerId)
  if (authStatus !== AuthStatus.Valid) {
    ctx.response.status = 401
    ctx.response.body = '密码错误或未设置密码'
    return
  }
  const body = await ctx.request.body.text()
  if (!body || body.length > MAX_BODY_SIZE) {
    ctx.response.status = 400
    ctx.response.body = '无内容或存档体积过大'
    return
  }
  const [gameId, isPreview] = ctx.params.gameId.split('_')
  await saveFile(playerId, gameId, body, !!isPreview)
  ctx.response.body = gameId
})

export const app = new Application()

app.use(async (ctx, next) => {
  try {
    await next()
    log.info(ctx.request.method, ctx.request.url.pathname, ctx.response.status)
  } catch (err: any) {
    log.error(err)
    ctx.response.status = err.status || 500
    ctx.response.body = err.message || '内部服务器错误'
  }
})

app.use((ctx, next) => {
  const path = ctx.request.url.pathname
  if (!path.startsWith('/files/')) {
    return next()
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
