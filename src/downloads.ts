import { Hono } from 'hono'
import type { Config, AppVariables } from './types.js'
import { HttpError, decodeHeaderValue, errorResponse, jsonResponse } from './utils.js'

type Env = { Variables: AppVariables }

const versionTagRegex = /^\d{1,3}(\.\d{1,3}){2}(\.\d{1,3})?(-patch\d{1,3})?$/
const fileNameRegex = /^[^/\\]{1,128}$/

/** GitHub release 信息（与 API 响应的最小字段） */
interface GithubReleaseInfo {
  tag_name: string
  html_url?: string
  name?: string
  assets: Array<{ name: string; browser_download_url: string }>
}

/** 版本清单里排除的辅助文件（linuxFilesForJar / VSCode 扩展等，客户端也不会用它们更新） */
const manifestExcludedNamePatterns = ['linuxfilesforjar', 'unciv-lua-api']

/** 判断某个 release 资产是否属于安装包（导出供测试） */
export function shouldSyncFile(name: string): boolean {
  const lower = name.toLowerCase()
  return !manifestExcludedNamePatterns.some((pattern) => lower.includes(pattern))
}

/** 通过（可选）镜像前缀拼接 GitHub 下载地址：前缀用于替换 `https://github.com/`（如 https://mirror.ecrow.cn/github-release/） */
function proxyUrl(proxyPrefix: string, url: string): string {
  if (!proxyPrefix) return url
  const githubUrlPrefix = 'https://github.com/'
  if (!url.startsWith(githubUrlPrefix)) return `${proxyPrefix}${url}`
  return `${proxyPrefix}${url.slice(githubUrlPrefix.length)}`
}

/**
 * 从 GitHub API 获取最新 release。
 * 直连 api.github.com（不经过镜像）：公共镜像对 GitHub API 的转发受其账号限流影响（常 403），
 * 而 api.github.com 一般可达；镜像只用于安装包大文件下载。
 */
async function fetchGithubLatestRelease(repo: string): Promise<GithubReleaseInfo> {
  let response: Response
  try {
    response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 'User-Agent': 'unciv-srv/1.0', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    throw new HttpError(502, `获取 GitHub release 失败: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    throw new HttpError(response.status === 404 ? 404 : 502, `获取 GitHub release 失败: HTTP ${response.status}`)
  }
  const data = await response.json() as GithubReleaseInfo
  if (!data.tag_name) throw new HttpError(502, 'GitHub release 响应缺少 tag_name')
  return data
}

/** 最新 release 的进程内缓存时长：GitHub API 未认证限流 60 次/小时/IP，而每次游戏启动都会检查更新 */
const releaseCacheMs = 120_000

/** 创建安装包路由：本机不再托管安装包文件，只做直链跳转与版本清单转发 */
export function createDownloadsRoutes(config: Config): Hono<Env> {
  const app = new Hono<Env>()
  let cachedRelease: GithubReleaseInfo | null = null
  let cachedAt = 0

  // ---- 安装包直链：直接 302 到 GitHub（经配置的镜像前缀），不落盘、不限速 ----
  app.get('/dl/:tag/:filename', (c) => {
    const tag = decodeHeaderValue(c.req.param('tag'))
    const filename = decodeHeaderValue(c.req.param('filename'))
    if (!versionTagRegex.test(tag) || !fileNameRegex.test(filename)) {
      return errorResponse(400, '无效的下载路径')
    }
    const githubUrl = `https://github.com/${config.downloadGithubRepo}/releases/download/${tag}/${encodeURIComponent(filename)}`
    return c.redirect(proxyUrl(config.downloadGithubProxy, githubUrl))
  })

  // ---- 检查更新：转发 GitHub latest release 的版本清单（公开，供游戏内更新检查） ----
  app.get('/api/downloads/latest.json', async (c) => {
    if (!cachedRelease || Date.now() - cachedAt > releaseCacheMs) {
      try {
        cachedRelease = await fetchGithubLatestRelease(config.downloadGithubRepo)
        cachedAt = Date.now()
      } catch (error) {
        // 拿不到 GitHub 数据时退回上一次缓存，避免玩家端直接报「下载服务器不可用」
        if (!cachedRelease) throw error
        console.warn('获取 GitHub latest release 失败，继续使用缓存', error)
      }
    }
    const release = cachedRelease
    if (!release) throw new HttpError(502, '获取 GitHub release 失败')
    return jsonResponse({
      tag_name: release.tag_name,
      html_url: release.html_url || `https://github.com/${config.downloadGithubRepo}/releases/tag/${release.tag_name}`,
      name: release.name || release.tag_name,
      assets: release.assets
        .filter((asset) => shouldSyncFile(asset.name))
        .map((asset) => ({
          name: asset.name,
          browser_download_url: asset.browser_download_url,
        })),
    })
  })

  return app
}
