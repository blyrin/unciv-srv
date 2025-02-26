import { decodeBase64, encodeBase64 } from '@std/encoding/base64'
import { sql } from './db.ts'
import { cache } from './cache.ts'
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
  const cacheKey = `file:${gameId}:${col}`
  const cached = await cache.get(cacheKey)
  if (cached) {
    return cached
  }
  const files = await sql`select ${sql([col])}
                          from files
                          where game_id = ${gameId}`
  if (files.length === 0) {
    throwError(404, '找不到存档')
  }
  const encoded = await encodeFile(files[0][col])
  await cache.setEx(cacheKey, 60, encoded)
  return encoded
}

export const getPlayerIdsFromFile = async (gameId: string, column: string): Promise<string[]> => {
  const cacheKey = `playerIds:${gameId}:${column}`
  const cached = await cache.get(cacheKey)
  if (cached) {
    return JSON.parse(cached)
  }
  const file = await sql<{ playerId: string }[]>`
      select jsonb_extract_path(player, 'playerId') AS player_id
      from files,
          jsonb_array_elements(jsonb_extract_path(${sql(column)}, 'gameParameters', 'players')) AS player
      where jsonb_extract_path_text(player, 'playerType') = 'Human'
        and game_id = ${gameId}`
  const playerIds = file.map((f) => f.playerId)
  await cache.set(cacheKey, JSON.stringify(playerIds))
  return playerIds
}

export const saveFile = async (
  playerId: string,
  gameId: string,
  text?: string | null,
  preview = false,
) => {
  const col = preview ? 'preview' : 'content'
  const playerIds = await getPlayerIdsFromFile(gameId, col)
  if (playerIds?.length > 1 && !playerIds.includes(playerId)) {
    throwError(400, '这不是你的存档')
  }
  const colSql = sql(col)
  // deno-lint-ignore no-explicit-any
  const decoded: any = await decodeFile(text)
  await sql`
      insert into files(game_id, ${colSql})
      values (${gameId}, ${decoded})
      on conflict(game_id) do update
          set ${colSql}  = ${decoded},
              updated_at = now()`
  await cache.del(`file:${gameId}:${col}`)
}
