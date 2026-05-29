import fs from 'node:fs'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import type {
  Config, FileData, Game, GameWithTurns, PageResult, Player, RollbackResult, Stats, TurnMetadata,
} from './types.js'
import { projectRoot } from './paths.js'

type FileTable = 'files_content' | 'files_preview'
const dayMs = 24 * 60 * 60 * 1000
const sqliteNowMs = "(cast(round(unixepoch('subsec') * 1000) as INTEGER))"

interface Row {
  [key: string]: unknown
}

export const errRollbackPreviewNotFound = new Error('未找到对应预览记录')

let db: BetterSqlite3.Database | null = null

/**
 * 返回已初始化的数据库连接。
 */
export function getDB(): BetterSqlite3.Database {
  if (!db) {
    throw new Error('数据库未初始化')
  }
  return db
}

/**
 * 初始化 SQLite 连接和迁移。
 */
export function initDatabase(config: Config): void {
  const dir = path.dirname(config.dbPath)
  if (dir !== '' && dir !== '.') {
    fs.mkdirSync(dir, { recursive: true })
  }

  db = new BetterSqlite3(config.dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('cache_size = -32000')
  db.pragma('temp_store = MEMORY')
  db.pragma('page_size = 4096')
  db.pragma('mmap_size = 2147483648')

  runMigrations()
}

/**
 * 关闭数据库连接前更新查询优化器统计信息。
 */
export function closeDatabase(): void {
  if (!db) {
    return
  }
  db.pragma('optimize')
  db.close()
  db = null
}

/**
 * 执行尚未应用的 SQL 迁移。
 */
export function runMigrations(): void {
  const conn = getDB()
  conn.exec(`
    create table if not exists schema_migrations
    (
      version integer primary key,
      name TEXT not null,
      applied_at INTEGER not null default (${sqliteNowMs})
    )
  `)

  const applied = new Set<number>(
    conn.prepare('select version from schema_migrations').all().map((row) => Number((row as Row).version)),
  )
  const migrationsDir = path.join(projectRoot, 'migrations')
  const migrations = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.up.sql'))
    .map((name) => {
      const [versionText, ...rest] = name.split('_')
      return {
        version: Number.parseInt(versionText, 10),
        name: rest.join('_').replace(/\.up\.sql$/, ''),
        sql: fs.readFileSync(path.join(migrationsDir, name), 'utf8'),
      }
    })
    .filter((migration) => Number.isFinite(migration.version))
    .sort((a, b) => a.version - b.version)

  const applyMigration = conn.transaction((version: number, name: string, sql: string) => {
    conn.exec(sql)
    conn.prepare('insert into schema_migrations (version, name) values (?, ?)').run(version, name)
  })

  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      console.info('执行迁移', { version: migration.version, name: migration.name })
      applyMigration(migration.version, migration.name, migration.sql)
    }
  }
}

/**
 * 将 SQLite 文本或 Blob 值转为字符串。
 */
function valueText(value: unknown): string {
  if (value == null) {
    return ''
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8')
  }
  return String(value)
}

/**
 * 将可空 SQLite 值转为可选字符串。
 */
function optionalText(value: unknown): string | undefined {
  const text = valueText(value)
  return text === '' ? undefined : text
}

/**
 * 将 SQLite 时间值转为毫秒时间戳。
 */
function valueTime(value: unknown): number {
  return Number(value ?? 0)
}

/**
 * 将 SQLite 整数布尔值转为 boolean。
 */
function rowBool(value: unknown): boolean {
  return value === true || value === 1
}

/**
 * 解析 files.players JSON 字段。
 */
function parsePlayers(value: unknown): string[] {
  return JSON.parse(valueText(value)) as string[]
}

/**
 * 创建 IN 查询占位符。
 */
function buildInClause(items: unknown[]): string {
  return items.map(() => '?').join(',')
}

/**
 * 返回 UTC 当日零点的毫秒时间戳。
 */
function utcStartOfTodayMs(now: number): number {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/**
 * 返回按 UTC 日历回退指定月份后的毫秒时间戳。
 */
function utcMonthsAgoMs(months: number, now: number): number {
  const date = new Date(now)
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() - months,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  )
}

