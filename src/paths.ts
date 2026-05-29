import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

export const projectRoot = path.resolve(moduleDir, '..')

/**
 * 将相对路径固定到仓库根目录。
 */
export function resolveRepoPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value)
}
