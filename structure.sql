-- 玩家表 - 存储玩家账户信息
-- Players table - stores player account information
DROP TABLE IF EXISTS "players";

CREATE TABLE
  "players" (
    "player_id" uuid PRIMARY KEY, -- 玩家唯一标识符 / Unique player identifier
    "password" varchar(255) NOT NULL, -- 玩家密码 / Player password
    "created_at" timestamptz NOT NULL DEFAULT now(), -- 账户创建时间 / Account creation timestamp
    "updated_at" timestamptz NOT NULL DEFAULT now(), -- 账户最后更新时间 / Account last update timestamp
    "whitelist" bool NOT NULL DEFAULT false, -- 是否在白名单中 / Whether in whitelist
    "remark" varchar(255), -- 备注信息 / Remark information
    "create_ip" varchar(255), -- 创建账户时的IP地址 / IP address when account was created
    "update_ip" varchar(255) -- 最后更新时的IP地址 / IP address of last update
  );

-- 游戏文件主表 - 存储游戏基本信息
-- Main game files table - stores basic game information
DROP TABLE IF EXISTS "files";

CREATE UNLOGGED TABLE
  "files" (
    "game_id" uuid PRIMARY KEY, -- 游戏唯一标识符 / Unique game identifier
    "players" jsonb NOT NULL DEFAULT '[]'::jsonb, -- 游戏玩家列表 / List of game players
    "created_at" timestamptz NOT NULL DEFAULT now(), -- 创建时间 / Creation timestamp
    "updated_at" timestamptz NOT NULL DEFAULT now(), -- 最后更新时间 / Last update timestamp
    "whitelist" bool NOT NULL DEFAULT false, -- 是否在白名单中 / Whether in whitelist
    "remark" varchar(255) -- 备注信息 / Remark information
  );

-- 游戏内容表 - 存储游戏存档数据
-- Game content table - stores game save data
DROP TABLE IF EXISTS "files_content";

CREATE UNLOGGED TABLE
  "files_content" (
    "id" bigserial PRIMARY KEY, -- 自增主键 / Auto-increment primary key
    "game_id" uuid NOT NULL, -- 关联的游戏ID / Associated game ID
    "turns" int NOT NULL DEFAULT 0, -- 游戏回合数 / Game turn number
    "created_player" uuid, -- 创建该记录的玩家ID / Player ID who created this record
    "created_ip" varchar(255), -- 创建者IP地址 / Creator"s IP address
    "created_at" timestamptz NOT NULL DEFAULT now(), -- 创建时间 / Creation timestamp
    "data" jsonb, -- 游戏存档数据 / Game save data
    CONSTRAINT "fk_files_content_game_id" FOREIGN KEY ("game_id") REFERENCES "files" ("game_id") ON DELETE CASCADE,
    CONSTRAINT "fk_files_content_created_player" FOREIGN KEY ("created_player") REFERENCES "players" ("player_id") ON DELETE SET NULL
  );

CREATE INDEX ON "files_content" ("created_at");

CREATE INDEX ON "files_content" ("game_id");

CREATE INDEX ON "files_content" ("turns");

-- 游戏预览表 - 存储游戏预览数据
-- Game preview table - stores game preview data
DROP TABLE IF EXISTS "files_preview";

CREATE UNLOGGED TABLE
  "files_preview" (
    "id" bigserial PRIMARY KEY, -- 自增主键 / Auto-increment primary key
    "game_id" uuid NOT NULL, -- 关联的游戏ID / Associated game ID
    "turns" int NOT NULL DEFAULT 0, -- 游戏回合数 / Game turn number
    "created_player" uuid, -- 创建该记录的玩家ID / Player ID who created this record
    "created_ip" varchar(255), -- 创建者IP地址 / Creator"s IP address
    "created_at" timestamptz NOT NULL DEFAULT now(), -- 创建时间 / Creation timestamp
    "data" jsonb, -- 游戏预览数据 / Game preview data
    CONSTRAINT "fk_files_preview_game_id" FOREIGN KEY ("game_id") REFERENCES "files" ("game_id") ON DELETE CASCADE,
    CONSTRAINT "fk_files_preview_created_player" FOREIGN KEY ("created_player") REFERENCES "players" ("player_id") ON DELETE SET NULL
  );

CREATE INDEX ON "files_preview" ("created_at");

CREATE INDEX ON "files_preview" ("game_id");

CREATE INDEX ON "files_preview" ("turns");

-- 添加表约束以确保数据完整性
-- Add table constraints to ensure data integrity
-- 确保files表的players字段是JSON数组格式
-- Ensure the players field in files table is in JSON array format
ALTER TABLE "files"
ADD CONSTRAINT "chk_files_players_is_array" CHECK (jsonb_typeof("players") = 'array');

-- 确保files_content表的turns字段为非负数
-- Ensure the turns field in files_content table is non-negative
ALTER TABLE "files_content"
ADD CONSTRAINT "chk_files_content_turns_positive" CHECK ("turns" >= 0);

-- 确保files_preview表的turns字段为非负数
-- Ensure the turns field in files_preview table is non-negative
ALTER TABLE "files_preview"
ADD CONSTRAINT "chk_files_preview_turns_positive" CHECK ("turns" >= 0);

-- 确保players表的password字段不为空
-- Ensure the password field in players table is not empty
ALTER TABLE "players"
ADD CONSTRAINT "chk_players_password_not_empty" CHECK (length("password") > 0);

-- 创建复合索引以优化查询性能
-- Create composite indexes to optimize query performance
-- 为files_content表创建复合索引，按游戏ID和回合数降序排列
-- Create composite index for files_content table, ordered by game_id and turns descending
CREATE INDEX IF NOT EXISTS "idx_files_content_game_turns" ON "files_content" ("game_id", "turns" DESC, "created_at" DESC);

-- 为files_preview表创建复合索引，按游戏ID和回合数降序排列
-- Create composite index for files_preview table, ordered by game_id and turns descending
CREATE INDEX IF NOT EXISTS "idx_files_preview_game_turns" ON "files_preview" ("game_id", "turns" DESC, "created_at" DESC);

-- 为players表创建单列索引以优化常用查询
-- Create single-column indexes for players table to optimize common queries
CREATE INDEX IF NOT EXISTS "idx_players_created_at" ON "players" ("created_at");

CREATE INDEX IF NOT EXISTS "idx_players_updated_at" ON "players" ("updated_at");

CREATE INDEX IF NOT EXISTS "idx_players_whitelist" ON "players" ("whitelist");

-- 为files表创建单列索引以优化常用查询
-- Create single-column indexes for files table to optimize common queries
CREATE INDEX IF NOT EXISTS "idx_files_created_at" ON "files" ("created_at");

CREATE INDEX IF NOT EXISTS "idx_files_updated_at" ON "files" ("updated_at");

CREATE INDEX IF NOT EXISTS "idx_files_whitelist" ON "files" ("whitelist");