/**
 * 将数据库行转换为玩家模型。
 */
function rowToPlayer(row: Row): Player {
  return {
    playerId: valueText(row.player_id),
    password: optionalText(row.password),
    createdAt: valueTime(row.created_at),
    updatedAt: valueTime(row.updated_at),
    whitelist: rowBool(row.whitelist),
    remark: valueText(row.remark),
    createIp: optionalText(row.create_ip),
    updateIp: optionalText(row.update_ip),
  }
}

/**
 * 将数据库行转换为游戏模型。
 */
function rowToGame(row: Row): Game {
  return {
    gameId: valueText(row.game_id),
    players: parsePlayers(row.players),
    createdAt: valueTime(row.created_at),
    updatedAt: valueTime(row.updated_at),
    whitelist: rowBool(row.whitelist),
    remark: valueText(row.remark),
  }
}

/**
 * 将数据库行转换为带回合数的游戏模型。
 */
function rowToGameWithTurns(row: Row): GameWithTurns {
  return {
    ...rowToGame(row),
    turns: Number(row.turns ?? 0),
    createdPlayer: valueText(row.created_player),
  }
}

/**
 * 将数据库行转换为存档模型。
 */
function rowToFileData(row: Row): FileData {
  return {
    id: Number(row.id),
    gameId: valueText(row.game_id),
    turns: Number(row.turns ?? 0),
    createdPlayer: valueText(row.created_player),
    createdIp: optionalText(row.created_ip),
    createdAt: valueTime(row.created_at),
    data: valueText(row.data),
  }
}

/**
 * 根据 ID 获取玩家。
 */
export function getPlayerByID(playerId: string): Player | null {
  const row = getDB()
    .prepare(`
      select player_id,
             password,
             created_at,
             updated_at,
             whitelist,
             remark,
             create_ip,
             update_ip
      from players
      where player_id = ?
    `)
    .get(playerId) as Row | undefined

  return row ? rowToPlayer(row) : null
}

/**
 * 创建新玩家。
 */
export function createPlayer(playerId: string, password: string, ip: string): void {
  const now = Date.now()
  getDB()
    .prepare(`
      insert into players (player_id, password, created_at, updated_at, create_ip, update_ip)
      values (?, ?, ?, ?, ?, ?)
    `)
    .run(playerId, password, now, now, ip, ip)
}

/**
 * 更新玩家密码。
 */
export function updatePlayerPassword(playerId: string, password: string, ip: string): void {
  getDB()
    .prepare(`
      update players
      set password   = ?,
          updated_at = ?,
          update_ip  = ?
      where player_id = ?
    `)
    .run(password, Date.now(), ip, playerId)
}

/**
 * 更新玩家最后活跃时间和 IP。
 */
export function updatePlayerLastActive(playerId: string, ip: string): void {
  getDB()
    .prepare(`
      update players
      set updated_at = ?,
          update_ip  = ?
      where player_id = ?
    `)
    .run(Date.now(), ip, playerId)
}

/**
 * 分页查询玩家列表。
 */
export function getPlayersPage(keyword: string, page: number, pageSize: number): PageResult<Player> {
  const conn = getDB()
  const args: unknown[] = []
  let where = ''
  if (keyword !== '') {
    where = ' WHERE player_id LIKE ? OR remark LIKE ?'
    const like = `%${keyword}%`
    args.push(like, like)
  }

  const totalRow = conn.prepare(`select count(*) as total
                                 from players${where}`).get(...args) as Row
  const offset = (page - 1) * pageSize
  const rows = conn
    .prepare(`
      select player_id,
             password,
             created_at,
             updated_at,
             whitelist,
             remark,
             create_ip,
             update_ip
      from players${where}
      order by created_at desc LIMIT ?
      offset ?
    `)
    .all(...args, pageSize, offset) as Row[]

  return { items: rows.map(rowToPlayer), total: Number(totalRow.total ?? 0) }
}

/**
 * 更新玩家白名单和备注。
 */
