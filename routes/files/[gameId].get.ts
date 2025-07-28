export default defineEventHandler(async (event) => {
  const gameId = event.context.gameId
  const isPreview = event.context.isPreview
  return loadFile(gameId, isPreview)
})
