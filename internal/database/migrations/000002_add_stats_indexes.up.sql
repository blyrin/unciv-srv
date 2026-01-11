-- 用于 IsGameCreator 和 GetGamesCreatedByPlayer 查询优化
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_files_content_game_created_at ON files_content (game_id, created_at);

-- 用于时间范围查询（今日新存档、活跃统计）
CREATE INDEX IF NOT EXISTS idx_files_content_created_at ON files_content (created_at DESC);

-- 用于活跃玩家统计（按时间过滤后统计 DISTINCT created_player）
CREATE INDEX IF NOT EXISTS idx_files_content_created_player_created_at ON files_content (created_at, created_player) WHERE created_player IS NOT NULL;
