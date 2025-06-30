export default defineEventHandler(async (event) => {
  await loadPlayerId(getHeader(event, 'authorization'))
  const gameIdParam = getRouterParam(event, 'gameId') || ''
  const [gameId, isPreview] = gameIdParam.split('_')
  return loadFile(gameId, !!isPreview)
})
