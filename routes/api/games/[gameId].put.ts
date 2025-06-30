export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session.authenticated || !session.isAdmin) {
    throw createError({ status: 401 })
  }
  const gameId = getRouterParam(event, 'gameId')
  if (!gameId) {
    throw createError({ status: 400, message: 'Missing gameId' })
  }
  const body = await readBody(event)
  await updateGame(gameId, body.whitelist, body.remark)
  return {}
})
