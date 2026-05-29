-- 玩家表 - 存储玩家账户信息
create table if not exists players
(
  player_id  TEXT primary key,
  password   TEXT     not null check (length(password) > 0),
  created_at INTEGER not null default (cast(round(unixepoch('subsec') * 1000) as INTEGER)),
  updated_at INTEGER not null default (cast(round(unixepoch('subsec') * 1000) as INTEGER)),
  whitelist  INTEGER  not null default 0,
  remark     TEXT,
  create_ip  TEXT,
  update_ip  TEXT
);

create index if not exists idx_players_created_at on players (created_at desc);

-- 游戏文件主表 - 存储游戏基本信息
create table if not exists files
(
  game_id    TEXT primary key,
  players    TEXT     not null default '[]' check (json_valid(players)),
  created_at INTEGER not null default (cast(round(unixepoch('subsec') * 1000) as INTEGER)),
  updated_at INTEGER not null default (cast(round(unixepoch('subsec') * 1000) as INTEGER)),
  whitelist  INTEGER  not null default 0,
  remark     TEXT
);

create index if not exists idx_files_updated_at on files (updated_at desc);
-- 过期游戏清理按白名单和更新时间筛选
create index if not exists idx_files_whitelist_updated_at on files (whitelist, updated_at);

-- 游戏内容表 - 存储游戏存档数据
create table if not exists files_content
(
  id             INTEGER primary key autoincrement,
  game_id        TEXT     not null,
  turns          INTEGER  not null default 0 check (turns >= 0),
  created_player TEXT,
  created_ip     TEXT,
  created_at     INTEGER not null default (cast(round(unixepoch('subsec') * 1000) as INTEGER)),
  data           TEXT,
  foreign key (game_id) references files (game_id) on delete cascade,
  foreign key (created_player) references players (player_id) on delete set null
);

create index if not exists idx_files_content_game_created_at on files_content (game_id, created_at);
-- 最新存档、最新预览、回档清理按游戏、回合、时间和自增 ID 定位
create index if not exists idx_files_content_game_turn_created_id on files_content (game_id, turns desc, created_at desc, id desc);
-- 用户创建游戏统计按上传玩家过滤后再按游戏和时间匹配
create index if not exists idx_files_content_created_player_game_created_at on files_content (created_player, game_id, created_at);

-- 游戏预览表 - 存储游戏预览数据
create table if not exists files_preview
(
  id             INTEGER primary key autoincrement,
  game_id        TEXT     not null,
  turns          INTEGER  not null default 0 check (turns >= 0),
  created_player TEXT,
  created_ip     TEXT,
  created_at     INTEGER not null default (cast(round(unixepoch('subsec') * 1000) as INTEGER)),
  data           TEXT,
  foreign key (game_id) references files (game_id) on delete cascade,
  foreign key (created_player) references players (player_id) on delete set null
);

-- 最新存档、最新预览、回档清理按游戏、回合、时间和自增 ID 定位
create index if not exists idx_files_preview_game_turn_created_id on files_preview (game_id, turns desc, created_at desc, id desc);
-- 回档时按游戏、回合和上传玩家查找对应预览
create index if not exists idx_files_preview_game_turn_player_created_id on files_preview (game_id, turns, created_player, created_at, id);
