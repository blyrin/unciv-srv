import path from 'node:path'
import { deflateSync, gzipSync, gunzipSync, hash } from 'bun'

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

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
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

export interface ArchiveFile {
  data: Uint8Array
  extension: string
  contentType: string
}

/**
 * 返回标准 JSON 响应。
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status })
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
  return Response.json({ type: 'error', message }, { status })
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
  const decoded = Buffer.from(value, 'latin1').toString('utf8')
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
  return crypto.randomUUID().replace(/-/g, '').slice(0, length)
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

/** 读取请求体并限制最大字节数：有 Content-Length 时先按声明值拒绝超限请求，否则流式累加。 */
export async function readLimitedText(request: Request, maxBytes = maxBodySize): Promise<string> {
  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declaredLength)) {
    if (declaredLength > maxBytes) {
      throw new HttpError(413, '请求体过大')
    }
    if (declaredLength > 0) {
      return await request.text()
    }
    return ''
  }

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
 * 按 3 字节对齐切块转 Base64：边界落在 3 的倍数上时，各块的 Base64 直接拼接
 * 就等于整块 toBase64()，不足 3 字节的尾块由 toBase64 自行补 '='。
 */
function base64ChunkStream(): TransformStream<Uint8Array, Uint8Array> {
  let tail = new Uint8Array(0)
  const encoder = new TextEncoder()
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const merged = new Uint8Array(tail.length + chunk.length)
      merged.set(tail)
      merged.set(chunk, tail.length)
      const aligned = merged.length - (merged.length % 3)
      if (aligned > 0) {
        controller.enqueue(encoder.encode(merged.subarray(0, aligned).toBase64()))
      }
      tail = merged.slice(aligned)
    },
    flush(controller) {
      if (tail.length > 0) {
        controller.enqueue(encoder.encode(tail.toBase64()))
      }
    },
  })
}

/**
 * 返回 Base64+Gzip 存档响应
 */
export function encodedFileResponse(data: string): Response {
  const raw = new TextEncoder().encode(data)
  const body = new Response(raw).body
  if (body == null) {
    throw new Error('无法创建响应体流')
  }
  const encoded = body.pipeThrough(new CompressionStream('gzip')).pipeThrough(base64ChunkStream())
  return new Response(encoded, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
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

/** ZIP 三种记录头的签名 */
const zipSignatures = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50 }
/** 通用标志位：文件名按 UTF-8 编码 */
const zipUtf8Flag = 0x0800
/** 压缩方法：0 存储、8 deflate */
const zipMethod = { store: 0, deflate: 8 }
/** 所需版本：2.0（支持 deflate） */
const zipVersion = 20
/** DOS 日期下限 1980-01-01，留空会被部分解压工具判为无效日期 */
const zipDosDate = 0x0021
/** 本地文件头 / 中央目录 / 中央目录结尾的固定长度 */
const zipHeaderSize = { local: 30, central: 46, end: 22 }

const zip16Limit = 0xffff
const zip32Limit = 0xffffffff

interface ZipEntry {
  name: Uint8Array
  payload: Uint8Array
  rawSize: number
  crc: number
  method: number
  offset: number
}

/** ZIP 字段上限校验：超限时快速失败，不生成损坏的归档 */
function assertZipLimit(value: number, limit: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) {
    throw new Error(`ZIP ${field}超出格式上限`)
  }
}

/**
 * 用 Bun 原生 deflate 与 crc32 生成标准 ZIP32。
 */
function createZip(entries: FileEntry[]): Uint8Array {
  assertZipLimit(entries.length, zip16Limit, '文件数量')

  const encoder = new TextEncoder()
  const prepared: ZipEntry[] = []
  let localSize = 0
  let centralSize = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const raw = encoder.encode(entry.data)
    assertZipLimit(name.length, zip16Limit, '文件名长度')
    assertZipLimit(raw.length, zip32Limit, '文件大小')

    const deflated = raw.length === 0 ? raw : deflateSync(raw, { level: 6 })
    const useDeflate = deflated.length < raw.length
    const payload = useDeflate ? deflated : raw
    assertZipLimit(payload.length, zip32Limit, '压缩后大小')

    prepared.push({
      name,
      payload,
      rawSize: raw.length,
      crc: hash.crc32(raw) >>> 0,
      method: useDeflate ? zipMethod.deflate : zipMethod.store,
      offset: localSize,
    })
    localSize += zipHeaderSize.local + name.length + payload.length
    centralSize += zipHeaderSize.central + name.length
  }

  assertZipLimit(localSize, zip32Limit, '文件区大小')
  assertZipLimit(centralSize, zip32Limit, '中央目录大小')
  const totalSize = localSize + centralSize + zipHeaderSize.end
  assertZipLimit(totalSize, zip32Limit, '归档大小')

  // 只分配一次，按偏移直接写入，省去中间数组与合并复制
  const zip = new Uint8Array(totalSize)
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let position = 0

  for (const file of prepared) {
    view.setUint32(position, zipSignatures.local, true)
    view.setUint16(position + 4, zipVersion, true)
    view.setUint16(position + 6, zipUtf8Flag, true)
    view.setUint16(position + 8, file.method, true)
    view.setUint16(position + 10, 0, true)
    view.setUint16(position + 12, zipDosDate, true)
    view.setUint32(position + 14, file.crc, true)
    view.setUint32(position + 18, file.payload.length, true)
    view.setUint32(position + 22, file.rawSize, true)
    view.setUint16(position + 26, file.name.length, true)
    zip.set(file.name, position + zipHeaderSize.local)
    position += zipHeaderSize.local + file.name.length
    zip.set(file.payload, position)
    position += file.payload.length
  }

  const centralOffset = position
  for (const file of prepared) {
    view.setUint32(position, zipSignatures.central, true)
    view.setUint16(position + 4, zipVersion, true)
    view.setUint16(position + 6, zipVersion, true)
    view.setUint16(position + 8, zipUtf8Flag, true)
    view.setUint16(position + 10, file.method, true)
    view.setUint16(position + 12, 0, true)
    view.setUint16(position + 14, zipDosDate, true)
    view.setUint32(position + 16, file.crc, true)
    view.setUint32(position + 20, file.payload.length, true)
    view.setUint32(position + 24, file.rawSize, true)
    view.setUint16(position + 28, file.name.length, true)
    view.setUint32(position + 42, file.offset, true)
    zip.set(file.name, position + zipHeaderSize.central)
    position += zipHeaderSize.central + file.name.length
  }

  view.setUint32(position, zipSignatures.end, true)
  view.setUint16(position + 8, entries.length, true)
  view.setUint16(position + 10, entries.length, true)
  view.setUint32(position + 12, position - centralOffset, true)
  view.setUint32(position + 16, centralOffset, true)

  return zip
}

/** 创建历史存档压缩包：进程内直接生成 .zip。 */
export function createArchive(entries: FileEntry[]): ArchiveFile {
  return { data: createZip(entries), extension: 'zip', contentType: 'application/zip' }
}

export const projectRoot = path.resolve(import.meta.dir, '..')

/**
 * 将相对路径固定到仓库根目录。
 */
export function resolveRepoPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value)
}
