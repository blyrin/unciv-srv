export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session.authenticated || !session.isAdmin) {
    throw createError({ status: 401 })
  }
  const playerId = getRouterParam(event, 'playerId')
  if (!playerId) {
    throw createError({ status: 400, message: 'Missing playerId' })
  }
  const body = await readBody(event)
  await updatePlayer(playerId, body.whitelist, body.remark)
  return {}
})
