import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { shouldSyncFile } from '../src/downloads.js'
import { setupTestServer, type TestServer } from './helpers/server.js'

const adminAuth = `Basic ${Buffer.from('admin:admin123').toString('base64')}`

let server: TestServer

beforeEach(() => {
  server = setupTestServer()
})

afterEach(() => {
  server.close()
})

async function uploadFile(tag: string, filename: string, content: string): Promise<Response> {
  return server.app.request(
    `/api/downloads/upload?tag=${tag}&filename=${filename}`,
    { method: 'POST', headers: { Authorization: adminAuth }, body: content },
  )
}

test('管理上传接口：需管理员认证', async () => {
  const response = await server.app.request(
    '/api/downloads/upload?tag=4.21.10.1&filename=UncivCN-4.21.10.1.Apk',
    { method: 'POST', body: 'data' },
  )
  assert.equal(response.status, 401)
})

test('管理上传接口：写入文件并返回大小', async () => {
  const response = await uploadFile('4.21.10.1', 'test.txt', 'hello')
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.size, 5)

  const filePath = path.join(server.config.downloadDir, '4.21.10.1', 'test.txt')
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'hello')
})

test('管理上传接口：拒绝非法版本号/文件名', async () => {
  assert.equal((await uploadFile('../evil', 'x.txt', 'x')).status, 400)
  assert.equal((await uploadFile('4.21.10.1', '../evil.txt', 'x')).status, 400)
  assert.equal((await uploadFile('not-a-version', 'x.txt', 'x')).status, 400)
  assert.equal((await uploadFile('4.21.10.1', 'a/b.txt', 'x')).status, 400)
})

test('下载：返回文件内容与正确响应头', async () => {
  await uploadFile('4.21.10.1', 'test.apk', 'fake-apk-content')
  const response = await server.app.request('/dl/4.21.10.1/test.apk')
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'fake-apk-content')
  assert.equal(response.headers.get('Content-Type'), 'application/vnd.android.package-archive')
  assert.ok(response.headers.get('Content-Disposition')?.includes('test.apk'))
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
})

test('下载：支持 Range 断点续传', async () => {
  await uploadFile('4.21.10.1', 'test.bin', '0123456789')
  const response = await server.app.request('/dl/4.21.10.1/test.bin', {
    headers: { Range: 'bytes=2-5' },
  })
  assert.equal(response.status, 206)
  assert.equal(await response.text(), '2345')
  assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/10')
  assert.equal(response.headers.get('Content-Length'), '4')
})

test('下载：文件不存在返回 404，路径穿越返回 400', async () => {
  assert.equal((await server.app.request('/dl/4.21.10.1/nope.txt')).status, 404)
  assert.equal((await server.app.request('/dl/4.21.10.1/..%2Fsecret.txt')).status, 400)
})

test('上传新版本后自动清理旧版本目录（只保留最新）', async () => {
  await uploadFile('4.21.9.1', 'UncivCN-4.21.9.1.Apk', 'old')
  await uploadFile('4.21.10.1', 'UncivCN-4.21.10.1.Apk', 'new')

  const oldPath = path.join(server.config.downloadDir, '4.21.9.1')
  const newPath = path.join(server.config.downloadDir, '4.21.10.1')
  assert.equal(fs.existsSync(oldPath), false, '旧版本目录应被清理')
  assert.equal(fs.existsSync(newPath), true, '新版本目录应保留')
})

test('管理列表：返回已托管文件清单', async () => {
  await uploadFile('4.21.10.1', 'UncivCN-4.21.10.1.Apk', 'x')
  const response = await server.app.request('/api/downloads', {
    headers: { Authorization: adminAuth },
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.files.length, 1)
  assert.equal(body.files[0].tag, '4.21.10.1')
  assert.equal(body.files[0].filename, 'UncivCN-4.21.10.1.Apk')
})

test('检查更新端点：latest.json 返回最新版本与资产（GitHub 同结构）', async () => {
  await uploadFile('4.21.9.1', 'UncivCN-4.21.9.1.Apk', 'old')
  await uploadFile('4.21.10.1', 'UncivCN-4.21.10.1.Apk', 'new')
  const response = await server.app.request('/api/downloads/latest.json')
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.tag_name, '4.21.10.1')
  assert.equal(body.name, '4.21.10.1')
  assert.equal(body.assets.length, 1)
  assert.equal(body.assets[0].name, 'UncivCN-4.21.10.1.Apk')
  assert.ok(body.assets[0].browser_download_url.endsWith('/dl/4.21.10.1/UncivCN-4.21.10.1.Apk'))
})

