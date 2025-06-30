export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const username = body?.username?.toString() || ''
  const password = body?.password?.toString() || ''
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const tempSession = await getUserSession(event, authHeader)
  if (!tempSession.authenticated) {
    throw createError({ status: 401, message: '用户名或密码错误' })
  }
  const sessionId = generateSessionId()
  setUserSession(sessionId, tempSession)
  setSessionCookie(event, sessionId)
  if (tempSession.isAdmin) {
    return { redirect: '/admin/' }
  } else {
    return { redirect: '/user/' }
  }
})
