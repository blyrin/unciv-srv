import { sql } from './libs/db.ts'
import { log } from './libs/log.ts'

const cleanup = async () => {
  const [deletedGameCount, deletedPlayerCount] = await sql.begin(async (sql) => {
    const deletedGames = await sql`
        delete
        from "files"
        where "whitelist" = false
          and "updatedAt" < (now() - interval '3 months')
        returning "gameId"`
    const deletedPlayers = await sql`
        delete
        from "players"
        where "whitelist" = false
          and "playerId" not in (select distinct (jsonb_array_elements_text("playerIds"))::uuid from "files")
          and "updatedAt" < (now() - interval '3 months')
        returning "playerId"`
    return [deletedGames.length, deletedPlayers.length]
  })
  log.info(`清理完成, 共删除 ${deletedGameCount} 个存档, ${deletedPlayerCount} 个玩家`)
}

export const startTask = async () => {
  await cleanup()
  await Deno.cron('cleanup', '* 5 * * 2', cleanup)
}
