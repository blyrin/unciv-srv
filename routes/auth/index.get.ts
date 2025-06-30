export default defineEventHandler(async (event) => {
  const header = getHeader(event, 'authorization')
  const { playerId, password, status } = await loadAuth(header)
  if (status === AuthStatus.Invalid) {
    throw createError({
      status: 401,
      message: '密码错误',
    })
  }
  if (status === AuthStatus.Missing) {
    if (password.length < 6 || password.length > 128) {
      throw createError({
        status: 400,
        message: '密码长度错误',
      })
    }
    await saveUser(playerId, password, event.context.ip)
  }
  return playerId
})
