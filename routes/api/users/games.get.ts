export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session.authenticated || session.isAdmin || !session.playerId) {
    throw createError({ status: 401 })
  }
  const games = await getUserGames(session.playerId)
  return { playerId: session.playerId, games }
})
