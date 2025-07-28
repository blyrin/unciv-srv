import JSZip from 'jszip'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session.authenticated) {
    throw createError({ status: 401, message: '需要认证' })
  }
  const gameId = getRouterParam(event, 'gameId')
  if (!gameId) {
    throw createError({ status: 400, message: '缺少 gameId' })
  }
  if (!session.isAdmin) {
    const playerIds = await getPlayerIdsFromGameId(gameId)
    if (!session.playerId || !playerIds.includes(session.playerId)) {
      throw createError({ status: 403, message: '无权访问此存档' })
    }
  }
  const turnsData = await getAllTurnsForGame(gameId)
  if (turnsData.length === 0) {
    throw createError({ status: 404, message: '未找到存档数据' })
  }
  const zip = new JSZip()
  const rootFolder = zip.folder(`game_${gameId}`)
  for (const turn of turnsData) {
    if (turn.contentData) {
      rootFolder.file(`turn_${turn.turns}`, JSON.stringify(turn.contentData, null, 2))
    }
  }
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  setHeader(event, 'Content-Type', 'application/zip')
  setHeader(event, 'Content-Disposition', `attachment; filename="game-${gameId}.zip"`)
  return zipBuffer
})
