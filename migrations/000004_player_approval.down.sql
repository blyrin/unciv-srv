-- 回滚 000004_player_approval
drop index if exists idx_players_approved;
alter table players drop column approved;