test('检查更新端点：无文件时返回空版本', async () => {
  const response = await server.app.request('/api/downloads/latest.json')
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.tag_name, '')
  assert.equal(body.assets.length, 0)
})

test('管理删除：删除指定文件', async () => {
  await uploadFile('4.21.10.1', 'test.txt', 'x')
  const response = await server.app.request('/api/downloads/4.21.10.1/test.txt', {
    method: 'DELETE',
    headers: { Authorization: adminAuth },
  })
  assert.equal(response.status, 200)
  assert.equal(fs.existsSync(path.join(server.config.downloadDir, '4.21.10.1', 'test.txt')), false)
})

test('下载频率限制：超过每 IP 上限返回 429', async () => {
  await uploadFile('4.21.10.1', 'test.txt', 'x')
  let lastStatus = 0
  for (let i = 0; i < server.config.downloadIpLimitPerMinute + 1; i += 1) {
    const response = await server.app.request('/dl/4.21.10.1/test.txt')
    lastStatus = response.status
    await response.arrayBuffer() // 消费 body，避免遗留未关闭的流
  }
  assert.equal(lastStatus, 429)
})

test('shouldSyncFile：排除辅助文件，保留安装包', () => {
  assert.equal(shouldSyncFile('UncivCN-4.21.10.1.Apk'), true)
  assert.equal(shouldSyncFile('UncivCN-4.21.10.1.msi'), true)
  assert.equal(shouldSyncFile('UncivCN-Windows64-4.21.10.1.zip'), true)
  assert.equal(shouldSyncFile('UncivServer-4.21.10.1.jar'), true)
  assert.equal(shouldSyncFile('linuxFilesForJar-4.21.10.1.zip'), false)
  assert.equal(shouldSyncFile('unciv-lua-api-4.21.10.1.vsix'), false)
})

test('同步接口：从 GitHub（经代理）拉取安装包到托管目录', async () => {
  const releaseInfo = {
    tag_name: '4.21.10.1',
    assets: [
      { name: 'UncivCN-4.21.10.1.Apk', browser_download_url: 'https://github.com/AutumnPizazz/Unciv/releases/download/4.21.10.1/UncivCN-4.21.10.1.Apk' },
      { name: 'linuxFilesForJar-4.21.10.1.zip', browser_download_url: 'https://github.com/AutumnPizazz/Unciv/releases/download/4.21.10.1/linuxFilesForJar-4.21.10.1.zip' },
    ],
  }
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('api.github.com/repos/')) {
      return new Response(JSON.stringify(releaseInfo), { headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(`content-of-${path.basename(url)}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  try {
    const response = await server.app.request('/api/downloads/sync?tag=4.21.10.1', {
      method: 'POST',
      headers: { Authorization: adminAuth },
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.equal(body.tag, '4.21.10.1')
    assert.equal(body.files.length, 1)
    assert.equal(body.files[0].name, 'UncivCN-4.21.10.1.Apk')
    assert.equal(body.errors.length, 0)

    // 排除的辅助文件不应被下载；安装包已写入且经代理前缀请求
    const downloaded = fs.readFileSync(
      path.join(server.config.downloadDir, '4.21.10.1', 'UncivCN-4.21.10.1.Apk'),
      'utf8',
    )
    assert.equal(downloaded, 'content-of-UncivCN-4.21.10.1.Apk')
    assert.equal(
      fs.existsSync(path.join(server.config.downloadDir, '4.21.10.1', 'linuxFilesForJar-4.21.10.1.zip')),
      false,
    )
    // 下载 URL 应带代理前缀（gh-proxy）
    const downloadCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/releases/download/'))
    assert.ok(downloadCall)
    assert.ok(String(downloadCall[0]).startsWith('https://gh-proxy.com/https://github.com/'))
  } finally {
    vi.unstubAllGlobals()
  }
})

test('同步接口：需管理员认证', async () => {
  const response = await server.app.request('/api/downloads/sync?tag=4.21.10.1', { method: 'POST' })
  assert.equal(response.status, 401)
})

test('同步接口：拒绝非法版本号', async () => {
  const response = await server.app.request('/api/downloads/sync?tag=..%2Fevil', {
    method: 'POST',
    headers: { Authorization: adminAuth },
  })
  assert.equal(response.status, 400)
})
