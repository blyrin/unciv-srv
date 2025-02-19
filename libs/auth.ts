import { sql } from './db.ts'

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
  const players = await sql<Player[]>`select "playerId", "password"
                                      from "players"
                                      where "playerId" = ${playerId}`
  if (players.length === 0) {
    return { playerId, password, status: AuthStatus.Missing }
  }
  if (players[0].password !== password) {
    return { playerId: '', password: '', status: AuthStatus.Invalid }
  }
  return { playerId, password, status: AuthStatus.Valid }
}

export const saveAuth = async (playerId: string, password: string) => {
  const data = { playerId, password }
  await sql`insert into "players" ${sql(data, 'playerId', 'password')}
            on conflict("playerId") do update set "password" = ${password}, "updatedAt" = now()`
}
