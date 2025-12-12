-- 玩家表 - 存储玩家账户信息
CREATE TABLE IF NOT EXISTS players (
  player_id  UUID PRIMARY KEY,
  password   VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  whitelist  BOOL         NOT NULL DEFAULT FALSE,
  remark     VARCHAR(255),
  create_ip  VARCHAR(255),
  update_ip  VARCHAR(255),
  CONSTRAINT chk_players_password_not_empty CHECK (LENGTH(password) > 0)
);

CREATE INDEX IF NOT EXISTS idx_players_created_at ON players (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_players_updated_at ON players (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_players_whitelist ON players (whitelist);

-- 游戏文件主表 - 存储游戏基本信息
CREATE TABLE IF NOT EXISTS files (
  game_id    UUID PRIMARY KEY,
  players    JSONB       NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  whitelist  BOOL        NOT NULL DEFAULT FALSE,
  remark     VARCHAR(255),
  CONSTRAINT chk_files_players_is_array CHECK (JSONB_TYPEOF(players) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_files_created_at ON files (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_whitelist ON files (whitelist);
CREATE INDEX IF NOT EXISTS idx_files_players_gin ON files USING GIN (players);

-- 游戏内容表 - 存储游戏存档数据
CREATE TABLE IF NOT EXISTS files_content (
  id             BIGSERIAL PRIMARY KEY,
  game_id        UUID        NOT NULL,
  turns          INT         NOT NULL DEFAULT 0,
  created_player UUID,
  created_ip     VARCHAR(255),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data           JSONB,
  CONSTRAINT fk_files_content_game_id FOREIGN KEY (game_id) REFERENCES files (game_id) ON DELETE CASCADE,
  CONSTRAINT fk_files_content_created_player FOREIGN KEY (created_player) REFERENCES players (player_id) ON DELETE SET NULL,
  CONSTRAINT chk_files_content_turns_positive CHECK (turns >= 0)
);

CREATE INDEX IF NOT EXISTS idx_files_content_game_id ON files_content (game_id);
CREATE INDEX IF NOT EXISTS idx_files_content_turns ON files_content (turns DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_content_game_turns ON files_content (game_id, turns DESC, created_at DESC);

-- 游戏预览表 - 存储游戏预览数据
CREATE TABLE IF NOT EXISTS files_preview (
  id             BIGSERIAL PRIMARY KEY,
  game_id        UUID        NOT NULL,
  turns          INT         NOT NULL DEFAULT 0,
  created_player UUID,
  created_ip     VARCHAR(255),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data           JSONB,
  CONSTRAINT fk_files_preview_game_id FOREIGN KEY (game_id) REFERENCES files (game_id) ON DELETE CASCADE,
  CONSTRAINT fk_files_preview_created_player FOREIGN KEY (created_player) REFERENCES players (player_id) ON DELETE SET NULL,
  CONSTRAINT chk_files_preview_turns_positive CHECK (turns >= 0)
);

CREATE INDEX IF NOT EXISTS idx_files_preview_game_id ON files_preview (game_id);
CREATE INDEX IF NOT EXISTS idx_files_preview_turns ON files_preview (turns DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_preview_game_turns ON files_preview (game_id, turns DESC, created_at DESC);
