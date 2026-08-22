-- 同步回合结算租约锁
create table if not exists simultaneous_turn_locks
(
  game_id    TEXT primary key,
  turn       INTEGER not null check (turn >= 0),
  owner      TEXT not null,
  acquired_at INTEGER not null,
  foreign key (game_id) references files (game_id) on delete cascade
);
