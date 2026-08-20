import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import type { Config, AppVariables } from './types.js'
import { getSession, parseCookie, sessionCookieName } from './session.js'
import {
  decodeHeaderValue, errorResponse, getClientIP, HttpError, jsonResponse, parseBasicAuthCredentials,
} from './utils.js'

/**
 * 安装包托管（CN 官方下载服务器）。
 *
 * 客户端把 GitHub release 的安装包下载 URL 映射为 `<server>/dl/<版本tag>/<文件名>`，
 * 由本模块从本地目录流式提供文件，并施加下载保护：
 * - 全局并发连接数限制（防带宽被打满）
 * - 单连接限速（防单用户占满带宽）
 * - 每 IP 每分钟请求数限制（防刷流量）
 * - 版本号/文件名校验与路径穿越防护
 *
 * 文件由 CI 或管理后台通过 `POST /api/downloads/upload` 上传（管理员认证），
 * 目录结构为 `<DOWNLOAD_DIR>/<版本tag>/<文件名>`。
 */

type Env = { Variables: AppVariables }

/** 版本号：数字段 + 可选 -patchN 后缀（与游戏内 release tag 格式一致） */
const versionTagRegex = /^\d{1,3}(\.\d{1,3}){2}(\.\d{1,3})?(-patch\d{1,3})?$/
const fileNameRegex = /^[^/\\]{1,128}$/

/** 并发信号量：控制同时进行的下载/上传数量 */
class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.max <= 0) return
    if (this.active < this.max) {
      this.active += 1
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
  }

  release(): void {
    const next = this.waiters.shift()
    if (next) {
      next()
    } else {
      this.active -= 1
    }
  }
}

/** 每 IP 滑动窗口频率限制 */
class IpRateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(private readonly maxPerMinute: number) {}

  allow(ip: string): boolean {
    if (this.maxPerMinute <= 0) return true
    const now = Date.now()
    const windowStart = now - 60_000
    const recent = (this.hits.get(ip) ?? []).filter((time) => time > windowStart)
    if (recent.length >= this.maxPerMinute) {
      this.hits.set(ip, recent)
      return false
    }
    recent.push(now)
    this.hits.set(ip, recent)
    return true
  }
}

/** 校验版本 tag 与文件名，返回安全的文件绝对路径；非法时返回 null */
function safeDownloadPath(baseDir: string, tag: string, filename: string): string | null {
  if (!versionTagRegex.test(tag) || !fileNameRegex.test(filename)) return null
  if (tag.includes('..') || filename.includes('..')) return null
  const resolvedBase = path.resolve(baseDir)
  const full = path.resolve(resolvedBase, tag, filename)
  if (full !== resolvedBase && !full.startsWith(`${resolvedBase}${path.sep}`)) return null
  return full
}

/** 解析 Range 请求头（支持 bytes=start-end、bytes=start-、bytes=-suffix） */
function parseRange(header: string | undefined, fileSize: number): { start: number; end: number } | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const startText = match[1]
  const endText = match[2]
  if (startText === '' && endText === '') return null

  let start: number
  let end: number
  if (startText === '') {
    // 末尾后缀范围：bytes=-N 表示最后 N 字节
    const suffix = Number.parseInt(endText, 10)
    if (suffix <= 0) return null
    start = Math.max(fileSize - suffix, 0)
    end = fileSize - 1
  } else {
    start = Number.parseInt(startText, 10)
    end = endText === '' ? fileSize - 1 : Number.parseInt(endText, 10)
  }
  if (start >= fileSize || start > end) return null
  end = Math.min(end, fileSize - 1)
  return { start, end }
}

function contentTypeFor(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case '.apk': return 'application/vnd.android.package-archive'
    case '.zip': return 'application/zip'
    case '.jar': return 'application/java-archive'
    case '.msi': return 'application/x-msi'
    case '.vsix': return 'application/vsix'
    case '.json': return 'application/json'
    case '.gz': return 'application/gzip'
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    default: return 'application/octet-stream'
  }
}

