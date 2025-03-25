import { log } from './libs/log.ts'
import { app } from './bin/app.ts'

const PORT = +(Deno.env.get('PORT') || 11451)

if (import.meta.main) {
  const abortController = new AbortController()
  Deno.addSignalListener('SIGINT', () => {
    log.info('关闭中...')
    abortController.abort()
    Deno.exit()
  })
  try {
    log.info(`监听端口: ${PORT}`)
    app.listen({ port: PORT, signal: abortController.signal })
  } catch (err) {
    log.error(err)
    Deno.exit()
  }
}
