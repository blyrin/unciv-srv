export default defineEventHandler(async (event) => {
  const header = getHeader(event, 'authorization')
  const { playerId, status } = await loadAuth(header)
  if (status === AuthStatus.Invalid) {
    throw createError({
      status: 401,
      message: '密码错误',
    })
  }
  const password = await readBody(event)
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    throw createError({
      status: 401,
      message: '密码长度错误',
    })
  }
  await saveUser(playerId, password, event.context.ip)
  return playerId
})
