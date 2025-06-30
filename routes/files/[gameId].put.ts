export default defineEventHandler(async (event) => {
  const playerId = await loadPlayerId(getHeader(event, 'authorization'))
  const body = await readRawBody(event, 'utf8')
  if (!body || body.length > MAX_BODY_SIZE) {
    throw createError({
      status: 400,
      message: '😠',
      data: '无效的存档',
    })
  }
  const gameIdParam = getRouterParam(event, 'gameId') || ''
  const [gameId, isPreview] = gameIdParam.split('_')
  const ip = event.context.ip
  await saveFile(playerId, gameId, body, !!isPreview, ip)
  return gameId
})
