import { Application, Router } from '@oak/oak'
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
const FILES_STORAGE_PATH = `${DATA_PATH}/files`
const PLAYERS_STORAGE_PATH = `${DATA_PATH}/players`

const mkdirIfNotExist = (path: string) => {
  try {
    Deno.statSync(path)
  } catch {
    Deno.mkdirSync(path, { recursive: true })
  }
}

mkdirIfNotExist(FILES_STORAGE_PATH)
mkdirIfNotExist(PLAYERS_STORAGE_PATH)

const extractAuth = (authHeader?: string | null) => {
  if (!authHeader) return null
  const { 0: type, 1: token } = authHeader.split(' ')
  if (type !== 'Basic') return null
  const { 0: playerId, 1: password } = atob(token).split(':')
  if (!playerId || !password) return null
  return { playerId, password }
}

export enum AuthStatus {
  Valid = 0,
  Invalid = 1,
  Missing = 2,
}

const checkAuth = async (auth?: { playerId: string; password: string } | null) => {
  if (!auth) return AuthStatus.Invalid
  const playerFilePath = `${PLAYERS_STORAGE_PATH}/${auth.playerId}`
  try {
    const storedPassword = await Deno.readTextFile(playerFilePath)
    if (storedPassword === auth.password) {
      return AuthStatus.Valid
    } else {
      return AuthStatus.Invalid
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return AuthStatus.Missing
    }
    return AuthStatus.Invalid
  }
}

const saveAuth = async (auth: { playerId: string; password: string }) => {
  const playerFilePath = `${PLAYERS_STORAGE_PATH}/${auth.playerId}`
  await Deno.writeTextFile(playerFilePath, auth.password, { mode: 0o600 })
}

const router = new Router()

router.get('/', (ctx) => {
  ctx.response.body = 'Unciv Srv'
})

router.all('/isalive', (ctx) => {
  ctx.response.body = { authVersion: 1 }
})

router.get('/auth', async (ctx) => {
  const auth = extractAuth(ctx.request.headers.get('authorization'))
  const authStatus = await checkAuth(auth)
  if (authStatus === AuthStatus.Valid) {
    ctx.response.body = { playerId: auth!.playerId }
  } else if (authStatus === AuthStatus.Invalid) {
    ctx.response.status = 401
    ctx.response.body = { message: 'Unauthorized' }
  } else if (authStatus === AuthStatus.Missing) {
    if (auth!.password.length < 6) {
      ctx.response.status = 400
      ctx.response.body = { message: 'Invalid body' }
      return
    }
    await saveAuth(auth!)
    ctx.response.body = { playerId: auth!.playerId }
  }
})

router.put('/auth', async (ctx) => {
  const auth = extractAuth(ctx.request.headers.get('authorization'))
  const authStatus = await checkAuth(auth)
  if (authStatus !== AuthStatus.Valid) {
    ctx.response.status = 401
    ctx.response.body = { message: 'Unauthorized' }
    return
  }
  const password = await ctx.request.body.text()
  if (password?.length < 6) {
    ctx.response.status = 400
    ctx.response.body = { message: 'Invalid body' }
    return
  }
  await saveAuth({ playerId: auth!.playerId, password })
  ctx.response.body = { playerId: auth!.playerId }
})

router.get('/files/:gameId', async (ctx) => {
  const gameId = ctx.params.gameId
  const filePath = `${FILES_STORAGE_PATH}/${gameId}`
  try {
    ctx.response.body = await Deno.readFile(filePath)
  } catch {
    ctx.response.status = 404
    ctx.response.body = { message: 'File not found' }
  }
})

router.all('/files/:gameId', async (ctx) => {
  const gameId = ctx.params.gameId
  const body = await ctx.request.body.arrayBuffer()
  if (!body.byteLength || body.byteLength > MAX_BODY_SIZE) {
    ctx.response.status = 400
    ctx.response.body = { message: 'Invalid body' }
    return
  }
  const filePath = `${FILES_STORAGE_PATH}/${gameId}`
  const content = new Uint8Array(body)
  await Deno.writeFile(filePath, content, { mode: 0o600 })
  ctx.response.body = content
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
    ctx.response.body = { message: err.message || 'Internal Server Error' }
  }
})

app.use(async (ctx, next) => {
  const path = ctx.request.url.pathname
  if (!path.startsWith('/files/')) {
    return next()
  }
  const authStatus = await checkAuth(extractAuth(ctx.request.headers.get('authorization')))
  if (authStatus !== AuthStatus.Valid) {
    ctx.response.status = 401
    ctx.response.body = { message: 'Unauthorized' }
    return
  }
  const ua = ctx.request.headers.get('user-agent')
  if (!ua?.startsWith('Unciv')) {
    ctx.response.status = 400
    ctx.response.body = { message: 'Invalid user agent' }
    return
  }
  const gameId = path.match(/^\/files\/([^\/]+)/)?.[1]
  if (!gameId || !GAME_ID_REGEX.test(gameId)) {
    ctx.response.status = 400
    ctx.response.body = { message: 'Invalid game id' }
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
