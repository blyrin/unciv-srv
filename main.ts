import { Application, Router } from '@oak/oak'
import { LruCache } from '@std/cache'
import { type levellike, Logger } from '@libs/logger'

const GAME_ID_REGEX = /^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}(_Preview)?$/
const MAX_BODY_SIZE = 5 * 1024 * 1024

const PORT = +(Deno.env.get('PORT') || 11451)
const LOG_LEVEL = ['disabled', 'error', 'warn', 'info', 'log', 'debug']
    .includes(Deno.env.get('LOG_LEVEL') || '')
  ? Deno.env.get('LOG_LEVEL') as levellike
  : 'info'

const log = new Logger({
  level: LOG_LEVEL,
  date: true,
  time: true,
  delta: true,
  caller: true,
})

const DATA_PATH = Deno.env.get('DATA_PATH') || './data'
const PLAYERS_STORAGE_PATH = `${DATA_PATH}/players`
const FILES_STORAGE_PATH = `${DATA_PATH}/files`

const mkdirIfNotExist = (path: string) => {
  try {
    Deno.statSync(path)
  } catch {
    Deno.mkdirSync(path, { recursive: true })
  }
}

mkdirIfNotExist(FILES_STORAGE_PATH)
mkdirIfNotExist(PLAYERS_STORAGE_PATH)

export enum AuthStatus {
  Valid = 0,
  Invalid = 1,
  Missing = 2,
}

const authCache = new LruCache<string, { playerId: string; password: string; status: AuthStatus }>(256)

const checkAuth = async (
  authHeader?: string | null,
): Promise<{ playerId: string; password: string; status: AuthStatus }> => {
  if (!authHeader) {
    return { playerId: '', password: '', status: AuthStatus.Invalid }
  }
  if (authCache.has(authHeader)) {
    return authCache.get(authHeader)!
  }
  const { 0: type, 1: token } = authHeader.split(' ')
  if (type !== 'Basic') {
    const value = { playerId: '', password: '', status: AuthStatus.Invalid }
    authCache.set(authHeader, value)
    return value
  }
  const { 0: playerId, 1: password } = atob(token).split(':')
  if (!playerId || !password) {
    const value = { playerId: '', password: '', status: AuthStatus.Invalid }
    authCache.set(authHeader, value)
    return value
  }
  const playerFilePath = `${PLAYERS_STORAGE_PATH}/${playerId}`
  try {
    const storedPassword = await Deno.readTextFile(playerFilePath)
    if (storedPassword === password) {
      const value = { playerId, password, status: AuthStatus.Valid }
      authCache.set(authHeader, value)
      return value
    }
    const value = { playerId: '', password: '', status: AuthStatus.Invalid }
    authCache.set(authHeader, value)
    return value
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      const value = { playerId, password, status: AuthStatus.Missing }
      authCache.set(authHeader, value)
      return value
    }
    const value = { playerId: '', password: '', status: AuthStatus.Invalid }
    authCache.set(authHeader, value)
    return value
  }
}

const saveAuth = async (header: string, auth: { playerId: string; password: string }) => {
  const playerFilePath = `${PLAYERS_STORAGE_PATH}/${auth.playerId}`
  await Deno.writeTextFile(playerFilePath, auth.password, { mode: 0o600 })
  authCache.delete(header)
}

const filesCache = new LruCache<string, Uint8Array>(32)

const loadFile = async (gameId: string): Promise<Uint8Array> => {
  const filePath = `${FILES_STORAGE_PATH}/${gameId}`
  if (filesCache.has(filePath)) {
    return filesCache.get(filePath)!
  }
  const file = await Deno.readFile(filePath)
  filesCache.set(filePath, file)
  return file
}

const saveFile = async (gameId: string, content: Uint8Array) => {
  const filePath = `${FILES_STORAGE_PATH}/${gameId}`
  await Deno.writeFile(filePath, content, { mode: 0o600 })
  filesCache.set(filePath, content)
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
  const { playerId, status } = await checkAuth(header)
  if (status === AuthStatus.Invalid) {
    ctx.response.status = 401
    ctx.response.body = '密码错误'
    return
  }
  if (status === AuthStatus.Missing) {
    const password = await ctx.request.body.text()
    if (password.length < 6) {
      ctx.response.status = 400
      ctx.response.body = '密码太短'
      return
    }
    saveAuth(header!, { playerId, password }).catch(log.error)
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
  saveAuth(header!, { playerId, password }).catch(log.error)
  ctx.response.body = playerId
})

router.get('/files/:gameId', async (ctx) => {
  const gameId = ctx.params.gameId
  try {
    ctx.response.body = await loadFile(gameId)
  } catch {
    ctx.response.status = 404
    ctx.response.body = '找不到存档'
  }
})

router.all('/files/:gameId', async (ctx) => {
  const gameId = ctx.params.gameId
  const body = await ctx.request.body.arrayBuffer()
  if (!body.byteLength || body.byteLength > MAX_BODY_SIZE) {
    ctx.response.status = 400
    ctx.response.body = '存档太大'
    return
  }
  saveFile(gameId, new Uint8Array(body)).catch(log.error)
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
  log.info(`Data store path: ${DATA_PATH}`)
  log.info(`Listening on port: ${PORT}`)
}
