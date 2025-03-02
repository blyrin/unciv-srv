import { sql } from './libs/db.ts'
import { log } from './libs/log.ts'

const cleanup = async () => {
  const [deletedGameCount, deletedPlayerCount] = await sql.begin(async (sql) => {
    const deletedGames = await sql`
        delete
        from files
        where "whitelist" = false
          and ((now() - interval '3 months') > updated_at
            or ((now() - interval '1 days') > created_at
                and (created_at + interval '10 minutes') > updated_at))
        returning game_id`
    if (deletedGames.length > 0) {
      const gameIds = sql(deletedGames.map((g) => g.gameId))
      await sql`
          delete
          from files_preview
        where game_id in ${gameIds}`
      await sql`
          delete
          from files_content
          where game_id in ${gameIds}`
    }
    const deletedPlayers = await sql`
        delete
        from players
        where whitelist = false
          and players.player_id not in
              (select distinct player_id
               from files,
                    jsonb_array_elements(files.players) AS player_id)
          and (now() - interval '3 months') > updated_at
        returning player_id`
    return [deletedGames.length, deletedPlayers.length]
  })
  log.info(`清理完成, 共删除 ${deletedGameCount} 个存档, ${deletedPlayerCount} 个玩家`)
}

export const startTask = async () => {
  await cleanup()
  await Deno.cron('cleanup', '* 5 * * 2', cleanup)
}
