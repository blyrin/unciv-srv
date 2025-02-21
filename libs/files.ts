// deno-lint-ignore-file no-explicit-any
import { decodeBase64, encodeBase64 } from '@std/encoding/base64'
import { sql } from './db.ts'

export const decodeFile = async (file?: string | null): Promise<any> => {
  if (!file) return null
  const blob = new Blob([decodeBase64(file)])
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'))
  const response = new Response(stream)
  return await response.json()
}

export const encodeFile = async (file: any): Promise<string> => {
  const blob = new Blob([JSON.stringify(file)])
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'))
  const response = new Response(stream)
  const buffer = await response.arrayBuffer()
  return encodeBase64(buffer)
}

export const loadFile = async (gameId: string, preview = false): Promise<string> => {
  const col = preview ? 'preview' : 'content'
  const files = await sql`select ${sql([col])}
                          from files
                          where game_id = ${gameId}`
  if (files.length === 0) {
    throw new Error('找不到存档')
  }
  return await encodeFile(files[0][col])
}

export const getPlayerIdsFromFile = async (gameId: string, column: string): Promise<string[]> => {
  const file = await sql`
      select jsonb_extract_path(player, 'playerId') AS player_id
      from files,
           jsonb_array_elements(jsonb_extract_path(${sql(column)}, 'gameParameters', 'players')) as player
      where jsonb_extract_path_text(player, 'playerType') = 'Human'
        and game_id = ${gameId}`
  return file.map((f: any) => f.playerId)
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
    throw new Error('这不是你的存档')
  }
  const colSql = sql(col)
  const decoded = await decodeFile(text)
  await sql`
      insert into files(game_id, ${colSql})
      values (${gameId}, ${decoded})
      on conflict(game_id) do update
          set ${colSql}  = ${decoded},
              updated_at = now()`
}
