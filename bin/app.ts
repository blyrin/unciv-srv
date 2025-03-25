import { Application, Router } from '@oak/oak'
import { log } from '../libs/log.ts'
import { AuthStatus, loadAuth, loadPlayerId, saveAuth } from '../libs/auth.ts'
import { loadFile, saveFile } from '../libs/files.ts'
import { throwError, UncivError } from '../libs/error.ts'

const GAME_ID_REGEX = /^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}(_Preview)?$/
const MAX_BODY_SIZE = 4 * 1024 * 1024

export const router = new Router()

router.get('/', (ctx) => {
  ctx.response.body = 'Unciv Srv'
})

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
    await saveAuth(playerId, password, ip)
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
  await saveAuth(playerId, password, ip)
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
