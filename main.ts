import { Application, Router } from '@oak/oak'
import { log } from './libs/log.ts'
import { AuthStatus, checkAuth, saveAuth } from './libs/auth.ts'
import { loadFile, saveFile } from './libs/files.ts'
import { startTask } from './task.ts'
import { cache } from './libs/cache.ts'
import { throwError, UncivError } from './libs/error.ts'

const env = Deno.env

const GAME_ID_REGEX = /^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}(_Preview)?$/
const MAX_BODY_SIZE = 4 * 1024 * 1024

const PORT = +(env.get('PORT') || 11451)

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
    throwError(401, '密码错误')
  }
  if (status === AuthStatus.Missing) {
    if (password.length < 6 || password.length > 128) {
      throwError(400, '密码长度错误')
    }
    await saveAuth(playerId, password)
    ctx.response.body = playerId
    return
  }
  ctx.response.body = playerId
})

router.put('/auth', async (ctx) => {
  const header = ctx.request.headers.get('authorization')
  const { playerId, status } = await checkAuth(header)
  if (status === AuthStatus.Invalid) {
    throwError(401, '密码错误')
  }
  const password = await ctx.request.body.text()
  if (password.length < 6 || password.length > 128) {
    throwError(400, '密码长度错误')
  }
  await saveAuth(playerId, password)
  ctx.response.body = playerId
})

router.get('/files/:gameId', async (ctx) => {
  const { status: authStatus } = await checkAuth(ctx.request.headers.get('authorization'))
  if (authStatus !== AuthStatus.Valid) {
    throwError(401, '密码错误或未设置密码')
  }
  const [gameId, isPreview] = ctx.params.gameId.split('_')
  ctx.response.body = await loadFile(gameId, !!isPreview)
})

router.put('/files/:gameId', async (ctx) => {
  const { status: authStatus, playerId } = await checkAuth(ctx.request.headers.get('authorization'))
  if (authStatus !== AuthStatus.Valid) {
    throwError(401, '密码错误或未设置密码')
  }
  const body = await ctx.request.body.text()
  if (!body || body.length > MAX_BODY_SIZE) {
    throwError(400, '无效的存档')
  }
  const [gameId, isPreview] = ctx.params.gameId.split('_')
  await saveFile(playerId, gameId, body, !!isPreview)
  ctx.response.body = gameId
})

export const app = new Application()

app.use(async (ctx, next) => {
  const startTime = Date.now()
  const path = ctx.request.url.pathname
  try {
    if (path.startsWith('/files/')) {
      const ua = ctx.request.headers.get('user-agent')
      if (!ua?.startsWith('Unciv')) {
        throwError(400, '非法客户端')
      }
      const gameId = path.match(/^\/files\/([^\/]+)/)?.[1]
      if (!gameId || !GAME_ID_REGEX.test(gameId)) {
        throwError(400, '非法游戏ID')
      }
    }
    await next()
    const endTime = Date.now()
    log.with({ t: endTime - startTime, s: ctx.response.status })
      .info(`${ctx.request.method} ${path}`)
  } catch (err: unknown) {
    const endTime = Date.now()
    const l = log.with({ t: endTime - startTime, s: ctx.response.status })
    if (err instanceof UncivError) {
      l.warn(`${ctx.request.method} ${path}`).warn(err.message, err.info)
      ctx.response.status = err.status
      ctx.response.body = err.message
    } else if (err instanceof Error) {
      l.error(`${ctx.request.method} ${path}`).error(err.message)
      ctx.response.status = 500
      ctx.response.body = err.message || '服务器错误'
    } else {
      l.error(`${ctx.request.method} ${path}`).error(err)
      ctx.response.status = 500
      ctx.response.body = '未知错误'
    }
  }
})

app.use(router.routes())
app.use(router.allowedMethods())

if (import.meta.main) {
  const abortController = new AbortController()
  Deno.addSignalListener('SIGINT', async () => {
    log.info('关闭中...')
    abortController.abort()
    await cache.disconnect()
    Deno.exit()
  })
  try {
    await cache.connect()
    log.info(`监听端口: ${PORT}`)
    app.listen({ port: PORT, signal: abortController.signal })
    log.info(`初始化定时清理任务...`)
    await startTask()
  } catch (err) {
    log.error(err)
    Deno.exit()
  }
}
