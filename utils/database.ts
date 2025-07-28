import { name, version } from '../package.json' with { typeof: 'json' }
import process from 'node:process'
import postgres from 'postgres'

let sql: ReturnType<typeof postgres> | null = null

export function db() {
  if (!sql) {
    const env = process.env
    const urlParams = !!env.DB_SOCKET_PATH ? {
      path: env.DB_SOCKET_PATH,
    } : {
      host: env.DB_HOST || 'localhost',
      port: +(env.DB_PORT || 5432),
    }
    sql = postgres({
      ...urlParams,
      database: env.DB_NAME || 'unciv-srv',
      user: env.DB_USER || 'postgres',
      password: env.DB_PASSWORD || 'postgres',
      transform: postgres.camel,
      connection: {
        application_name: `${name}_${version}`,
      },
    })
  }
  return sql
}

export interface Player {
  playerId: string
  password: string
}

export interface PlayerWithAuth extends Player {
  status: AuthStatus
}

export enum AuthStatus {
  Valid = 0,
  Invalid = 1,
  Missing = 2,
}

export interface PlayerInfo {
  playerId: string
  createdAt: Date
  updatedAt: Date
  whitelist: boolean
  remark?: string
  createIp?: string
  updateIp?: string
}

export interface GameInfo {
  gameId: string
  players: string[]
  createdAt: Date
  updatedAt: Date
  whitelist: boolean
  remark?: string
  turns?: number
  createdPlayer?: string
}

export interface AdminAuth {
  username: string
  password: string
  isAdmin: boolean
}

export interface UserSession {
  playerId?: string
  isAdmin: boolean
  authenticated: boolean
}

export const saveUser = async (playerId: string, password: string, ip: string) => {
  const sql = db()
  await sql`SELECT sp_save_auth(${playerId}, ${password}, ${ip})`
}

export const loadUser = async (playerId: string) => {
  const sql = db()
  const players = await sql<Player[]>`SELECT * FROM sp_load_user(${playerId})`
  return players[0] ?? null
}

export const getAllPlayers = () => {
  const sql = db()
  return sql<PlayerInfo[]>`SELECT * FROM sp_get_all_players()`
}

export const getAllGames = () => {
  const sql = db()
  return sql<GameInfo[]>`SELECT * FROM sp_get_all_games()`
}

export const getUserGames = (playerId: string) => {
  const sql = db()
  return sql<GameInfo[]>`SELECT * FROM sp_get_user_games(${playerId})`
}

export const checkGameDeletePermission = async (gameId: string) => {
  const sql = db()
  const result = await sql<{ createdPlayer: string }[]>`SELECT * FROM sp_check_game_delete_permission(${gameId})`
  return result[0]?.createdPlayer ?? null
}

export const deleteGame = async (gameId: string) => {
  const sql = db()
  await sql`SELECT sp_delete_game(${gameId})`
}

export const updatePlayer = async (playerId: string, whitelist: boolean, remark?: string) => {
  const sql = db()
  await sql`SELECT sp_update_player(${playerId}, ${whitelist}, ${remark || null})`
}

export const updateGame = async (gameId: string, whitelist: boolean, remark?: string) => {
  const sql = db()
  await sql`SELECT sp_update_game(${gameId}, ${whitelist}, ${remark || null})`
}

export const getPlayerIdsFromGameId = async (gameId: string): Promise<string[]> => {
  const sql = db()
  const file = await sql<{ playerId: string }[]>`SELECT * FROM sp_get_player_ids_from_game(${gameId})`
  return file.map((f) => f.playerId)
}

export const getAllTurnsForGame = (gameId: string) => {
  const sql = db()
  return sql<{ turns: number; contentData: object }[]>`SELECT * FROM sp_get_all_turns_for_game(${gameId})`
}
