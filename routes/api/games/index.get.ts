export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session.authenticated || !session.isAdmin) {
    throw createError({ status: 401 })
  }
  return getAllGames()
})
