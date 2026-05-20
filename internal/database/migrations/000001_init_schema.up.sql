-- 玩家表 - 存储玩家账户信息
create table if not exists players
(
  player_id  TEXT primary key,
  password   TEXT     not null check (length(password) > 0),
  created_at DATETIME not null default (datetime('now')),
  updated_at DATETIME not null default (datetime('now')),
  whitelist  INTEGER  not null default 0,
  remark     TEXT,
  create_ip  TEXT,
  update_ip  TEXT
);

create index if not exists idx_players_created_at on players (created_at desc);
create index if not exists idx_players_updated_at on players (updated_at desc);
create index if not exists idx_players_whitelist on players (whitelist);

-- 游戏文件主表 - 存储游戏基本信息
create table if not exists files
(
  game_id    TEXT primary key,
  players    TEXT     not null default '[]' check (json_valid(players)),
  created_at DATETIME not null default (datetime('now')),
  updated_at DATETIME not null default (datetime('now')),
  whitelist  INTEGER  not null default 0,
  remark     TEXT
);

create index if not exists idx_files_created_at on files (created_at desc);
create index if not exists idx_files_updated_at on files (updated_at desc);
create index if not exists idx_files_whitelist on files (whitelist);

-- 游戏内容表 - 存储游戏存档数据
create table if not exists files_content
(
  id             INTEGER primary key autoincrement,
  game_id        TEXT     not null,
  turns          INTEGER  not null default 0 check (turns >= 0),
  created_player TEXT,
  created_ip     TEXT,
  created_at     DATETIME not null default (datetime('now')),
  data           TEXT,
  foreign key (game_id) references files (game_id) on delete cascade,
  foreign key (created_player) references players (player_id) on delete set null
);

create index if not exists idx_files_content_game_turns on files_content (game_id, turns desc, created_at desc);
create index if not exists idx_files_content_game_created_at on files_content (game_id, created_at);
create index if not exists idx_files_content_created_at on files_content (created_at desc);
create index if not exists idx_files_content_created_player_created_at on files_content (created_at, created_player);

-- 游戏预览表 - 存储游戏预览数据
create table if not exists files_preview
(
  id             INTEGER primary key autoincrement,
  game_id        TEXT     not null,
  turns          INTEGER  not null default 0 check (turns >= 0),
  created_player TEXT,
  created_ip     TEXT,
  created_at     DATETIME not null default (datetime('now')),
  data           TEXT,
  foreign key (game_id) references files (game_id) on delete cascade,
  foreign key (created_player) references players (player_id) on delete set null
);

create index if not exists idx_files_preview_game_id on files_preview (game_id);
create index if not exists idx_files_preview_turns on files_preview (turns desc, created_at desc);
create index if not exists idx_files_preview_game_turns on files_preview (game_id, turns desc, created_at desc);
