import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { shouldSyncFile } from '../src/downloads.js'
import { setupTestServer, type TestServer } from './helpers/server.js'

const releaseInfo = {
  tag_name: '4.21.10.7',
  html_url: 'https://github.com/AutumnPizazz/Unciv/releases/tag/4.21.10.7',
  name: '4.21.10.7',
  assets: [
    {
      name: 'UncivCN-4.21.10.7.Apk',
      browser_download_url: 'https://github.com/AutumnPizazz/Unciv/releases/download/4.21.10.7/UncivCN-4.21.10.7.Apk',
    },
    {
      name: 'linuxFilesForJar-4.21.10.7.zip',
      browser_download_url: 'https://github.com/AutumnPizazz/Unciv/releases/download/4.21.10.7/linuxFilesForJar-4.21.10.7.zip',
    },
  ],
}

let server: TestServer

beforeEach(() => {
  server = setupTestServer()
})

afterEach(() => {
  server.close()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('shouldSyncFile：排除辅助文件，保留安装包', () => {
  assert.equal(shouldSyncFile('UncivCN-4.21.10.7.Apk'), true)
  assert.equal(shouldSyncFile('UncivCN-4.21.10.7.msi'), true)
  assert.equal(shouldSyncFile('UncivCN-Windows64-4.21.10.7.zip'), true)
  assert.equal(shouldSyncFile('UncivServer-4.21.10.7.jar'), true)
  assert.equal(shouldSyncFile('linuxFilesForJar-4.21.10.7.zip'), false)
  assert.equal(shouldSyncFile('unciv-lua-api-4.21.10.7.vsix'), false)
})

test('直链：302 到镜像前缀的 GitHub 下载地址', async () => {
  const response = await server.app.request('/dl/4.21.10.7/UncivCN-4.21.10.7.Apk')
  assert.equal(response.status, 302)
  assert.equal(
    response.headers.get('Location'),
    'https://mirror.ecrow.cn/github-release/AutumnPizazz/Unciv/releases/download/4.21.10.7/UncivCN-4.21.10.7.Apk',
  )
})

test('直链：未配置镜像前缀时直接跳 GitHub', async () => {
  const plainServer = setupTestServer({ downloadGithubProxy: '' })
  try {
    const response = await plainServer.app.request('/dl/4.21.10.7/linuxFilesForJar-4.21.10.7.zip')
    assert.equal(response.status, 302)
    assert.equal(
      response.headers.get('Location'),
      'https://github.com/AutumnPizazz/Unciv/releases/download/4.21.10.7/linuxFilesForJar-4.21.10.7.zip',
    )
  } finally {
    plainServer.close()
  }
})

test('直链：拒绝非法版本号与文件名', async () => {
  assert.equal((await server.app.request('/dl/not-a-version/x.apk')).status, 400)
  assert.equal((await server.app.request('/dl/4.21.10.7/..%2Fevil.apk')).status, 400)
})

test('版本清单：转发 GitHub latest release 并过滤辅助文件', async () => {
  const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify(releaseInfo), {
    headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)

  const response = await server.app.request('/api/downloads/latest.json')
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.tag_name, '4.21.10.7')
  assert.equal(body.html_url, 'https://github.com/AutumnPizazz/Unciv/releases/tag/4.21.10.7')
  assert.equal(body.name, '4.21.10.7')
  assert.deepEqual(body.assets.map((asset: { name: string }) => asset.name), ['UncivCN-4.21.10.7.Apk'])
  assert.ok(String(fetchMock.mock.calls[0][0]).includes('api.github.com/repos/AutumnPizazz/Unciv/releases/latest'))

  // 缓存：短时间内再次请求不会重复访问 GitHub API
  await server.app.request('/api/downloads/latest.json')
  assert.equal(fetchMock.mock.calls.length, 1)
})

test('版本清单：GitHub 不可用且无缓存时返回 502', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('network down')
  }))
  const response = await server.app.request('/api/downloads/latest.json')
  assert.equal(response.status, 502)
})

test('版本清单：缓存过期后 GitHub 出错则继续使用上一次缓存', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify(releaseInfo))))
  vi.useFakeTimers()
  assert.equal((await server.app.request('/api/downloads/latest.json')).status, 200)

  vi.setSystemTime(Date.now() + 5 * 60_000)
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('network down')
  }))
  const response = await server.app.request('/api/downloads/latest.json')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).tag_name, '4.21.10.7')
})
