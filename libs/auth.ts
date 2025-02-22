import { sql } from './db.ts'
import { cache } from './cache.ts'

export enum AuthStatus {
  Valid = 0,
  Invalid = 1,
  Missing = 2,
}

export interface Player {
  playerId: string
  password: string
}

export interface PlayerWithAuth extends Player {
  status: AuthStatus
}

export const loadUser = async (playerId: string): Promise<Player | null> => {
  const cached = await cache.get(`player:${playerId}`)
  if (cached) {
    return JSON.parse(cached)
  }
  const players = await sql<Player[]>`
      select player_id, password
      from players
      where player_id = ${playerId}
      limit 1`
  const player = players[0] ?? null
  await cache.set(`player:${playerId}`, JSON.stringify(player))
  return player
}

export const checkAuth = async (authHeader?: string | null): Promise<PlayerWithAuth> => {
  if (!authHeader) {
    return { playerId: '', password: '', status: AuthStatus.Invalid }
  }
  const { 0: type, 1: token } = authHeader.split(' ')
  if (type !== 'Basic') {
    return { playerId: '', password: '', status: AuthStatus.Invalid }
  }
  const { 0: playerId, 1: password } = atob(token).split(':')
  if (!playerId || !password) {
    return { playerId: '', password: '', status: AuthStatus.Invalid }
  }
  const player = await loadUser(playerId)
  if (!player) {
    return { playerId, password, status: AuthStatus.Missing }
  }
  if (player.password !== password) {
    return { playerId: '', password: '', status: AuthStatus.Invalid }
  }
  return { playerId, password, status: AuthStatus.Valid }
}

export const saveAuth = async (playerId: string, password: string) => {
  await sql`
      insert into players(player_id, password)
      values (${playerId}, ${password})
      on conflict(player_id) do update
          set password   = ${password},
              updated_at = now()`
  await cache.set(`player:${playerId}`, JSON.stringify({ playerId, password }))
}
