import path from 'node:path'

export const projectRoot = path.resolve(import.meta.dir, '..')

/**
 * 将相对路径固定到仓库根目录。
 */
export function resolveRepoPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value)
}
