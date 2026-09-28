import fs from 'node:fs'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import type {
  Config, FileData, Game, GameWithTurns, PageResult, Player, PlayerListEntry, RollbackResult, Stats, TurnMetadata,
} from './types.js'
import { projectRoot, resolveRepoPath } from './paths.js'
import { hashPassword, isHashedPassword } from './password.js'
import { getIPRetentionDays, ipForStorage, setIPRetentionDays, setIPStorageMode } from './privacy.js'

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

  setIPStorageMode(config.ipStorage)
  setIPRetentionDays(config.ipRetentionDays)
  const migrated = migratePlayerPasswords()
  if (migrated > 0) {
    console.info(`已把 ${migrated} 个账号的明文密码升级为哈希存储`)
  }
  clearExpiredIPs()
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

interface MigrationFile {
  version: number
  name: string
  upSql: string
  downSql: string | null
}

/**
 * 读取 migrations 目录下的所有迁移，按版本升序排列。
 * 每个迁移的 down SQL 可选，缺失时置为 null。
 */
function readMigrationFiles(): MigrationFile[] {
  const migrationsDir = path.join(projectRoot, 'migrations')
  const migrations = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.up.sql'))
    .map((upName) => {
      const [versionText, ...rest] = upName.split('_')
      const name = rest.join('_').replace(/\.up\.sql$/, '')
      const downName = `${versionText}_${name}.down.sql`
      const downPath = path.join(migrationsDir, downName)
      return {
        version: Number.parseInt(versionText, 10),
        name,
        upSql: fs.readFileSync(path.join(migrationsDir, upName), 'utf8'),
        downSql: fs.existsSync(downPath) ? fs.readFileSync(downPath, 'utf8') : null,
      }
    })
    .filter((migration) => Number.isFinite(migration.version))
    .sort((a, b) => a.version - b.version)
  return migrations
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

  const migrationColumns = new Set(
    (conn.prepare('pragma table_info(schema_migrations)').all() as Row[]).map((row) => String(row.name)),
  )
  if (!migrationColumns.has('name')) {
    // Older installations created this table without the migration name column.
    conn.exec("alter table schema_migrations add column name TEXT not null default ''")
  }

  const applied = new Set<number>(
    conn.prepare('select version from schema_migrations').all().map((row) => Number((row as Row).version)),
  )
  const migrations = readMigrationFiles()

  const applyMigration = conn.transaction((version: number, name: string, sql: string) => {
    conn.exec(sql)
    conn.prepare('insert into schema_migrations (version, name) values (?, ?)').run(version, name)
  })

  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      console.info('执行迁移', { version: migration.version, name: migration.name })
      applyMigration(migration.version, migration.name, migration.upSql)
    }
  }
}

export interface MigrationRollbackResult {
  version: number
  name: string
}

/**
 * 回滚最后一个已应用的迁移：执行对应的 .down.sql 并删除版本记录。
 * 没有已应用的迁移时返回 null；缺少 .down.sql 时抛错。
 */
export function rollbackLastMigration(): MigrationRollbackResult | null {
  const conn = getDB()
  const row = conn
    .prepare('select version, name from schema_migrations order by version desc limit 1')
    .get() as Row | undefined
  if (!row) {
    return null
  }

  const version = Number(row.version)
  const name = String(row.name)
  const migration = readMigrationFiles().find((item) => item.version === version)
  if (!migration || migration.downSql == null) {
    throw new Error(`迁移 ${version} 缺少对应的 .down.sql 文件，无法回滚`)
  }

  const rollback = conn.transaction(() => {
    conn.exec(migration.downSql as string)
    conn.prepare('delete from schema_migrations where version = ?').run(version)
  })
  rollback()
  console.info('回滚迁移', { version, name })
  return { version, name }
}

/**
 * 轻量健康检查：执行 `select 1`，供 /ready 就绪探针使用。
 */
