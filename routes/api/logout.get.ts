export default defineEventHandler((event) => {
  const sessionId = getSessionId(event)
  if (sessionId) {
    deleteUserSession(sessionId)
  }
  setCookie(event, 'session', '', { httpOnly: true, path: '/', maxAge: 0 })
  return sendRedirect(event, '/', 302)
})
