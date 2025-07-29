-- 玩家表 - 存储玩家账户信息
-- Players table - stores player account information
drop table if exists "players";

create table "players" (
  "player_id"  uuid primary key,                    -- 玩家唯一标识符 / Unique player identifier
  "password"   varchar(255) not null,               -- 玩家密码 / Player password
  "created_at" timestamptz  not null default now(), -- 账户创建时间 / Account creation timestamp
  "updated_at" timestamptz  not null default now(), -- 账户最后更新时间 / Account last update timestamp
  "whitelist"  bool         not null default false, -- 是否在白名单中 / Whether in whitelist
  "remark"     varchar(255),                        -- 备注信息 / Remark information
  "create_ip"  varchar(255),                        -- 创建账户时的IP地址 / IP address when account was created
  "update_ip"  varchar(255)                         -- 最后更新时的IP地址 / IP address of last update
);

-- 游戏文件主表 - 存储游戏基本信息
-- Main game files table - stores basic game information
drop table if exists "files";

create table "files" (
  "game_id"    uuid primary key,                         -- 游戏唯一标识符 / Unique game identifier
  "players"    jsonb       not null default '[]'::jsonb, -- 游戏玩家列表 / List of game players
  "created_at" timestamptz not null default now(),       -- 创建时间 / Creation timestamp
  "updated_at" timestamptz not null default now(),       -- 最后更新时间 / Last update timestamp
  "whitelist"  bool        not null default false,       -- 是否在白名单中 / Whether in whitelist
  "remark"     varchar(255)                              -- 备注信息 / Remark information
);

-- 游戏内容表 - 存储游戏存档数据
-- Game content table - stores game save data
drop table if exists "files_content";

create table "files_content" (
  "id"             bigserial primary key,              -- 自增主键 / Auto-increment primary key
  "game_id"        uuid        not null,               -- 关联的游戏ID / Associated game ID
  "turns"          int         not null default 0,     -- 游戏回合数 / Game turn number
  "created_player" uuid,                               -- 创建该记录的玩家ID / Player ID who created this record
  "created_ip"     varchar(255),                       -- 创建者IP地址 / Creator"s IP address
  "created_at"     timestamptz not null default now(), -- 创建时间 / Creation timestamp
  "data"           jsonb,                              -- 游戏存档数据 / Game save data
  constraint "fk_files_content_game_id" foreign key ("game_id") references "files" ("game_id") on delete cascade,
  constraint "fk_files_content_created_player" foreign key ("created_player") references "players" ("player_id") on delete set null
);

create index on "files_content" ("created_at");

create index on "files_content" ("game_id");

create index on "files_content" ("turns");

-- 游戏预览表 - 存储游戏预览数据
-- Game preview table - stores game preview data
drop table if exists "files_preview";

create table "files_preview" (
  "id"             bigserial primary key,              -- 自增主键 / Auto-increment primary key
  "game_id"        uuid        not null,               -- 关联的游戏ID / Associated game ID
  "turns"          int         not null default 0,     -- 游戏回合数 / Game turn number
  "created_player" uuid,                               -- 创建该记录的玩家ID / Player ID who created this record
  "created_ip"     varchar(255),                       -- 创建者IP地址 / Creator"s IP address
  "created_at"     timestamptz not null default now(), -- 创建时间 / Creation timestamp
  "data"           jsonb,                              -- 游戏预览数据 / Game preview data
  constraint "fk_files_preview_game_id" foreign key ("game_id") references "files" ("game_id") on delete cascade,
  constraint "fk_files_preview_created_player" foreign key ("created_player") references "players" ("player_id") on delete set null
);

create index on "files_preview" ("created_at");

create index on "files_preview" ("game_id");

create index on "files_preview" ("turns");

-- 添加表约束以确保数据完整性
-- Add table constraints to ensure data integrity
-- 确保files表的players字段是JSON数组格式
-- Ensure the players field in files table is in JSON array format
alter table "files"
  add constraint "chk_files_players_is_array" check (jsonb_typeof("players") = 'array');

-- 确保files_content表的turns字段为非负数
-- Ensure the turns field in files_content table is non-negative
alter table "files_content"
  add constraint "chk_files_content_turns_positive" check ("turns" >= 0);

-- 确保files_preview表的turns字段为非负数
-- Ensure the turns field in files_preview table is non-negative
alter table "files_preview"
  add constraint "chk_files_preview_turns_positive" check ("turns" >= 0);

-- 确保players表的password字段不为空
-- Ensure the password field in players table is not empty
alter table "players"
  add constraint "chk_players_password_not_empty" check (length("password") > 0);

-- 创建复合索引以优化查询性能
-- Create composite indexes to optimize query performance
-- 为files_content表创建复合索引，按游戏ID和回合数降序排列
-- Create composite index for files_content table, ordered by game_id and turns descending
create index if not exists "idx_files_content_game_turns" on "files_content" ("game_id", "turns" desc, "created_at" desc);

-- 为files_preview表创建复合索引，按游戏ID和回合数降序排列
-- Create composite index for files_preview table, ordered by game_id and turns descending
create index if not exists "idx_files_preview_game_turns" on "files_preview" ("game_id", "turns" desc, "created_at" desc);

-- 为players表创建单列索引以优化常用查询
-- Create single-column indexes for players table to optimize common queries
create index if not exists "idx_players_created_at" on "players" ("created_at");

create index if not exists "idx_players_updated_at" on "players" ("updated_at");

create index if not exists "idx_players_whitelist" on "players" ("whitelist");

-- 为files表创建单列索引以优化常用查询
-- Create single-column indexes for files table to optimize common queries
create index if not exists "idx_files_created_at" on "files" ("created_at");

create index if not exists "idx_files_updated_at" on "files" ("updated_at");

create index if not exists "idx_files_whitelist" on "files" ("whitelist");

-- 为 files 表的 players 字段创建 GIN 索引，优化基于玩家ID的游戏查询
-- Create a GIN index on the players field of the files table to accelerate game lookups by player ID
create index if not exists "idx_files_players_gin" on "files" using gin ("players");
