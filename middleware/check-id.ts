export default defineEventHandler((event) => {
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
    const gameId = path.match(/^\/files\/([^\/]+)/)?.[1]
    if (!gameId || !GAME_ID_REGEX.test(gameId)) {
      throw createError({
        status: 400,
        message: '😠',
        data: 'id格式错误',
      })
    }
  }
})