/** 限速 Transform：每块数据延迟发送，使吞吐量约等于 bytesPerSecond */
function throttleTransform(bytesPerSecond: number): Transform {
  if (bytesPerSecond <= 0) {
    return new Transform({
      transform(chunk, _encoding, callback) {
        callback(null, chunk)
      },
    })
  }
  return new Transform({
    transform(chunk, _encoding, callback) {
      const delayMs = Math.max(1, Math.round((chunk.length / bytesPerSecond) * 1000))
      setTimeout(() => callback(null, chunk), delayMs)
    },
  })
}

/**
 * 管理认证：优先验证 Web 后台登录会话（session），其次验证管理员 Basic Auth
 * （供 CI 等无 cookie 场景使用）。两路都失败返回 401。
 */
function adminAuth(config: Config): MiddlewareHandler<Env> {
  return async (c, next) => {
    const cookies = parseCookie(c.req.header('Cookie'))
    const sessionId = cookies[sessionCookieName]
    if (sessionId) {
      const session = getSession(sessionId)
      if (session?.isAdmin) {
        await next()
        return
      }
    }

    try {
      // 管理员凭证不走玩家 UUID 校验，独立解析 Basic Auth
      const header = c.req.header('Authorization')
      if (header?.startsWith('Basic ')) {
        const payload = Buffer.from(header.slice(6), 'base64').toString('utf8')
        const colon = payload.indexOf(':')
        if (colon >= 0) {
          const username = payload.slice(0, colon)
          const password = payload.slice(colon + 1)
          if (username === config.adminUsername && password === config.adminPassword) {
            await next()
            return
          }
        }
      }
    } catch {
      // 非法 Basic Auth 头，按未认证处理
    }
    return errorResponse(401, '需要管理员认证')
  }
}

/** 递归列出托管目录下所有文件 */
async function listDownloadedFiles(baseDir: string): Promise<Array<{
  tag: string
  filename: string
  size: number
  mtime: number
}>> {  const result: Array<{ tag: string; filename: string; size: number; mtime: number }> = []
  let entries
  try {
    entries = await fs.promises.readdir(baseDir, { withFileTypes: true })
  } catch {
    return result
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!versionTagRegex.test(entry.name)) continue
    let files
    try {
      files = await fs.promises.readdir(path.join(baseDir, entry.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.isFile() || !fileNameRegex.test(file.name)) continue
      try {
        const stat = await fs.promises.stat(path.join(baseDir, entry.name, file.name))
        result.push({ tag: entry.name, filename: file.name, size: stat.size, mtime: stat.mtimeMs })
      } catch {
        // 文件可能在上传中，跳过
      }
    }
  }
  result.sort((a, b) => b.tag.localeCompare(a.tag) || a.filename.localeCompare(b.filename))
  return result
}

/** 提取版本号中的数字段（4.21.10.1 / 4.21.10-patch2 均按数字段比较） */
function versionSegments(tag: string): number[] {
  return tag.match(/\d+/g)?.map(Number) ?? []
}

