-- 玩家表 - 存储玩家账户信息
CREATE TABLE IF NOT EXISTS players (
  player_id  TEXT PRIMARY KEY,
  password   TEXT NOT NULL CHECK (LENGTH(password) > 0),
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
  whitelist  INTEGER  NOT NULL DEFAULT 0,
  remark     TEXT,
  create_ip  TEXT,
  update_ip  TEXT
);

CREATE INDEX IF NOT EXISTS idx_players_created_at ON players (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_players_updated_at ON players (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_players_whitelist ON players (whitelist);

-- 游戏文件主表 - 存储游戏基本信息
CREATE TABLE IF NOT EXISTS files (
  game_id    TEXT PRIMARY KEY,
  players TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(players)),
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
  whitelist  INTEGER  NOT NULL DEFAULT 0,
  remark     TEXT
);

CREATE INDEX IF NOT EXISTS idx_files_created_at ON files (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_whitelist ON files (whitelist);

-- 游戏内容表 - 存储游戏存档数据
CREATE TABLE IF NOT EXISTS files_content (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id        TEXT NOT NULL,
  turns          INTEGER NOT NULL DEFAULT 0 CHECK (turns >= 0),
  created_player TEXT,
  created_ip     TEXT,
  created_at     DATETIME NOT NULL DEFAULT (datetime('now')),
  data           TEXT,
  FOREIGN KEY (game_id) REFERENCES files (game_id) ON DELETE CASCADE,
  FOREIGN KEY (created_player) REFERENCES players (player_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_files_content_game_turns ON files_content (game_id, turns DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_content_game_created_at ON files_content (game_id, created_at);
CREATE INDEX IF NOT EXISTS idx_files_content_created_at ON files_content (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_content_created_player_created_at ON files_content (created_at, created_player);

-- 游戏预览表 - 存储游戏预览数据
CREATE TABLE IF NOT EXISTS files_preview (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id        TEXT NOT NULL,
  turns          INTEGER NOT NULL DEFAULT 0 CHECK (turns >= 0),
  created_player TEXT,
  created_ip     TEXT,
  created_at     DATETIME NOT NULL DEFAULT (datetime('now')),
  data           TEXT,
  FOREIGN KEY (game_id) REFERENCES files (game_id) ON DELETE CASCADE,
  FOREIGN KEY (created_player) REFERENCES players (player_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_files_preview_game_id ON files_preview (game_id);
CREATE INDEX IF NOT EXISTS idx_files_preview_turns ON files_preview (turns DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_preview_game_turns ON files_preview (game_id, turns DESC, created_at DESC);
