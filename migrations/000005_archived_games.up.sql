-- 冷存档墓碑：对局被归档到网盘后，删除 files 记录前在这里留一条记录，
-- 用于把「对局不存在」与「对局已冷归档」区分开，并登记玩家的恢复请求。
create table if not exists archived_games (
  game_id              text primary key,
  -- 归档文件名（不含目录），空字符串表示该对局没有保存过任何存档内容
  archive_file         text not null default '',
  archived_at          integer not null,
  -- 玩家请求恢复的时间，null 表示没人请求过
  restore_requested_at integer,
  -- 最近一次请求恢复的玩家
  requested_by         text not null default ''
);

create index if not exists idx_archived_games_restore_requested_at
  on archived_games (restore_requested_at);
