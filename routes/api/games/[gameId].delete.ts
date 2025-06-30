export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session.authenticated) {
    throw createError({ status: 401 })
  }
  const gameId = getRouterParam(event, 'gameId')
  if (!gameId) {
    throw createError({ status: 400, message: 'Missing gameId' })
  }
  if (!session.isAdmin && session.playerId) {
    const createdPlayer = await checkGameDeletePermission(gameId)
    if (!createdPlayer || createdPlayer !== session.playerId) {
      throw createError({ status: 403 })
    }
  }
  await deleteGame(gameId)
  return {}
})