export function updatePlayerInfo(playerId: string, whitelist: boolean, remark: string): void {
  getDB()
    .prepare(`
      update players
      set whitelist  = ?,
          remark     = ?,
          updated_at = ?
      where player_id = ?
    `)
    .run(whitelist ? 1 : 0, remark, Date.now(), playerId)
}

/**
 * 获取玩家密码。
 */
export function getPlayerPassword(playerId: string): string {
  const row = getDB().prepare('select password from players where player_id = ?').get(playerId) as Row | undefined
  return valueText(row?.password)
}

/**
 * 批量更新玩家白名单状态。
 */
export function batchUpdatePlayersWhitelist(playerIds: string[], whitelist: boolean): void {
  if (!playerIds.length) {
    return
  }
  getDB()
    .prepare(`update players
              set whitelist  = ?,
                  updated_at = ?
              where player_id in (${buildInClause(playerIds)})`)
    .run(whitelist ? 1 : 0, Date.now(), ...playerIds)
}

/**
 * 根据 ID 获取游戏。
 */
export function getGameByID(gameId: string): Game | null {
  const row = getDB()
    .prepare(`
      select game_id, players, created_at, updated_at, whitelist, remark
      from files
      where game_id = ?
    `)
    .get(gameId) as Row | undefined

  return row ? rowToGame(row) : null
}

/**
 * 创建新游戏。
 */
export function createGame(gameId: string, players: string[]): void {
  const now = Date.now()
  getDB()
    .prepare(`
      insert into files (game_id, players, created_at, updated_at)
      values (?, ?, ?, ?)
    `)
    .run(gameId, JSON.stringify(players), now, now)
}

/**
 * 更新游戏玩家列表。
 */
export function updateGamePlayers(gameId: string, players: string[]): void {
  getDB()
    .prepare(`
      update files
      set players    = ?,
          updated_at = ?
      where game_id = ?
    `)
    .run(JSON.stringify(players), Date.now(), gameId)
}

const gamesWithTurnsSelect = `
  select f.game_id,
         f.players,
         f.created_at,
         f.updated_at,
         f.whitelist,
         f.remark,
         coalesce(latest.turns, 0)           as turns,
         coalesce(latest.created_player, '') as created_player
  from files f
         left join files_content latest on latest.id = ( select id
                                                         from files_content
                                                         where game_id = f.game_id
                                                         order by turns desc, created_at desc, id desc LIMIT 1 )
`

/**
 * 分页查询游戏列表。
 */
