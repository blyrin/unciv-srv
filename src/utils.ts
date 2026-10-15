import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { $, Archive, file, gzipSync, gunzipSync, which, write } from 'bun'

export const gameIdRegex = /^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}(_Preview)?$/
export const playerIdRegex = /^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/
/** 存档上传上限，与上游 UncivServer.maxGameFileSizeBytes 保持一致。 */
export const maxBodySize = 32 * 1024 * 1024
/** 普通 JSON 接口（登录、管理后台）的请求体上限。 */
export const maxJsonBodySize = 1024 * 1024
/** 同步回合操作批量提交的请求体上限。 */
export const maxTurnOperationsSize = 4 * 1024 * 1024
/** 纯文本小接口（密码、回合锁）的请求体上限。 */
export const maxTextBodySize = 1024
/** WebSocket 单帧上限，与上游 UncivServer.maxWebSocketFrameSizeBytes 保持一致。 */
export const maxWebSocketFrameSize = 64 * 1024

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

/** 压缩包：系统 zip 不可用时回退 Bun.Archive 的 tar.gz */
export interface ArchiveFile {
  data: Uint8Array
  extension: string
  contentType: string
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
  return new Response(data as BodyInit, {
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
 * 恢复被按 Latin-1 暴露的 UTF-8 请求头文本。
 */
export function decodeHeaderValue(value: string): string {
  const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff)
  const decoded = new TextDecoder().decode(bytes)
  return decoded.includes('\uFFFD') ? value : decoded
}

/**
 * 按代理头和连接信息获取客户端 IP。
 */
export function getClientIP(request: Request, remoteAddress = ''): string {
  const forwardedFor = request.headers.get('X-Forwarded-For')
  if (forwardedFor) {
    const comma = forwardedFor.indexOf(',')
    return normalizeClientIP(comma >= 0 ? forwardedFor.slice(0, comma).trim() : forwardedFor)
  }

  const realIP = request.headers.get('X-Real-IP')
  if (realIP) {
    return normalizeClientIP(realIP)
  }
  return normalizeClientIP(remoteAddress || 'unknown')
}

/**
 * 生成指定长度的会话随机字符串。
 */
export function generateRandomStr(length: number): string {
  const random = crypto.getRandomValues(new Uint8Array(length))
  let result = ''
  for (let index = 0; index < length; index += 1) {
    result += randomCharset[random[index] % randomCharset.length]
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
  const payload = new TextDecoder().decode(Uint8Array.fromBase64(encoded))

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
      throw new HttpError(413, '请求体过大')
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

/**
 * 解码客户端上传的 Base64+Gzip 存档并解析游戏数据。
 */
export function decodeGameFile(encoded: string): { data: string; gameData: GameData } {
  if (encoded === '') {
    throw new Error('空的文件数据')
  }

  const data = new TextDecoder().decode(gunzipSync(Uint8Array.fromBase64(encoded)))
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
  return gzipSync(new TextEncoder().encode(data)).toBase64()
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
 * 用系统 zip 打包，目录内只允许出现本次生成的存档文件。
 */
async function zipWithSystemZip(dir: string, zipPath: string, names: string[]): Promise<boolean> {
  if (!which('zip')) {
    return false
  }
  try {
    const result = await $`zip -q ${zipPath} ${names}`.cwd(dir).quiet().nothrow()
    return result.exitCode === 0
  } catch {
    return false
  }
}

/**
 * 用 PowerShell 的 Compress-Archive 打包（Windows 默认可用）。
 */
async function zipWithPowerShell(dir: string, zipPath: string, names: string[]): Promise<boolean> {
  if (!which('powershell')) {
    return false
  }
  try {
    const paths = names.map((name) => path.join(dir, name))
    const result = await $`powershell -NoProfile -Command Compress-Archive -Path ${paths} -DestinationPath ${zipPath}`
      .quiet()
      .nothrow()
    return result.exitCode === 0 && (await file(zipPath).exists())
  } catch {
    return false
  }
}

/**
 * 用 Bun.Archive 生成 tar.gz，系统 zip 不可用时的回退方案。
 */
export function createTarGz(entries: FileEntry[]): Promise<ArchiveFile> {
  const archive = new Archive(Object.fromEntries(entries.map((entry) => [entry.name, entry.data])), {
    compress: 'gzip',
  })
  return archive.bytes().then((data) => ({ data, extension: 'tar.gz', contentType: 'application/gzip' }))
}

/**
 * 创建历史存档压缩包：优先调用系统 zip / PowerShell Compress-Archive 生成 .zip，
 * 两者都不可用时回退 Bun.Archive 生成 .tar.gz。
 */
export async function createArchive(entries: FileEntry[]): Promise<ArchiveFile> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'unciv-srv-zip-'))
  const names = entries.map((entry) => entry.name)
  try {
    for (const entry of entries) {
      await write(path.join(dir, entry.name), entry.data)
    }
    const zipPath = `${dir}.zip`
    const zipped = process.platform === 'win32'
      ? await zipWithPowerShell(dir, zipPath, names)
      : await zipWithSystemZip(dir, zipPath, names)
    if (zipped) {
      return { data: await file(zipPath).bytes(), extension: 'zip', contentType: 'application/zip' }
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(`${dir}.zip`, { force: true })
  }

  return createTarGz(entries)
}
