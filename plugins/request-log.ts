export default defineNitroPlugin((nitro) => {
  const log = logger.withTag('http')
  nitro.hooks.hook('request', (event) => {
    event.context.requestTime = Date.now()
    event.context.ua = getHeader(event, 'user-agent') ?? ''
    event.context.ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  })
  nitro.hooks.hook('error', (error, { event }) => {
    const requestTime = event.context.requestTime
    const data = `${error.message} ${(error as any).data ?? ''}`
    const time = Date.now() - requestTime
    const method = event.method
    const path = event.path
    const status = getResponseStatus(event)
    const ua = event.context.ua
    const ip = event.context.ip
    log.withTag('error').error(`${error.name}: ${data}`, '\n', status, method, path, `${time}ms`, ip, ua)
    log.withTag('error').debug(error)
  })
  nitro.hooks.hook('afterResponse', (event) => {
    const requestTime = event.context.requestTime
    const time = Date.now() - requestTime
    const method = event.method
    const path = event.path
    const status = getResponseStatus(event)
    const ua = event.context.ua
    const ip = event.context.ip
    log.withTag('request').info(status, method, path, `${time}ms`, ip, ua)
  })
})
