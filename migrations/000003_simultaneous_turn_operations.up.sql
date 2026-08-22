-- 同步回合操作旁路数据
create table if not exists simultaneous_turn_operations
(
  game_id    TEXT primary key,
  data       TEXT not null,
  updated_at INTEGER not null,
  foreign key (game_id) references files (game_id) on delete cascade
);
