// deno-lint-ignore-file no-explicit-any
import { Application, Router } from '@oak/oak'
import { log } from './libs/log.ts'
import { AuthStatus, checkAuth, saveAuth } from './libs/auth.ts'
import { loadFile, saveFile } from './libs/files.ts'
import { startTask } from './task.ts'

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

router.put('/files/:gameId', async (ctx) => {
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
  Deno.addSignalListener('SIGINT', () => {
    log.info('关闭中...')
    Deno.exit()
  })
  log.info(`监听端口: ${PORT}`)
  app.listen({ port: PORT })
  log.info(`初始化定时清理任务...`)
  await startTask()
}
