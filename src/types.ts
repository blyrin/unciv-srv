export interface Config {
  port: string
  dbPath: string
  adminUsername: string
  adminPassword: string
  maxAttempts: number
  lockTime: number
  /** 安装包托管根目录（每次发布版本建一个子目录，形如 <dir>/<版本tag>/<文件名>） */
  downloadDir: string
  /** 同时进行的安装包下载连接数上限（防止带宽被打满） */
  downloadMaxConcurrent: number
  /** 单连接下载限速（KB/s，0 表示不限速） */
  downloadRateLimitKbps: number
  /** 单个上传文件大小上限（MB） */
  downloadMaxFileSizeMb: number
  /** 每 IP 每分钟最大下载请求数（防刷） */
  downloadIpLimitPerMinute: number
  /** 保留的安装包版本数（上传新版本后自动清理更旧的版本目录，节约存储） */
  downloadKeepVersions: number
  /** 从 GitHub 同步安装包时使用的仓库（owner/repo） */
  downloadGithubRepo: string
  /** 同步时用的 GitHub 代理/镜像前缀（空 = 直连，大陆服务器建议 gh-proxy 等镜像） */
  downloadGithubProxy: string
}

export interface Player {
  playerId: string
  password?: string
  createdAt: number
  updatedAt: number
  whitelist: boolean
  remark: string
  createIp?: string
  updateIp?: string
}

export interface Game {
  gameId: string
  players: string[]
  createdAt: number
  updatedAt: number
  whitelist: boolean
  remark: string
}

export interface FileData {
  id: number
  gameId: string
  turns: number
  createdPlayer: string
  createdIp?: string
  createdAt: number
  data: string
}

export interface GameWithTurns extends Game {
  turns: number
  createdPlayer: string
}

export interface PageResult<T> {
  items: T[]
  total: number
}

export interface TurnMetadata {
  id: number
  turns: number
  createdPlayer: string
  createdIp?: string
  createdAt: number
}

export interface RollbackResult {
  deletedTurns: number
  deletedPreviews: number
  currentTurns: number
}

export interface Stats {
  playerCount: number
  whitelistPlayerCount: number
  gameCount: number
  whitelistGameCount: number
  todayNewPlayers: number
  todayNewGames: number
  activePlayers7Days: number
  activePlayers30Days: number
  activeGames7Days: number
  activeGames30Days: number
  totalSaves: number
  todayNewSaves: number
  avgGameTurns: number
  maxGameTurns: number
}

export interface AppVariables {
  playerId: string
  gameId: string
  isPreview: boolean
  sessionUserId: string
  sessionIsAdmin: boolean
}
