export interface Config {
  port: string
  dbPath: string
  adminUsername: string
  adminPassword: string
  maxAttempts: number
  lockTime: number
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
