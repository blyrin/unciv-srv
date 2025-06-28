import postgres from 'npm:postgres'

const env = Deno.env

export const sql = postgres({
  host: env.get('DB_HOST') || 'localhost',
  port: +(env.get('DB_PORT') || 5432),
  database: env.get('DB_NAME') || 'unciv-srv',
  user: env.get('DB_USER') || 'postgres',
  password: env.get('DB_PASSWORD') || 'postgres',
  transform: postgres.camel,
})

const cleanup = async () => {
  const [result] = await sql<{ deletedGameCount: number }[]>`SELECT * FROM sp_cleanup_data()`
  const { deletedGameCount } = result
  console.log(`清理完成, 共删除 ${deletedGameCount} 个存档`)
}

await cleanup()

Deno.exit()
