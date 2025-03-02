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
  const tableSql = sql(preview ? 'files_preview' : 'files_content')
  const files = await sql`
      select data
      from ${tableSql}
      where game_id = ${gameId}
      order by created_at desc, turns desc
      limit 1`
  if (files.length === 0) {
    throwError(404, '😠', `找不到存档 ${gameId}`)
  }
  return await encodeFile(files[0].data)
}

export const getPlayerIdsFromGameId = async (gameId: string): Promise<string[]> => {
  const file = await sql<{ playerId: string }[]>`
      select distinct player_id
      from files,
           jsonb_array_elements(files.players) AS player_id
      where game_id = ${gameId}`
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
  const newPlayerIds = getPlayerIdsFromFile(decoded)
  if (!newPlayerIds.includes(playerId)) {
    throwError(400, '😠', `${playerId} 试图修改不是自己的存档 ${gameId}`)
  }
  await sql.begin(async (sql) => {
    const playerIds = await getPlayerIdsFromGameId(gameId)
    if (playerIds?.length > 1 && !playerIds.includes(playerId)) {
      throwError(400, '😠', `${playerId} 试图修改不是自己的存档 ${gameId}`)
    }
    await sql`
        insert into files(game_id, players)
        values (${gameId}, ${newPlayerIds})
        on conflict(game_id) do update
            set updated_at = now(),
                players    = ${newPlayerIds}`
    const turns = decoded.turns ?? 0
    if (preview) {
      await sql`
          insert into files_preview(game_id, turns, data, created_player, created_ip)
          values (${gameId}, ${turns}, ${decoded}, ${playerId}, ${ip})`
    } else {
      await sql`
          insert into files_content(game_id, turns, data, created_player, created_ip)
          values (${gameId}, ${turns}, ${decoded}, ${playerId}, ${ip})`
    }
  })
}
