export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session.authenticated || !session.isAdmin) {
    throw createError({ status: 401 })
  }

  const playerId = getRouterParam(event, 'playerId')
  if (!playerId) {
    throw createError({ status: 400, message: 'Player ID is required' })
  }

  const user = await loadUser(playerId)
  if (!user) {
    throw createError({ status: 404, message: 'Player not found' })
  }

  return { password: user.password }
})
