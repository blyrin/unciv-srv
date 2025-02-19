import { sql } from './libs/db.ts'
import { log } from './libs/log.ts'

const cleanup = async () => {
  log.info('执行清理...')
  const whitelist = (await Deno.readTextFile('./whitelist'))
    .split(/\r?\n|\r/)
    .filter((line) => line.trim() !== '')
  const result = await sql`delete
                           from "files"
                           where "gameId" not in ${sql(whitelist)}
                             and "updatedAt" < (now() - interval '3 months')
                           returning "gameId"`
  const deletedGameIds = result.map((r) => r.gameId)
  log.info(`清理完成, 共删除 ${deletedGameIds.length} 个`, deletedGameIds.join(','))
}

export const startTask = async () => {
  await cleanup()
  await Deno.cron('cleanup', '* 5 * * 2', cleanup)
}
