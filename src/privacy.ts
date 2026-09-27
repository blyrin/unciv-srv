import type { IPStorageMode } from './types.js'
import { normalizeClientIP } from './utils.js'

/** 未配置时的默认存储策略：匿名化（只保留网段，配合 /24 或 /48 级别的风控足够） */
export const defaultIPStorageMode: IPStorageMode = 'anonymized'

let storageMode: IPStorageMode = defaultIPStorageMode

/** 未配置时的默认 IP 保留天数 */
export const defaultIPRetentionDays = 30

let retentionDays = defaultIPRetentionDays

/**
 * 设置 IP 保留天数，0 表示不按时间清理。
 */
export function setIPRetentionDays(days: number): void {
  retentionDays = days > 0 ? days : 0
}

/**
 * 返回当前 IP 保留天数。
 */
export function getIPRetentionDays(): number {
  return retentionDays
}

/**
 * 设置 IP 存储策略，仅在启动时调用一次。
 */
export function setIPStorageMode(mode: IPStorageMode): void {
  storageMode = mode
}

/**
 * 返回当前 IP 存储策略。
 */
export function getIPStorageMode(): IPStorageMode {
  return storageMode
}

/**
 * 展开 IPv6 地址为标准 8 组十六进制形式，格式非法时返回 null。
 */
function expandIPv6(address: string): string[] | null {
  const zoneIndex = address.indexOf('%')
  const text = zoneIndex >= 0 ? address.slice(0, zoneIndex) : address
  const parts = text.split('::')
  if (parts.length > 2) {
    return null
  }

  const head = parts[0] === '' ? [] : parts[0].split(':')
  const tail = parts.length === 2 && parts[1] !== '' ? parts[1].split(':') : []
  if (parts.length === 1) {
    return head.length === 8 ? head : null
  }

  const missing = 8 - head.length - tail.length
  if (missing < 0) {
    return null
  }
  return [...head, ...Array<string>(missing).fill('0'), ...tail]
}

/**
 * 压缩单个十六进制分组（去掉前导零）。
 */
function compactGroup(group: string): string {
  const text = group.replace(/^0+/, '')
  return text === '' ? '0' : text
}

/**
 * 匿名化 IP：IPv4 抹掉主机位（保留 /24），IPv6 保留前 3 组（/48）。
 * 无法识别的值（例如 healthcheck 的 unknown）原样返回。
 */
export function anonymizeIP(ip: string): string {
  const normalized = normalizeClientIP(ip)
  if (normalized.includes(':')) {
    const groups = expandIPv6(normalized)
    if (groups == null) {
      return normalized
    }
    return `${groups.slice(0, 3).map(compactGroup).join(':')}::`
  }

  const octets = normalized.split('.')
  if (octets.length !== 4) {
    return normalized
  }
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet) || Number(octet) > 255) {
      return normalized
    }
  }
  return `${octets[0]}.${octets[1]}.${octets[2]}.0`
}

/**
 * 按当前存储策略转换待入库的 IP，返回 null 表示不存储。
 */
export function ipForStorage(ip: string | null | undefined): string | null {
  if (ip == null || ip === '') {
    return null
  }
  if (storageMode === 'none') {
    return null
  }
  if (storageMode === 'full') {
    return ip
  }
  return anonymizeIP(ip)
}

/**
 * 按当前存储策略转换待输出的日志 IP，返回空串表示不记录。
 */
export function ipForLog(ip: string | null | undefined): string {
  if (ip == null || ip === '') {
    return ''
  }
  if (storageMode === 'none') {
    return ''
  }
  if (storageMode === 'full') {
    return ip
  }
  return anonymizeIP(ip)
}

/**
 * 返回待入库的 IP 或 undefined，便于直接写入可空列。
 */
export function ipForStorageOrUndefined(ip: string | null | undefined): string | undefined {
  return ipForStorage(ip) ?? undefined
}
