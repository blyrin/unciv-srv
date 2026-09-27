/** 注册模式：open=任何人可自助注册；approval=自助注册后需管理员审核；closed=只能由管理员开通账号 */
export type RegisterMode = 'open' | 'approval' | 'closed'

/** 客户端 IP 存储策略：full=完整存储；anonymized=匿名化（IPv4 保留 /24、IPv6 保留 /48）；none=不存储 */
export type IPStorageMode = 'full' | 'anonymized' | 'none'

export interface Config {
  port: string
  dbPath: string
  adminUsername: string
  adminPassword: string
  maxAttempts: number
  lockTime: number
  /** 注册模式（面向公众的服务建议 approval 或 closed） */
  registerMode: RegisterMode
  /** 是否允许玩家之间的聊天（关闭后仅保留游戏更新推送、在线状态与同步回合信号） */
  chatEnabled: boolean
  /** 客户端 IP 存储策略（最小化原则下不建议 full） */
  ipStorage: IPStorageMode
  /** IP 保留天数：超期清空玩家与存档上记录的历史 IP，0 表示不清理 */
  ipRetentionDays: number
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
  /**
   * 账号是否已通过审核：approval 模式下新注册的账号为 false，缺列的历史数据同样按 false（未审核）处理，
   * 未审核账号无法使用任何联机接口，需要管理员在后台通过
   */
  approved: boolean
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
  pendingPlayerCount: number
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
