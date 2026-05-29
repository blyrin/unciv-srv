import fs from 'node:fs'
import { projectRoot, resolveRepoPath } from './paths.js'
import type { Config } from './types.js'

/**
 * 读取环境变量，未设置时返回默认值。
 */
function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue
}

/**
 * 读取整数环境变量，格式错误时返回默认值。
 */
function getEnvAsInt(key: string, defaultValue: number): number {
  const parsed = Number.parseInt(process.env[key] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : defaultValue
}

/**
 * 从 .env 文件加载未设置的环境变量。
 */
export function loadEnvFile(filename = `${projectRoot}/.env`): void {
  if (!fs.existsSync(filename)) {
    console.info('未找到 .env 文件，使用环境变量')
    return
  }

  const content = fs.readFileSync(filename, 'utf8')
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const index = line.indexOf('=')
    if (index < 0) {
      continue
    }

    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key && !process.env[key]) {
      process.env[key] = value
    }
  }
}

/**
 * 从环境变量生成应用配置。
 */
export function loadConfig(): Config {
  return {
    port: getEnv('PORT', '11451'),
    dbPath: resolveRepoPath(getEnv('DB_PATH', 'data/unciv-srv.db')),
    adminUsername: getEnv('ADMIN_USERNAME', 'admin'),
    adminPassword: getEnv('ADMIN_PASSWORD', 'admin123'),
    maxAttempts: getEnvAsInt('MAX_ATTEMPTS', 5),
    lockTime: getEnvAsInt('LOCK_TIME', 5),
  }
}