export function getGamesPage(keyword: string, page: number, pageSize: number): PageResult<GameWithTurns> {
  const conn = getDB()
  const args: unknown[] = []
  let where = ''
  if (keyword !== '') {
    where = ` WHERE f.game_id LIKE ? OR f.remark LIKE ? OR EXISTS (SELECT 1 FROM json_each(f.players) WHERE json_each.value LIKE ?)`
    const like = `%${keyword}%`
    args.push(like, like, like)
  }

  const totalRow = conn.prepare(`select count(*) as total
                                 from files f${where}`).get(...args) as Row
  const offset = (page - 1) * pageSize
  const rows = conn
    .prepare(`
      ${gamesWithTurnsSelect}
      ${where}
      ORDER BY f.updated_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...args, pageSize, offset) as Row[]

  return { items: rows.map(rowToGameWithTurns), total: Number(totalRow.total ?? 0) }
}

/**
 * 获取玩家参与的游戏。
 */
export function getGamesByPlayer(playerId: string): GameWithTurns[] {
  const rows = getDB()
    .prepare(`
      ${gamesWithTurnsSelect}
      WHERE EXISTS (SELECT 1 FROM json_each(f.players) WHERE json_each.value = ?)
      ORDER BY f.updated_at DESC
    `)
    .all(playerId) as Row[]

  return rows.map(rowToGameWithTurns)
}

/**
 * 统计玩家参与的游戏数量。
 */
export function countGamesByPlayer(playerId: string): number {
  const row = getDB()
    .prepare(`
      select count(*) as count
      from files f
      where exists (select 1 from json_each(f.players) where json_each.value = ?)
    `)
    .get(playerId) as Row

  return Number(row.count ?? 0)
}

/**
 * 删除游戏。
 */
export function deleteGame(gameId: string): void {
  getDB().prepare('delete from files where game_id = ?').run(gameId)
}

/**
 * 更新游戏白名单和备注。
 */
export function updateGameInfo(gameId: string, whitelist: boolean, remark: string): void {
  getDB()
    .prepare(`
      update files
      set whitelist  = ?,
          remark     = ?,
          updated_at = ?
      where game_id = ?
    `)
    .run(whitelist ? 1 : 0, remark, Date.now(), gameId)
}

/**
 * 判断玩家是否为游戏创建者。
 */
export function isGameCreator(playerId: string, gameId: string): boolean {
  const row = getDB()
    .prepare(`
      select created_player
      from files_content
      where game_id = ?
      order by created_at, id LIMIT 1
    `)
    .get(gameId) as Row | undefined

  return row ? valueText(row.created_player) === playerId : false
}

/**
 * 统计玩家创建的游戏数量。
 */
export function getGamesCreatedByPlayer(playerId: string): number {
  const row = getDB()
    .prepare(`
      select count(*) as count
      from files_content fc
      where fc.created_player = ?
        and fc.id = ( select id from files_content where game_id = fc.game_id order by created_at
          , id LIMIT 1 )
    `)
    .get(playerId) as Row

  return Number(row.count ?? 0)
}

/**
 * 批量更新游戏白名单状态。
 */
export function batchUpdateGamesWhitelist(gameIds: string[], whitelist: boolean): void {
  if (!gameIds.length) {
    return
  }
  getDB()
    .prepare(`
      update files
      set whitelist  = ?,
          updated_at = ?
      where game_id in (${buildInClause(gameIds)})`)
    .run(whitelist ? 1 : 0, Date.now(), ...gameIds)
}

/**
 * 批量删除游戏。
 */
export function batchDeleteGames(gameIds: string[]): void {
  if (!gameIds.length) {
    return
  }
  getDB().prepare(`
    delete
    from files
    where game_id in (${buildInClause(gameIds)})`)
    .run(...gameIds)
}

/**
 * 获取指定表的最新存档。
 */
function getLatestFileData(table: FileTable, gameId: string): FileData | null {
  const row = getDB()
    .prepare(`
      select id, game_id, turns, created_player, created_ip, created_at, data
      from ${table}
      where game_id = ?
      order by turns desc, created_at desc, id desc LIMIT 1
    `)
    .get(gameId) as Row | undefined

  return row ? rowToFileData(row) : null
}

/**
 * 保存存档到指定表。
 */
function saveFileData(table: FileTable, gameId: string, turns: number, playerId: string, ip: string, data: string): void {
  getDB()
    .prepare(`
      insert into ${table} (game_id, turns, created_player, created_ip, created_at, data)
      values (?, ?, ?, ?, ?, ?)
    `)
    .run(gameId, turns, playerId, ip, Date.now(), data)
}

/**
 * 获取最新正式存档。
 */
export function getLatestFileContent(gameId: string): FileData | null {
  return getLatestFileData('files_content', gameId)
}

/**
 * 保存正式存档。
 */
export function saveFileContent(gameId: string, turns: number, playerId: string, ip: string, data: string): void {
  saveFileData('files_content', gameId, turns, playerId, ip, data)
}

/**
 * 获取最新预览存档。
 */
export function getLatestFilePreview(gameId: string): FileData | null {
  return getLatestFileData('files_preview', gameId)
}

/**
 * 保存预览存档。
 */
export function saveFilePreview(gameId: string, turns: number, playerId: string, ip: string, data: string): void {
  saveFileData('files_preview', gameId, turns, playerId, ip, data)
}

/**
 * 获取游戏全部正式存档。
 */
export function getAllTurnsForGame(gameId: string): FileData[] {
  const rows = getDB()
    .prepare(`
      select id, game_id, turns, created_player, created_ip, created_at, data
      from files_content
      where game_id = ?
      order by turns, created_at, id
    `)
    .all(gameId) as Row[]

  return rows.map(rowToFileData)
}

/**
 * 获取游戏回合元数据。
 */
export function getTurnsMetadata(gameId: string): TurnMetadata[] {
  const rows = getDB()
    .prepare(`
      select id, turns, created_player, created_ip, created_at
      from files_content
      where game_id = ?
      order by turns, created_at, id
    `)
    .all(gameId) as Row[]

  return rows.map((row) => ({
    id: Number(row.id),
    turns: Number(row.turns ?? 0),
    createdPlayer: valueText(row.created_player),
    createdIp: optionalText(row.created_ip),
    createdAt: valueTime(row.created_at),
  }))
}

/**
 * 根据自增 ID 获取正式存档。
 */
export function getTurnByID(turnId: number): FileData | null {
  const row = getDB()
    .prepare(`
      select id, game_id, turns, created_player, created_ip, created_at, data
      from files_content
      where id = ?
    `)
    .get(turnId) as Row | undefined

  return row ? rowToFileData(row) : null
}

/**
 * 删除目标存档之后的记录。
 */
function deleteRowsAfterTarget(table: FileTable, gameId: string, targetId: number): number {
  const result = getDB()
    .prepare(`
      with target as ( select turns, created_at, id from ${table} where id = ? )
      delete
      from ${table}
      where game_id = ?
        and exists ( select 1
                     from target
                     where ${table}.turns > target.turns
                        or (${table}.turns = target.turns and (${table}.created_at > target.created_at or
                                                               (${table}.created_at = target.created_at and ${table}.id > target.id))) )
    `)
    .run(targetId, gameId)

  return result.changes
}

/**
 * 将游戏回退到指定正式存档。
 */
export function rollbackGameToTurn(gameId: string, turnId: number): RollbackResult | null {
  const conn = getDB()
  const rollback = conn.transaction(() => {
    const target = conn
      .prepare(`
        select id, game_id, turns, created_player, created_ip, created_at
        from files_content
        where id = ?
          and game_id = ?
      `)
      .get(turnId, gameId) as Row | undefined

    if (!target) {
      return null
    }

    const createdPlayer = valueText(target.created_player)
    const previewRow = conn
      .prepare(`
        select id
        from files_preview
        where game_id = ?
          and turns = ?
          and created_player is ?
        order by created_at, id LIMIT 1
      `)
      .get(gameId, Number(target.turns), createdPlayer || null) as Row | undefined

    if (!previewRow) {
      throw errRollbackPreviewNotFound
    }

    const deletedTurns = deleteRowsAfterTarget('files_content', gameId, Number(target.id))
    const deletedPreviews = deleteRowsAfterTarget('files_preview', gameId, Number(previewRow.id))
    conn.prepare('update files set updated_at = ? where game_id = ?').run(Date.now(), gameId)

    return {
      deletedTurns,
      deletedPreviews,
      currentTurns: Number(target.turns),
    }
  })

  return rollback()
}

/**
 * 获取管理端统计信息。
 */
export function getAllStats(): Stats {
  const now = Date.now()
  const todayStart = utcStartOfTodayMs(now)
  const sevenDaysAgo = now - 7 * dayMs
  const thirtyDaysAgo = now - 30 * dayMs
  const row = getDB()
    .prepare(`
      with player_stats as ( select count(*)                                                                 as player_count,
                                    coalesce(sum(case when whitelist = 1 then 1 else 0 end), 0)              as whitelist_player_count,
                                    coalesce(sum(case when created_at >= ? then 1 else 0 end),
                                             0)                                                              as today_new_players
                             from players ),
           game_stats as ( select count(*)                                                                 as game_count,
                                  coalesce(sum(case when whitelist = 1 then 1 else 0 end), 0)              as whitelist_game_count,
                                  coalesce(sum(case when created_at >= ? then 1 else 0 end),
                                           0)                                                              as today_new_games
                           from files ),
           content_stats as ( select count(*)                                                                    as total_saves,
                                     coalesce(sum(case when created_at >= ? then 1 else 0 end),
                                              0)                                                                 as today_new_saves,
                                     count(distinct
                                           case when created_player is not null and created_at >= ?
                                                  then created_player end)                                       as active_players_7days,
                                     count(distinct
                                           case when created_player is not null and created_at >= ?
                                                  then created_player end)                                       as active_players_30days,
                                     count(distinct case when created_at >= ?
                                                           then game_id end)                                     as active_games_7days,
                                     count(distinct case when created_at >= ?
                                                           then game_id end)                                     as active_games_30days,
                                     coalesce(max(turns), 0)                                                     as max_game_turns
                              from files_content ),
           turn_stats as ( select coalesce(avg(max_turns), 0) as avg_game_turns
                           from ( select max(turns) as max_turns from files_content group by game_id ) )
      select p.player_count,
             p.whitelist_player_count,
             g.game_count,
             g.whitelist_game_count,
             p.today_new_players,
             g.today_new_games,
             c.active_players_7days,
             c.active_players_30days,
             c.active_games_7days,
             c.active_games_30days,
             c.total_saves,
             c.today_new_saves,
             t.avg_game_turns,
             c.max_game_turns
      from player_stats p,
           game_stats g,
           content_stats c,
           turn_stats t
    `)
    .get(todayStart, todayStart, todayStart, sevenDaysAgo, thirtyDaysAgo, sevenDaysAgo, thirtyDaysAgo) as Row

  return {
    playerCount: Number(row.player_count ?? 0),
    whitelistPlayerCount: Number(row.whitelist_player_count ?? 0),
    gameCount: Number(row.game_count ?? 0),
    whitelistGameCount: Number(row.whitelist_game_count ?? 0),
    todayNewPlayers: Number(row.today_new_players ?? 0),
    todayNewGames: Number(row.today_new_games ?? 0),
    activePlayers7Days: Number(row.active_players_7days ?? 0),
    activePlayers30Days: Number(row.active_players_30days ?? 0),
    activeGames7Days: Number(row.active_games_7days ?? 0),
    activeGames30Days: Number(row.active_games_30days ?? 0),
    totalSaves: Number(row.total_saves ?? 0),
    todayNewSaves: Number(row.today_new_saves ?? 0),
    avgGameTurns: Number(row.avg_game_turns ?? 0),
    maxGameTurns: Number(row.max_game_turns ?? 0),
  }
}

/**
 * 清理过期且非白名单的游戏。
 */
export function cleanupExpiredGames(): number {
  const now = Date.now()
  const result = getDB()
    .prepare(`
      delete
      from files
      where whitelist = 0
        and (updated_at < ? or
             (updated_at = created_at and created_at < ?))
    `)
    .run(utcMonthsAgoMs(3, now), now - dayMs)
  return result.changes
}

/**
 * 清理旧存档记录，只保留每个游戏最新一条。
 */
function cleanupOldFileRecords(table: FileTable): number {
  const result = getDB()
    .prepare(
      `
        delete
        from ${table}
        where exists ( select 1
                       from ${table} t2
                       where t2.game_id = ${table}.game_id
                         and (t2.turns > ${table}.turns or (t2.turns = ${table}.turns and
                                                            (t2.created_at > ${table}.created_at or
                                                             (t2.created_at = ${table}.created_at and t2.id > ${table}.id)))) )
      `,
    )
    .run()
  return result.changes
}

/**
 * 清理旧预览记录。
 */
export function cleanupOldPreviews(): number {
  return cleanupOldFileRecords('files_preview')
}

/**
 * 清理旧正式存档记录。
 */
export function cleanupOldContents(): number {
  return cleanupOldFileRecords('files_content')
}

/**
 * 执行全部数据清理任务。
 */
export function runCleanup(): void {
  const games = cleanupExpiredGames()
  const previews = cleanupOldPreviews()
  const contents = cleanupOldContents()
  const conn = getDB()
  conn.exec('ANALYZE')
  conn.exec('VACUUM')
  console.info('数据清理任务完成', { games, previews, contents })
}
