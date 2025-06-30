import { type H3Event } from 'h3'

export const loadAuth = async (authHeader?: string | null): Promise<PlayerWithAuth> => {
  const invalidAuth = { playerId: '', password: '', status: AuthStatus.Invalid }
  if (!authHeader) return invalidAuth
  const [type, token] = authHeader.split(' ')
  if (type !== 'Basic' || !token) return invalidAuth
  const decoded = Buffer.from(token, 'base64').toString('utf-8')
  const [playerId, password] = decoded.split(':')
  if (!playerId || !password) return invalidAuth
  const player = await loadUser(playerId)
  if (!player) return { playerId, password, status: AuthStatus.Missing }
  if (player.password !== password) return invalidAuth
  return { playerId, password, status: AuthStatus.Valid }
}

export const loadPlayerId = async (authorization?: string | null): Promise<string> => {
  const { status: authStatus, playerId } = await loadAuth(authorization)
  if (authStatus !== AuthStatus.Valid) {
    throw createError({
      status: 401,
      message: '密码错误或未设置密码',
    })
  }
  return playerId
}

export const loadAdminAuth = async (authHeader?: string | null): Promise<AdminAuth> => {
  const config = useRuntimeConfig()
  const adminUsername = config.adminUsername
  const adminPassword = config.adminPassword
  if (!authHeader) {
    return { username: '', password: '', isAdmin: false }
  }
  const [type, token] = authHeader.split(' ')
  if (type !== 'Basic' || !token) {
    return { username: '', password: '', isAdmin: false }
  }
  const decoded = Buffer.from(token, 'base64').toString('utf-8')
  const [username, password] = decoded.split(':')
  if (username === adminUsername && password === adminPassword) {
    return { username, password, isAdmin: true }
  }
  return { username, password, isAdmin: false }
}

const sessions = new Map<string, UserSession>()

export const generateSessionId = (): string => {
  return crypto.randomUUID()
}

export const setSessionCookie = (event: H3Event, sessionId: string) => {
  setCookie(event, 'session', sessionId, { httpOnly: true, path: '/', maxAge: 86400 })
}

export const getSessionId = (event: H3Event): string | null => {
  return getCookie(event, 'session') || null
}

export const getUserSession = async (event: H3Event, authorization?: string | null): Promise<UserSession> => {
  const sessionId = getSessionId(event)
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!
  }
  const authHeader = authorization ?? getHeader(event, 'authorization')
  const adminAuth = await loadAdminAuth(authHeader)
  if (adminAuth.isAdmin) {
    return { isAdmin: true, authenticated: true }
  }
  try {
    const { status, playerId } = await loadAuth(authHeader)
    if (status === AuthStatus.Valid) {
      return { playerId, isAdmin: false, authenticated: true }
    }
  } catch (_error) {
    /* ignore */
  }
  return { isAdmin: false, authenticated: false }
}

export const setUserSession = (sessionId: string, session: UserSession) => {
  sessions.set(sessionId, session)
}

export const deleteUserSession = (sessionId: string) => {
  sessions.delete(sessionId)
}
