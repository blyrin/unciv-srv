import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

export const GAME_ID_REGEX = /^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}(_Preview)?$/
export const MAX_BODY_SIZE = 4 * 1024 * 1024

export const decodeFile = async <T = unknown>(file?: string | null): Promise<T | null> => {
  if (!file) return null
  const buffer = Buffer.from(file, 'base64')
  const decompressed = await gunzipAsync(buffer)
  return JSON.parse(decompressed.toString('utf-8'))
}

export const encodeFile = async <T = unknown>(data: T): Promise<string> => {
  const jsonString = JSON.stringify(data)
  const buffer = Buffer.from(jsonString, 'utf-8')
  const compressed = await gzipAsync(buffer)
  return compressed.toString('base64')
}

export const loadFile = async (gameId: string, preview = false): Promise<string> => {
  const sql = db()
  const sp = preview ? 'sp_load_file_preview' : 'sp_load_file_content'
  const [file] = await sql`SELECT * FROM ${sql(sp)} (${gameId})`
  if (!file) {
    throw createError({
      status: 404,
      message: '😠',
      data: `找不到存档 ${gameId}`,
    })
  }
  return await encodeFile(file.data)
}

export const getPlayerIdsFromFile = (decodedFile?: any): string[] => {
  return (
    decodedFile?.gameParameters?.players
      ?.filter?.((player: any) => player.playerType === 'Human')
      ?.map?.((player: any) => player.playerId) ?? []
  )
}

export const saveFile = async (
  playerId: string,
  gameId: string,
  text: string | null | undefined,
  preview = false,
  ip: string
) => {
  let decoded: any
  try {
    decoded = await decodeFile(text)
  } catch (error) {
    throw createError({
      status: 400,
      message: '😠',
      data: `${playerId} 上传的存档 ${gameId} 无法解析`,
      cause: error,
    })
  }
  if (gameId !== decoded.gameId) {
    throw createError({
      status: 400,
      message: '😠',
      data: `${playerId} 上传的存档 ${decoded.gameId} 不是 ${gameId}`,
    })
  }
  const newPlayerIds = getPlayerIdsFromFile(decoded)
  if (!newPlayerIds.includes(playerId)) {
    throw createError({
      status: 400,
      message: '😠',
      data: `${playerId} 试图修改不是自己的存档 ${gameId}`,
    })
  }
  const turns = decoded.turns ?? 0
  const sql = db()
  if (preview) {
    await sql`SELECT sp_save_file_preview(${playerId}, ${gameId}, ${newPlayerIds}, ${turns}, ${decoded}, ${ip})`
  } else {
    await sql`SELECT sp_save_file_content(${playerId}, ${gameId}, ${newPlayerIds}, ${turns}, ${decoded}, ${ip})`
  }
}
