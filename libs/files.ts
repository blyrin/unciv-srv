import { decodeBase64 } from '@std/encoding/base64'
import { log } from './log.ts'
import { sql } from './db.ts'

export const decodeFile = async (file?: string | null) => {
  if (!file) return null
  try {
    const blob = new Blob([decodeBase64(file)])
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'))
    const response = new Response(stream)
    return await response.json()
  } catch (err) {
    log.error(err)
    return null
  }
}

export const loadFile = async (gameId: string, preview = false): Promise<string> => {
  const col = preview ? 'preview' : 'content'
  const files = await sql`select ${sql([col])}
                          from "files"
                          where "gameId" = ${gameId}`
  if (files.length === 0) {
    throw new Error('找不到存档')
  }
  return files[0][col]
}

export const saveFile = async (
  playerId: string,
  gameId: string,
  text?: string | null,
  preview = false,
) => {
  await sql.begin(async (sql) => {
    const col = preview ? 'preview' : 'content'
    const existsFile = (await sql`select "gameId", "playerIds"
                                  from "files"
                                  where "gameId" = ${gameId}`)[0]
    const exists = !!existsFile
    if (exists) {
      const playerIds: string[] = existsFile.playerIds ?? []
      if (!playerIds.includes(playerId)) {
        throw new Error('这不是你的存档')
      }
      const decoded = await decodeFile(text)
      const newPlayerIds: string[] = decoded?.civilizations
        ?.filter((c?: { playerType: string }) => c?.playerType === 'Human')
        ?.map((c: { playerId: string }) => c.playerId) ?? []
      const data = { playerIds: newPlayerIds, [col]: text, updatedAt: new Date() }
      await sql`update "files"
                set ${sql(data, 'playerIds', col, 'updatedAt')}
                where "gameId" = ${gameId}`
    } else {
      const decoded = await decodeFile(text)
      const playerIds: string[] = decoded?.civilizations
        ?.filter((c?: { playerType: string }) => c?.playerType === 'Human')
        ?.map((c: { playerId: string }) => c.playerId) ?? []
      const data = { gameId, playerIds, [col]: text }
      await sql`insert into "files" ${sql(data, 'gameId', 'playerIds', col)}`
    }
  })
}
