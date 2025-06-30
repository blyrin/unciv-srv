export default defineTask({
  meta: {
    name: 'cleanup',
  },
  async run() {
    const sql = db()
    const [{ deletedGameCount }] = await sql<{ deletedGameCount: number }[]>`SELECT * FROM sp_cleanup_data()`
    console.log(`清理完成, 共删除 ${deletedGameCount} 个存档`)
    return { result: deletedGameCount }
  },
})
