// deno-lint-ignore-file no-explicit-any
import { decodeBase64, encodeBase64 } from '@std/encoding/base64'
import { sql } from './db.ts'
import { throwError } from './error.ts'

export const decodeFile = async <T = unknown>(file?: string | null): Promise<T | null> => {
  if (!file) return null
  const blob = new Blob([decodeBase64(file)])
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'))
  const response = new Response(stream)
  return await response.json()
}

export const encodeFile = async <T = unknown>(file: Promise<T | null>): Promise<string> => {
  const blob = new Blob([JSON.stringify(file)])
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'))
  const response = new Response(stream)
  const buffer = await response.arrayBuffer()
  return encodeBase64(buffer)
}

export const loadFile = async (gameId: string, preview = false): Promise<string> => {
  const col = preview ? 'preview' : 'content'
  const files = await sql`
      select ${sql([col])}
      from files
      where game_id = ${gameId}`
  if (files.length === 0) {
    throwError(404, '😠', `找不到存档 ${gameId}`)
  }
  return await encodeFile(files[0][col])
}

export const getPlayerIdsFromFileId = async (gameId: string, column: string): Promise<string[]> => {
  const file = await sql<{ playerId: string }[]>`
      select player ->> 'playerId' AS player_id
      from files,
           jsonb_array_elements(${sql(column)} -> 'gameParameters' -> 'players') AS player
      where player ->> 'playerType' = 'Human'
        and game_id = ${gameId}`
  return file.map((f) => f.playerId)
}

export const getPlayerIdsFromFile = (decodedFile?: any): string[] => {
  return decodedFile?.gameParameters?.players
    ?.filter?.((player: any) => player.playerType === 'Human')
    ?.map?.((player: any) => player.playerId) ?? []
}

export const saveFile = async (
  playerId: string,
  gameId: string,
  text: string | null | undefined,
  preview = false,
  ip: string,
) => {
  const decoded: any = await decodeFile(text)
    .catch(() => throwError(400, '😠', `${playerId} 上传的存档 ${gameId} 无法解析`))
  if (gameId !== decoded.gameId) {
    throwError(400, '😠', `${playerId} 上传的存档 ${decoded.gameId} 不是 ${gameId}`)
  }
  if (!getPlayerIdsFromFile(decoded).includes(playerId)) {
    throwError(400, '😠', `${playerId} 试图修改不是自己的存档 ${gameId}`)
  }
  const col = preview ? 'preview' : 'content'
  await sql.begin(async (sql) => {
    const playerIds = await getPlayerIdsFromFileId(gameId, col)
    if (playerIds?.length > 1 && !playerIds.includes(playerId)) {
      throwError(400, '😠', `${playerId} 试图修改不是自己的存档 ${gameId}`)
    }
    const colSql = sql(col)
    const exists = (await sql`
        select game_id
        from files
        where game_id = ${gameId}
        limit 1`).length > 0
    if (exists) {
      await sql`
          update files
          set ${colSql}  = ${decoded},
              updated_at = now(),
              update_ip  = ${ip}
          where gameId = ${gameId}`
    } else {
      await sql`
          insert into files(game_id, ${colSql}, create_ip, update_ip)
          values (${gameId}, ${decoded}, ${ip}, ${ip})`
    }
  })
}
