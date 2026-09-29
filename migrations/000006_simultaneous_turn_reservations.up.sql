-- 同步回合占用表：某回合里哪些对象（地块/单位/城市）已被哪个玩家预定。
-- 预占的目的是在玩家执行动作之前就阻止并发修改同一个对象：
-- 各客户端只看到自己的动作，等结算才发现冲突时，后到者的操作只能被丢弃。
-- 占用按回合生效，回合推进后由取锁顺带清理。
create table if not exists simultaneous_turn_reservations
(
  game_id     TEXT    not null,
  turn        INTEGER not null check (turn >= 0),
  key         TEXT    not null,
  owner       TEXT    not null,
  acquired_at INTEGER not null,
  primary key (game_id, turn, key),
  foreign key (game_id) references files (game_id) on delete cascade
);