export function isDatabaseHealthy(): boolean {
  try {
    getDB().prepare('select 1').get()
    return true
  } catch {
    return false
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
 * 将数据库行转换为玩家模型。
 */
function rowToPlayer(row: Row): Player {
  return {
    playerId: valueText(row.player_id),
    password: optionalText(row.password),
    createdAt: valueTime(row.created_at),
    updatedAt: valueTime(row.updated_at),
    whitelist: rowBool(row.whitelist),
    // 缺列（历史数据或旧查询）一律按未审核处理，避免漏审账号直接可用
    approved: row.approved == null ? false : rowBool(row.approved),
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
             approved,
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
 * 创建新玩家，密码以哈希形式入库。
 * approved 默认 true，用于管理员/脚本预建的账号；玩家自助注册由中间件按注册模式显式传参。
 */
export function createPlayer(playerId: string, password: string, ip: string, approved = true): void {
  const now = Date.now()
  const storageIp = ipForStorage(ip)
  getDB()
    .prepare(`
      insert into players (player_id, password, created_at, updated_at, whitelist, approved, remark, create_ip, update_ip)
      values (?, ?, ?, ?, 0, ?, '', ?, ?)
    `)
    .run(playerId, hashPassword(password), now, now, approved ? 1 : 0, storageIp, storageIp)
}

/**
 * 更新玩家密码（哈希存储）。
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
    .run(hashPassword(password), Date.now(), ipForStorage(ip), playerId)
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
    .run(Date.now(), ipForStorage(ip), playerId)
}

/**
 * 更新玩家审核状态。
 */
export function setPlayerApproved(playerId: string, approved: boolean): void {
  getDB()
    .prepare(`
      update players
      set approved   = ?,
          updated_at = ?
      where player_id = ?
    `)
    .run(approved ? 1 : 0, Date.now(), playerId)
}

/**
 * 批量更新玩家审核状态。
 */
export function batchUpdatePlayersApproval(playerIds: string[], approved: boolean): void {
  if (!playerIds.length) {
    return
  }
  getDB()
    .prepare(`update players
              set approved   = ?,
                  updated_at = ?
              where player_id in (${buildInClause(playerIds)})`)
    .run(approved ? 1 : 0, Date.now(), ...playerIds)
}

/**
 * 把旧库中的明文密码原地替换为哈希，返回迁移数量。
 */
export function migratePlayerPasswords(): number {
  const conn = getDB()
  const rows = conn.prepare('select player_id, password from players').all() as Row[]
  const update = conn.prepare('update players set password = ? where player_id = ?')
  let migrated = 0
  const migrate = conn.transaction(() => {
    for (const row of rows) {
      const stored = valueText(row.password)
      if (stored === '' || isHashedPassword(stored)) {
        continue
      }
      update.run(hashPassword(stored), valueText(row.player_id))
      migrated += 1
    }
  })
  migrate()
  return migrated
}

/**
 * 清空超过保留期的历史 IP，返回受影响的玩家数与存档数。
 */
export function clearExpiredIPs(retentionDays = getIPRetentionDays()): { players: number; files: number } {
  if (retentionDays <= 0) {
    return { players: 0, files: 0 }
  }
  const conn = getDB()
  const cutoff = Date.now() - retentionDays * dayMs
  const players = conn.prepare(`
    update players
    set create_ip = case when created_at < ? then null else create_ip end,
        update_ip = case when updated_at < ? then null else update_ip end
    where (create_ip is not null and created_at < ?)
       or (update_ip is not null and updated_at < ?)
  `).run(cutoff, cutoff, cutoff, cutoff).changes
  const content = conn.prepare(`
    update files_content set created_ip = null where created_ip is not null and created_at < ?
  `).run(cutoff).changes
  const preview = conn.prepare(`
    update files_preview set created_ip = null where created_ip is not null and created_at < ?
  `).run(cutoff).changes
  return { players, files: content + preview }
}

/** 玩家列表的审核状态筛选 */
export type PlayerListStatusFilter = 'all' | 'pending' | 'approved'
/** 玩家列表的白名单筛选 */
export type PlayerListWhitelistFilter = 'all' | 'yes' | 'no'
/** 玩家列表的排序方式 */
export type PlayerListSort = 'created_desc' | 'created_asc' | 'updated_desc' | 'updated_asc'

export interface GetPlayersPageOptions {
  page: number
  pageSize: number
  keyword?: string
  status?: PlayerListStatusFilter
  whitelist?: PlayerListWhitelistFilter
  sort?: PlayerListSort
}

/** 排序只允许这几个固定字段，避免把查询参数直接拼进 SQL */
const playerListOrderBy: Record<PlayerListSort, string> = {
  created_desc: 'created_at desc',
  created_asc: 'created_at asc',
  updated_desc: 'updated_at desc',
  updated_asc: 'updated_at asc',
}

/**
 * 分页查询玩家列表，支持关键词、审核状态、白名单与排序筛选。
 * 每行附带该玩家参与的对局数，方便审核时判断账号是否真的在用。
 */
export function getPlayersPage(options: GetPlayersPageOptions): PageResult<PlayerListEntry> {
  const conn = getDB()
  const conditions: string[] = []
  const args: unknown[] = []
  const keyword = (options.keyword ?? '').trim()
  if (keyword !== '') {
    conditions.push('(player_id LIKE ? OR remark LIKE ?)')
    const like = `%${keyword}%`
    args.push(like, like)
  }
  if (options.status === 'pending') {
    conditions.push('approved = 0')
  } else if (options.status === 'approved') {
    conditions.push('approved = 1')
  }
  if (options.whitelist === 'yes') {
    conditions.push('whitelist = 1')
  } else if (options.whitelist === 'no') {
    conditions.push('whitelist = 0')
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''

  const totalRow = conn.prepare(`select count(*) as total
                                 from players${where}`).get(...args) as Row
  const offset = (options.page - 1) * options.pageSize
  const rows = conn
    .prepare(`
      select player_id,
             password,
             created_at,
             updated_at,
             whitelist,
             approved,
             remark,
             create_ip,
             update_ip,
             (select count(*)
              from files f
              where exists (select 1 from json_each(f.players) where json_each.value = players.player_id)) as game_count
      from players${where}
      order by ${playerListOrderBy[options.sort ?? 'created_desc']}
      LIMIT ? offset ?
    `)
    .all(...args, options.pageSize, offset) as Row[]

  return {
    items: rows.map((row) => ({ ...rowToPlayer(row), gameCount: Number(row.game_count ?? 0) })),
    total: Number(totalRow.total ?? 0),
  }
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
    .run(gameId, turns, playerId, ipForStorage(ip), Date.now(), data)
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
export function acquireSimultaneousTurnLock(gameId: string, turn: number, owner: string, now = Date.now()): boolean {
  const result = getDB().prepare(`
    insert into simultaneous_turn_locks (game_id, turn, owner, acquired_at)
    values (?, ?, ?, ?)
    on conflict(game_id) do update set turn = excluded.turn, owner = excluded.owner, acquired_at = excluded.acquired_at
    where simultaneous_turn_locks.turn = excluded.turn
      and (simultaneous_turn_locks.owner = excluded.owner or simultaneous_turn_locks.acquired_at < ?)
  `).run(gameId, turn, owner, now, now - 120_000)
  return result.changes > 0
}

export function releaseSimultaneousTurnLock(gameId: string, turn: number, owner: string): void {
  getDB().prepare(`
    delete from simultaneous_turn_locks where game_id = ? and turn = ? and owner = ?
  `).run(gameId, turn, owner)
}


/**
 * 获取最新预览存档。
 */
export function appendSimultaneousTurnOperations(
  gameId: string, playerId: string, incoming: unknown[],
): void {
  const normalize = (operation: unknown, expectedPlayerId?: string): Record<string, unknown> => {
    if (!operation || typeof operation !== 'object') throw new Error('操作数据项无效')
    const item = operation as Record<string, unknown>
    const turn = item.turn ?? 0
    const sequence = item.sequence ?? 0
    if (!Number.isInteger(turn) || Number(turn) < 0) throw new Error('操作回合无效')
    if (!Number.isInteger(sequence) || Number(sequence) < 0) throw new Error('操作序号无效')
    if (typeof item.playerId !== 'string' || !item.playerId) throw new Error('操作玩家无效')
    if (expectedPlayerId && item.playerId !== expectedPlayerId) throw new Error('不能提交其他玩家的操作')
    if (typeof item.type !== 'string' || !item.type) throw new Error('操作类型无效')
    return { ...item, turn, sequence }
  }

  const db = getDB()
  const transaction = db.transaction(() => {
    const row = db.prepare('select data from simultaneous_turn_operations where game_id = ?').get(gameId) as Row | undefined
    let existing: unknown[] = []
    if (row) {
      const parsed = JSON.parse(valueText(row.data)) as unknown
      if (!Array.isArray(parsed)) throw new Error('操作数据不是数组')
      existing = parsed
    }
    const operations = [
      ...existing.map((operation) => normalize(operation)),
      ...incoming.map((operation) => normalize(operation, playerId)),
    ]
    const seen = new Set<string>()
    const merged = operations.filter((operation) => {
      const key = `${String(operation.turn)}:${String(operation.playerId)}:${String(operation.sequence)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    db.prepare(`
      insert into simultaneous_turn_operations (game_id, data, updated_at)
      values (?, ?, ?)
      on conflict(game_id) do update set data = excluded.data, updated_at = excluded.updated_at
    `).run(gameId, JSON.stringify(merged), Date.now())
  })
  transaction()
}

export function getSimultaneousTurnOperations(gameId: string): string | null {
  const row = getDB().prepare('select data from simultaneous_turn_operations where game_id = ?').get(gameId) as Row | undefined
  return row ? valueText(row.data) : null
}

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
                                    coalesce(sum(case when approved = 0 then 1 else 0 end), 0)               as pending_player_count,
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
             p.pending_player_count,
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
    pendingPlayerCount: Number(row.pending_player_count ?? 0),
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
 * 清理从未保存过正式存档的空对局（创建超过一天仍没有 files_content 记录）。
 * 这类对局没有可以归档的存档内容，直接删除记录：不写归档文件，也不留恢复墓碑。
 */
export function cleanupEmptyGames(): number {
  const now = Date.now()
  const result = getDB()
    .prepare(`
      delete
      from files
      where not exists (select 1 from files_content c where c.game_id = files.game_id)
        and created_at < ?
    `)
    .run(now - dayMs)
  return result.changes
}

/**
 * 当前存档数据总量（正式存档与预览的正文字节数之和），归档阈值以它为准。
 */
export function getArchiveUsage(): number {
  const row = getDB()
    .prepare(`
      select (select coalesce(sum(length(data)), 0) from files_content) +
             (select coalesce(sum(length(data)), 0) from files_preview) as total_bytes
    `)
    .get() as Row | undefined
  return Number(row?.total_bytes ?? 0)
}

/** 归档文件格式版本 */
const archiveVersion = 1

/** 每局归档记录的内容（JSON Lines 文件里的一行） */
export interface ArchivedGame {
  version: number
  gameId: string
  players: string[]
  whitelist: boolean
  remark: string
  createdAt: number
  updatedAt: number
  turns: number
  contentPlayer: string
  contentCreatedAt: number
  data: string
  previewTurns: number | null
  previewData: string | null
}

export interface ArchiveResult {
  games: number
  bytes: number
}

/** 归档文件名前缀，完整形如 unciv-archive-20260927-200000Z.jsonl */
export const archiveFileNamePrefix = 'unciv-archive-'

/** 归档文件名中的时间戳用 UTC，避免容器时区与本地时间混淆 */
function archiveFileName(date = new Date()): string {
  const pad = (value: number) => `${value}`.padStart(2, '0')
  const stamp =
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  return `${archiveFileNamePrefix}${stamp}Z.jsonl`
}

/** 把一局对局组装成归档记录，没有正式存档的空对局返回 null */
function buildArchivedGame(gameId: string): ArchivedGame | null {
  const game = getGameByID(gameId)
  const content = getLatestFileContent(gameId)
  if (game == null || content == null) return null
  const preview = getLatestFilePreview(gameId)
  return {
    version: archiveVersion,
    gameId: game.gameId,
    players: game.players,
    whitelist: game.whitelist,
    remark: game.remark,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    turns: content.turns,
    contentPlayer: content.createdPlayer,
    contentCreatedAt: content.createdAt,
    data: content.data,
    previewTurns: preview?.turns ?? null,
    previewData: preview?.data ?? null,
  }
}

/**
 * 存档数据总量超过 maxBytes 时，按最久未使用（updated_at 最小）的顺序归档非白名单对局，
 * 直到总量回到阈值以内。归档写成一个 JSON Lines 文件（每行一局，文件本身不压缩，
 * 交给加密归档工具 bvault 的 tar.zstd.gpg 处理）：全部写入成功后再在一个事务里
 * 删除数据库记录并留下恢复墓碑，任何一局写入失败都会中止本次归档，不删除任何记录。
 */
export function archiveColdGames(archiveDir: string, maxBytes: number): ArchiveResult {
  const usedBytes = getArchiveUsage()
  if (maxBytes <= 0 || usedBytes <= maxBytes) {
    return { games: 0, bytes: 0 }
  }

  const conn = getDB()
  const candidates = conn
    .prepare(`
      select f.game_id as game_id,
             coalesce((select sum(length(c.data)) from files_content c where c.game_id = f.game_id), 0) +
             coalesce((select sum(length(p.data)) from files_preview p where p.game_id = f.game_id), 0) as bytes
      from files f
      where f.whitelist = 0
      order by f.updated_at asc, f.created_at asc
    `)
    .all() as { game_id: string; bytes: number }[]

  let remaining = usedBytes
  const selected: string[] = []
  for (const row of candidates) {
    if (remaining <= maxBytes) break
    if (row.bytes <= 0) continue
    selected.push(row.game_id)
    remaining -= row.bytes
  }

  if (selected.length === 0) {
    console.info('存档总量超过阈值，但没有可归档的非白名单对局', { usedBytes, maxBytes })
    return { games: 0, bytes: 0 }
  }

  fs.mkdirSync(archiveDir, { recursive: true })
  const file = path.join(archiveDir, archiveFileName())
  const tempFile = `${file}.tmp`
  let bytes = 0

  const handle = fs.openSync(tempFile, 'w')
  try {
    for (const gameId of selected) {
      const archived = buildArchivedGame(gameId)
      if (archived == null) continue
      const line = `${JSON.stringify(archived)}\n`
      fs.writeSync(handle, line)
      bytes += Buffer.byteLength(line)
    }
    fs.fsyncSync(handle)
  } catch (error) {
    fs.closeSync(handle)
    fs.rmSync(tempFile, { force: true })
    throw error
  }
  fs.closeSync(handle)

  if (bytes === 0) {
    // 没有可归档的存档内容时不留空文件
    fs.rmSync(tempFile, { force: true })
  } else {
    fs.renameSync(tempFile, file)
  }

  const archiveFile = bytes === 0 ? '' : path.basename(file)
  const archivedAt = Date.now()
  const remove = conn.prepare('delete from files where game_id = ?')
  const remember = conn.prepare(`
    insert into archived_games (game_id, archive_file, archived_at, restore_requested_at, requested_by)
    values (?, ?, ?, null, '')
    on conflict(game_id) do update set archive_file         = excluded.archive_file,
                                       archived_at          = excluded.archived_at,
                                       restore_requested_at = null,
                                       requested_by         = ''
  `)
  conn.transaction(() => {
    for (const gameId of selected) {
      remove.run(gameId)
      remember.run(gameId, archiveFile, archivedAt)
    }
  })()

  return { games: selected.length, bytes }
}

/** 冷归档墓碑：对局被归档后留下的记录，用于区分「不存在」与「已冷归档」并登记恢复请求 */
export interface ArchivedGameRecord {
  gameId: string
  /** 归档文件名（不含目录），空字符串表示该对局没有保存过任何存档内容 */
  archiveFile: string
  archivedAt: number
  /** 玩家请求恢复的时间，null 表示没人请求过 */
  restoreRequestedAt: number | null
  /** 最近一次请求恢复的玩家 */
  requestedBy: string
}

function rowToArchivedGameRecord(row: Row): ArchivedGameRecord {
  return {
    gameId: valueText(row.game_id),
    archiveFile: valueText(row.archive_file),
    archivedAt: valueTime(row.archived_at),
    restoreRequestedAt: row.restore_requested_at == null ? null : valueTime(row.restore_requested_at),
    requestedBy: valueText(row.requested_by),
  }
}

/** 查询某个对局是否已被冷归档 */
export function getArchivedGameRecord(gameId: string): ArchivedGameRecord | null {
  const row = getDB()
    .prepare(`
      select game_id, archive_file, archived_at, restore_requested_at, requested_by
      from archived_games
      where game_id = ?
    `)
    .get(gameId) as Row | undefined
  return row == null ? null : rowToArchivedGameRecord(row)
}

/**
 * 玩家访问已冷归档的对局时登记一次恢复请求：
 * 保留最早的请求时间（管理员能看到玩家等了多久），请求者记为最近一次访问的玩家。
 */
export function requestArchivedGameRestore(gameId: string, playerId: string): void {
  getDB()
    .prepare(`
      update archived_games
      set restore_requested_at = coalesce(restore_requested_at, ?),
          requested_by         = ?
      where game_id = ?
    `)
    .run(Date.now(), playerId, gameId)
}

/** 管理员：待恢复的冷存档列表（按请求时间从早到晚） */
export function getRestoreRequests(): ArchivedGameRecord[] {
  const rows = getDB()
    .prepare(`
      select game_id, archive_file, archived_at, restore_requested_at, requested_by
      from archived_games
      where restore_requested_at is not null
      order by restore_requested_at asc
    `)
    .all() as Row[]
  return rows.map(rowToArchivedGameRecord)
}

/** 管理员：放弃恢复某局冷存档（删除墓碑，之后玩家再访问会被当作普通的不存在对局） */
export function clearArchivedGame(gameId: string): number {
  return getDB().prepare('delete from archived_games where game_id = ?').run(gameId).changes
}

/**
 * 从归档文件恢复对局，保留原对局 ID、存档回合与时间戳；
 * gameId 为空时恢复文件里的全部对局，否则只恢复指定对局。
 */
export function restoreArchivedGames(file: string, gameId?: string): ArchivedGame[] {
  const archivedGames: ArchivedGame[] = []
  const content = fs.readFileSync(file, 'utf8')
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue
    let archived: ArchivedGame
    try {
      archived = JSON.parse(line) as ArchivedGame
    } catch {
      throw new Error(`归档文件格式不受支持：${file}`)
    }
    if (archived.version !== archiveVersion || !archived.gameId || typeof archived.data !== 'string') {
      throw new Error(`归档文件格式不受支持：${file}`)
    }
    if (gameId != null && archived.gameId !== gameId) continue
    archivedGames.push(archived)
  }

  if (archivedGames.length === 0) {
    throw new Error(gameId == null ? `归档文件里没有对局：${file}` : `归档文件里没有对局 ${gameId}：${file}`)
  }

  const conn = getDB()
  conn.transaction(() => {
    for (const archived of archivedGames) {
      conn
        .prepare(`
          insert into files (game_id, players, created_at, updated_at, whitelist, remark)
          values (?, ?, ?, ?, ?, ?)
          on conflict(game_id) do update set players    = excluded.players,
                                             updated_at = excluded.updated_at,
                                             whitelist  = excluded.whitelist,
                                             remark     = excluded.remark
        `)
        .run(
          archived.gameId,
          JSON.stringify(archived.players),
          archived.createdAt,
          archived.updatedAt,
          archived.whitelist ? 1 : 0,
          archived.remark,
        )

      conn.prepare('delete from files_content where game_id = ?').run(archived.gameId)
      conn
        .prepare('insert into files_content (game_id, turns, created_player, created_at, data) values (?, ?, ?, ?, ?)')
        .run(archived.gameId, archived.turns, archived.contentPlayer, archived.contentCreatedAt, archived.data)

      conn.prepare('delete from files_preview where game_id = ?').run(archived.gameId)
      if (archived.previewData != null) {
        conn
          .prepare('insert into files_preview (game_id, turns, created_player, created_at, data) values (?, ?, ?, ?, ?)')
          .run(
            archived.gameId,
            archived.previewTurns ?? archived.turns,
            archived.contentPlayer,
            archived.contentCreatedAt,
            archived.previewData,
          )
      }
      conn.prepare('delete from archived_games where game_id = ?').run(archived.gameId)
    }
  })()

  return archivedGames
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
 * 执行全部数据清理任务：
 * 1. 删除从未保存过存档的空对局；
 * 2. 每个对局只保留最新一条存档与预览；
 * 3. 存档数据总量超过 maxBytes 时，按最久未使用的顺序归档冷存档（先归档再删记录）；
 * 4. 清理超过保留期的 IP 记录。
 * archiveEnabled 为 false 时跳过容量归档（数据库可能持续增长，不建议关闭）。
 */
export function runCleanup(
  archiveEnabled: boolean,
  archiveDir: string,
  maxBytes: number,
): void {
  const emptyGames = cleanupEmptyGames()
  const previews = cleanupOldPreviews()
  const contents = cleanupOldContents()
  let archived: ArchiveResult = { games: 0, bytes: 0 }
  if (archiveEnabled) {
    archived = archiveColdGames(resolveRepoPath(archiveDir), maxBytes)
  } else {
    console.warn('冷存档归档已关闭，本次不做容量归档')
  }
  const ips = clearExpiredIPs()
  const conn = getDB()
  conn.exec('ANALYZE')
  conn.exec('VACUUM')
  console.info('数据清理任务完成', {
    emptyGames,
    archivedGames: archived.games,
    archivedBytes: archived.bytes,
    previews,
    contents,
    ips,
  })
}
