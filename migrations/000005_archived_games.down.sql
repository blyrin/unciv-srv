-- 回滚 000005_archived_games
drop index if exists idx_archived_games_restore_requested_at;
drop table if exists archived_games;
