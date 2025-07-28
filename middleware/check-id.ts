export default defineEventHandler(async (event) => {
  const path = event.path
  if (path.startsWith('/files/')) {
    const ua = event.context.ua
    if (!ua?.startsWith('Unciv')) {
      throw createError({
        status: 400,
        message: '😠',
        data: '使用了错误的客户端',
      })
    }
    const gameIdParam = path.match(/^\/files\/([^\/]+)/)?.[1]
    if (!gameIdParam || !GAME_ID_REGEX.test(gameIdParam)) {
      throw createError({
        status: 400,
        message: '😠',
        data: 'id格式错误',
      })
    }
    event.context.playerId = await loadPlayerId(getHeader(event, 'authorization'))
    event.context.gameIdParam = gameIdParam
    const [gameId, preview] = gameIdParam.split('_')
    event.context.gameId = gameId
    event.context.isPreview = !!preview
  }
})
