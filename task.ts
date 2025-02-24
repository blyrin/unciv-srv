import { sql } from './libs/db.ts'
import { log } from './libs/log.ts'
import { cache } from './libs/cache.ts'

const cleanup = async () => {
  const [deletedGameCount, deletedPlayerCount] = await sql.begin(async (sql) => {
    const deletedGames = await sql`
        delete
        from files
        where "whitelist" = false
          and ((now() - interval '3 months') > updated_at
            or ((now() - interval '3 days') > created_at
                and (created_at + interval '10 minutes') > updated_at))
        returning game_id`
    const deletedPlayers = await sql`
        delete
        from players
        where whitelist = false
          and players.player_id not in
              (select distinct jsonb_extract_path_text(players, 'playerId')::uuid AS player_id
               from files,
                    jsonb_array_elements(jsonb_extract_path(preview, 'gameParameters', 'players')) as players
               where jsonb_extract_path_text(players, 'playerType') = 'Human')
          and (now() - interval '3 months') > updated_at
        returning player_id`
    return [deletedGames.length, deletedPlayers.length]
  })
  await cache.flushDb()
  log.info(`清理完成, 共删除 ${deletedGameCount} 个存档, ${deletedPlayerCount} 个玩家`)
}

export const startTask = async () => {
  await cleanup()
  await Deno.cron('cleanup', '* 5 * * 2', cleanup)
}