/** 比较两个版本 tag，返回 >0 表示 a 更新 */
function compareVersionTags(a: string, b: string): number {
  const aSegments = versionSegments(a)
  const bSegments = versionSegments(b)
  const length = Math.max(aSegments.length, bSegments.length)
  for (let i = 0; i < length; i += 1) {
    const diff = (aSegments[i] ?? 0) - (bSegments[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** 上传新版本后清理旧版本目录，只保留最新的 [keepCount] 个版本（节约存储空间） */
async function cleanupOldVersions(baseDir: string, keepCount: number): Promise<void> {
  if (keepCount <= 0) return
  let entries
  try {
    entries = await fs.promises.readdir(baseDir, { withFileTypes: true })
  } catch {
    return
  }
  const tags = entries
    .filter((entry) => entry.isDirectory() && versionTagRegex.test(entry.name))
    .map((entry) => entry.name)
  tags.sort((a, b) => compareVersionTags(b, a))
  for (const tag of tags.slice(keepCount)) {
    await fs.promises.rm(path.join(baseDir, tag), { recursive: true, force: true })
    console.info('清理旧版本安装包', { tag })
  }
}

//region 从 GitHub（经代理镜像）同步安装包

/** GitHub release 信息（与 API 响应的最小字段） */
interface GithubReleaseInfo {
  tag_name: string
  assets: Array<{ name: string; browser_download_url: string }>
}

/** 同步时排除的辅助文件（与 CI 上传的安装包范围一致：不传 linuxFilesForJar / VSCode 扩展等） */
const syncExcludedNamePatterns = ['linuxfilesforjar', 'unciv-lua-api']

/** 判断某个 release 资产是否属于需要托管的安装包（导出供测试） */
export function shouldSyncFile(name: string): boolean {
  const lower = name.toLowerCase()
  return !syncExcludedNamePatterns.some((pattern) => lower.includes(pattern))
}

/** 通过（可选）代理前缀拼接 GitHub URL：`<proxy>https://api.github.com/...` */
function proxyUrl(proxyPrefix: string, url: string): string {
  if (!proxyPrefix) return url
  return `${proxyPrefix}${url}`
}

/**
 * 从 GitHub API 获取最新或指定 tag 的 release 信息。
 * 直连 api.github.com（不经过 [proxyPrefix]）：公共镜像对 GitHub API 的转发受其账号
 * 限流影响（常 403），而 api.github.com 本身一般可达；镜像仅用于大文件下载。
 */
async function fetchGithubRelease(repo: string, tag: string | null, _proxyPrefix: string): Promise<GithubReleaseInfo> {
  const base = `https://api.github.com/repos/${repo}/releases/`
  const url = tag ? `${base}tags/${encodeURIComponent(tag)}` : `${base}latest`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'unciv-srv/1.0', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new HttpError(response.status === 404 ? 404 : 502, `获取 GitHub release 失败: HTTP ${response.status}`)
  }
  const data = await response.json() as GithubReleaseInfo
  if (!data.tag_name) throw new HttpError(502, 'GitHub release 响应缺少 tag_name')
  return data
}

/** 流式下载单个文件到指定路径（带重试与大小限制），返回字节数 */
async function downloadFileToPath(url: string, destPath: string, maxBytes: number, retries = 3): Promise<number> {
  let lastError: unknown
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'unciv-srv/1.0' },
        signal: AbortSignal.timeout(15 * 60_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const contentLength = Number(response.headers.get('content-length') ?? 0)
      if (contentLength > maxBytes) throw new Error(`文件过大 (${contentLength} 字节 > ${maxBytes} 字节)`)

      const reader = response.body?.getReader()
      if (!reader) throw new Error('响应无内容')
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
      const writer = fs.createWriteStream(destPath, { flags: 'w' })
      let total = 0
      let tooLarge = false
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > maxBytes) {
            tooLarge = true
            break
          }
          if (!writer.write(value)) {
            await new Promise<void>((resolve) => writer.once('drain', resolve))
          }
        }
      } finally {
        reader.releaseLock()
      }
      if (tooLarge) {
        writer.destroy()
        await fs.promises.rm(destPath, { force: true })
        throw new Error('文件过大')
      }
      await new Promise<void>((resolve, reject) => {
        writer.end((error?: Error | null) => (error ? reject(error) : resolve()))
      })
      return total
    } catch (error) {
      lastError = error
      await fs.promises.rm(destPath, { force: true }).catch(() => {})
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('下载失败')
}

//endregion

