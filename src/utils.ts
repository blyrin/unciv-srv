import { gunzipSync, gzipSync } from 'node:zlib'
import { randomInt } from 'node:crypto'
import { zipSync } from 'fflate'
import type { Context } from 'hono'

export const gameIdRegex = /^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}(_Preview)?$/
export const playerIdRegex = /^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/
export const maxBodySize = 10 * 1024 * 1024

const randomCharset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface BasicCredentials {
  playerId: string
  password: string
}

export interface GameData {
  gameId: string
  turns: number
  gameParameters?: {
    players?: Array<{
      playerId?: string
      playerType?: string
    }>
  }
}

export interface FileEntry {
  name: string
  data: string
}

interface NodeServerEnv {
  incoming?: {
    socket?: {
      remoteAddress?: string
    }
  }
}

/**
 * 返回标准 JSON 响应。
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(data)}\n`, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

/**
 * 返回纯文本响应。
 */
export function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}

/**
 * 返回统一错误响应。
 */
export function errorResponse(status: number, message: string): Response {
  return jsonResponse({ type: 'error', message }, status)
}

/**
 * 返回无内容成功响应。
 */
export function successResponse(): Response {
  return new Response(null, { status: 204 })
}

/**
 * 返回下载文件响应。
 */
export function fileResponse(contentType: string, filename: string, data: Uint8Array | string): Response {
  const body = typeof data === 'string' ? data : Buffer.from(data)
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename=${filename}`,
    },
  })
}

/**
 * 将 IPv4 映射的 IPv6 地址转换为普通 IPv4 地址。
 */
export function normalizeClientIP(ip: string): string {
  return ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip
}

/**
 * 恢复被 Node 按 Latin-1 暴露的 UTF-8 请求头文本。
 */
export function decodeHeaderValue(value: string): string {
  const decoded = Buffer.from(value, 'latin1').toString('utf8')
  return decoded.includes('\uFFFD') ? value : decoded
}

/**
 * 按代理头和连接信息获取客户端 IP。
 */
export function getClientIP(input: Request | Context, remoteAddress = ''): string {
  const request = input instanceof Request ? input : input.req.raw
  const forwardedFor = request.headers.get('X-Forwarded-For')
  if (forwardedFor) {
    const comma = forwardedFor.indexOf(',')
    return normalizeClientIP(comma >= 0 ? forwardedFor.slice(0, comma).trim() : forwardedFor)
  }

  const realIP = request.headers.get('X-Real-IP')
  if (realIP) {
    return normalizeClientIP(realIP)
  }

  if (!remoteAddress && !(input instanceof Request)) {
    remoteAddress = ((input.env as NodeServerEnv | undefined)?.incoming?.socket?.remoteAddress ?? '')
  }
  return normalizeClientIP(remoteAddress || 'unknown')
}

/**
 * 生成指定长度的会话随机字符串。
 */
export function generateRandomStr(length: number): string {
  let result = ''
  for (let i = 0; i < length; i += 1) {
    result += randomCharset[randomInt(randomCharset.length)]
  }
  return result
}

/**
 * 解析并验证 Basic Auth 凭证。
 */
export function parseBasicAuthCredentials(header: string | null | undefined): BasicCredentials {
  if (!header) {
    throw new HttpError(401, '需要认证')
  }
  if (!header.startsWith('Basic ')) {
    throw new HttpError(401, '无效的认证格式')
  }

  const encoded = header.slice(6)
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new HttpError(401, '无效的认证数据')
  }
  const payload = Buffer.from(encoded, 'base64').toString('utf8')

  const colon = payload.indexOf(':')
  if (colon < 0) {
    throw new HttpError(401, '无效的认证格式')
  }

  const playerId = payload.slice(0, colon).trim()
  const password = payload.slice(colon + 1).trim()
  if (!validatePlayerID(playerId)) {
    throw new HttpError(401, '无效的玩家ID格式')
  }
  if (password.length < 6) {
    throw new HttpError(401, '密码至少6位')
  }

  return { playerId, password }
}

/**
 * 读取请求体并限制最大字节数。
 */
export async function readLimitedText(request: Request, maxBytes = maxBodySize): Promise<string> {
  if (!request.body) {
    return ''
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    total += value.byteLength
    if (total > maxBytes) {
      throw new HttpError(400, '读取请求体失败')
    }
    chunks.push(value)
  }

  return Buffer.concat(chunks).toString('utf8')
}

/**
 * 解码客户端上传的 Base64+Gzip 存档并解析游戏数据。
 */
export function decodeGameFile(encoded: string): { data: string; gameData: GameData } {
  if (encoded === '') {
    throw new Error('空的文件数据')
  }

  const compressed = Buffer.from(encoded, 'base64')
  const data = gunzipSync(compressed).toString('utf8')
  return { data, gameData: parseGameData(data) }
}

/**
 * 解码客户端上传的 Base64+Gzip 存档。
 */
export function decodeFile(encoded: string): string {
  return decodeGameFile(encoded).data
}

/**
 * 将 JSON 存档编码为客户端需要的 Base64+Gzip 格式。
 */
export function encodeFile(data: string): string {
  return gzipSync(Buffer.from(data)).toString('base64')
}

/**
 * 解析存档中的关键游戏字段。
 */
export function parseGameData(data: string): GameData {
  const gameData = JSON.parse(data) as Omit<GameData, 'turns'> & { turns?: unknown }
  const turns = gameData.turns === undefined ? 0 : gameData.turns
  if (!Number.isInteger(turns) || (turns as number) < 0) {
    throw new Error('无效的回合数')
  }
  return { ...gameData, turns: turns as number }
}

/**
 * 提取已解析存档中的人类玩家 ID。
 */
export function getPlayerIDsFromParsedGameData(gameData: GameData): string[] {
  const players = gameData.gameParameters?.players ?? []
  return players
    .filter((player) => player.playerType === 'Human' && player.playerId)
    .map((player) => player.playerId as string)
}

/**
 * 提取存档中的人类玩家 ID。
 */
export function getPlayerIDsFromGameData(data: string): string[] {
  return getPlayerIDsFromParsedGameData(parseGameData(data))
}

/**
 * 验证游戏 ID 格式。
 */
export function validateGameID(gameId: string): boolean {
  return gameIdRegex.test(gameId)
}

/**
 * 验证玩家 ID 格式。
 */
export function validatePlayerID(playerId: string): boolean {
  return playerIdRegex.test(playerId)
}

/**
 * 判断游戏 ID 是否为预览 ID。
 */
export function isPreviewID(gameId: string): boolean {
  return gameId.length > '_Preview'.length && gameId.endsWith('_Preview')
}

/**
 * 去除预览 ID 后缀。
 */
export function getBaseGameID(gameId: string): string {
  return gameId.endsWith('_Preview') ? gameId.slice(0, -'_Preview'.length) : gameId
}

/**
 * 创建历史存档 ZIP 数据。
 */
export function createZip(entries: FileEntry[]): Uint8Array {
  return zipSync(Object.fromEntries(entries.map((entry) => [entry.name, Buffer.from(entry.data)])))
}
