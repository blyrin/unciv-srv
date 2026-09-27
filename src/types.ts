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
  /** 是否在存档总量超过阈值时归档冷存档（关闭则不做容量归档，数据库可能持续增长） */
  archiveEnabled: boolean
  /** 冷存档归档目录：每次归档生成一个 JSON Lines 文件（每行一局），由宿主机脚本负责加密上传到网盘 */
  archiveDir: string
  /** 存档数据总量上限（字节）：超过后按最久未使用的顺序归档非白名单对局 */
  archiveMaxBytes: number
  /** 安装包与版本清单所在的 GitHub 仓库（owner/repo） */
  downloadGithubRepo: string
  /** 安装包下载用的 GitHub 镜像前缀，替换 `https://github.com/`（空 = 直连） */
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

/** 后台玩家列表的一行：在玩家信息之外带上参与的对局数，方便审核时判断账号是否真的在用 */
export interface PlayerListEntry extends Player {
  gameCount: number
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