/** 创建安装包托管路由 */
export function createDownloadsRoutes(config: Config): Hono<Env> {
  const app = new Hono<Env>()
  const downloadSemaphore = new Semaphore(config.downloadMaxConcurrent)
  const uploadSemaphore = new Semaphore(1)
  const syncSemaphore = new Semaphore(1)
  const ipLimiter = new IpRateLimiter(config.downloadIpLimitPerMinute)
  const maxUploadBytes = config.downloadMaxFileSizeMb * 1024 * 1024

  // ---- 下载（无鉴权，靠限速/并发/频率限制保护） ----
  app.get('/dl/:tag/:filename', async (c) => {
    const ip = getClientIP(c)
    if (!ipLimiter.allow(ip)) {
      return errorResponse(429, '请求过于频繁，请稍后再试')
    }

    const tag = decodeHeaderValue(c.req.param('tag'))
    const filename = decodeHeaderValue(c.req.param('filename'))
    const filePath = safeDownloadPath(config.downloadDir, tag, filename)
    if (!filePath) return errorResponse(400, '无效的下载路径')

    let stat: fs.Stats
    try {
      stat = await fs.promises.stat(filePath)
    } catch {
      return errorResponse(404, '文件不存在')
    }
    if (!stat.isFile()) return errorResponse(404, '文件不存在')

    await downloadSemaphore.acquire()
    try {
      const range = parseRange(c.req.header('Range'), stat.size)
      const start = range?.start ?? 0
      const end = range?.end ?? stat.size - 1
      const headers: Record<string, string> = {
        'Content-Type': contentTypeFor(filename),
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Content-Disposition': `attachment; filename="${filename}"`,
      }
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`

      const stream = fs.createReadStream(filePath, { start, end })
        .pipe(throttleTransform(config.downloadRateLimitKbps * 1024))
      let released = false
      const release = () => {
        if (released) return
        released = true
        downloadSemaphore.release()
      }
      stream.on('close', release)
      stream.on('error', release)

      return c.body(
        Readable.toWeb(stream) as ReadableStream<Uint8Array>,
        range ? 206 : 200,
        headers,
      )
    } catch (error) {
      downloadSemaphore.release()
      throw error
    }
  })

  // ---- 检查更新：动态生成与 GitHub latest release API 同结构的版本清单（公开，供游戏内更新检查） ----
  app.get('/api/downloads/latest.json', async (c) => {
    const files = await listDownloadedFiles(config.downloadDir)
    if (files.length === 0) {
      return jsonResponse({ tag_name: '', html_url: '', name: '', assets: [] })
    }
    // 取最新版本目录（版本号降序）
    files.sort((a, b) => compareVersionTags(b.tag, a.tag) || a.filename.localeCompare(b.filename))
    const latestTag = files[0].tag
    const protocol = c.req.header('X-Forwarded-Proto') ?? 'http'
    const host = c.req.header('Host') ?? 'localhost'
    const base = `${protocol}://${host}`
    return jsonResponse({
      tag_name: latestTag,
      html_url: `${base}/dl/${latestTag}`,
      name: latestTag,
      assets: files
        .filter((file) => file.tag === latestTag)
        .map((file) => ({
          name: file.filename,
          browser_download_url: `${base}/dl/${latestTag}/${file.filename}`,
        })),
    })
  })

  // ---- 管理：从 GitHub（经代理镜像）同步安装包 ----
  app.post('/api/downloads/sync', adminAuth(config), async (c) => {
    const tag = decodeHeaderValue(c.req.query('tag') ?? '')
    if (tag && !versionTagRegex.test(tag)) return errorResponse(400, '无效的版本号')

    await syncSemaphore.acquire()
    try {
      const release = await fetchGithubRelease(config.downloadGithubRepo, tag || null, config.downloadGithubProxy)
      const assets = release.assets.filter((asset) => shouldSyncFile(asset.name))
      if (assets.length === 0) {
        return jsonResponse({ ok: true, tag: release.tag_name, files: [], skipped: true })
      }

      const files: Array<{ name: string; size: number; durationMs: number }> = []
      const errors: Array<{ name: string; error: string }> = []
      const maxBytes = config.downloadMaxFileSizeMb * 1024 * 1024
      for (const asset of assets) {
        const destPath = safeDownloadPath(config.downloadDir, release.tag_name, asset.name)
        if (!destPath) {
          errors.push({ name: asset.name, error: '非法文件名' })
          continue
        }
        const downloadUrl = proxyUrl(config.downloadGithubProxy, asset.browser_download_url)
        const started = Date.now()
        try {
          const size = await downloadFileToPath(downloadUrl, destPath, maxBytes)
          files.push({ name: asset.name, size, durationMs: Date.now() - started })
          console.info('同步安装包', { tag: release.tag_name, name: asset.name, size })
        } catch (error) {
          errors.push({ name: asset.name, error: error instanceof Error ? error.message : String(error) })
          console.error('同步安装包失败', { tag: release.tag_name, name: asset.name, error })
        }
      }
      // 只保留最新版本，释放存储空间
      await cleanupOldVersions(config.downloadDir, config.downloadKeepVersions)
      return jsonResponse({ ok: errors.length === 0, tag: release.tag_name, files, errors })
    } finally {
      syncSemaphore.release()
    }
  })

  // ---- 管理：上传安装包（raw body 流式写入，CI 与管理后台共用） ----
  app.post('/api/downloads/upload', adminAuth(config), async (c) => {
    const tag = decodeHeaderValue(c.req.query('tag') ?? '')
    const filename = decodeHeaderValue(c.req.query('filename') ?? '')
    const filePath = safeDownloadPath(config.downloadDir, tag, filename)
    if (!filePath) return errorResponse(400, '无效的版本号或文件名')

    const body = c.req.raw.body
    if (!body) return errorResponse(400, '缺少文件内容')

    await uploadSemaphore.acquire()
    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      const reader = body.getReader()
      const writer = fs.createWriteStream(filePath, { flags: 'w' })
      let total = 0
      let tooLarge = false
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > maxUploadBytes) {
            tooLarge = true
            break
          }
          if (!writer.write(value)) {
            await new Promise<void>((resolve) => writer.once('drain', resolve))
          }
        }
      } finally {
        reader.releaseLock()
      }
      if (tooLarge) {
        writer.destroy()
        await fs.promises.rm(filePath, { force: true })
        return errorResponse(413, `文件过大，超过 ${config.downloadMaxFileSizeMb}MB 限制`)
      }
      await new Promise<void>((resolve, reject) => {
        writer.end((error?: Error | null) => (error ? reject(error) : resolve()))
      })
      console.info('上传安装包', { tag, filename, size: total })
      // 只保留最新版本，释放存储空间
      await cleanupOldVersions(config.downloadDir, config.downloadKeepVersions)
      return jsonResponse({ ok: true, tag, filename, size: total })
    } catch (error) {
      await fs.promises.rm(filePath, { force: true }).catch(() => {})
      throw error
    } finally {
      uploadSemaphore.release()
    }
  })

  // ---- 管理：列出已托管安装包 ----
  app.get('/api/downloads', adminAuth(config), async (c) => {
    const files = await listDownloadedFiles(config.downloadDir)
    return jsonResponse({ files })
  })

  // ---- 管理：删除安装包 ----
  app.delete('/api/downloads/:tag/:filename', adminAuth(config), async (c) => {
    const tag = decodeHeaderValue(c.req.param('tag'))
    const filename = decodeHeaderValue(c.req.param('filename'))
    const filePath = safeDownloadPath(config.downloadDir, tag, filename)
    if (!filePath) return errorResponse(400, '无效的版本号或文件名')
    try {
      await fs.promises.rm(filePath)
    } catch {
      return errorResponse(404, '文件不存在')
    }
    console.info('删除安装包', { tag, filename })
    return jsonResponse({ ok: true })
  })

  return app
}
