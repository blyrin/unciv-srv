-- 回滚 000001_init_schema：按依赖关系先删子表再删父表
drop index if exists idx_files_preview_game_turn_player_created_id;
drop index if exists idx_files_preview_game_turn_created_id;
drop table if exists files_preview;

drop index if exists idx_files_content_created_player_game_created_at;
drop index if exists idx_files_content_game_turn_created_id;
drop index if exists idx_files_content_game_created_at;
drop table if exists files_content;

drop index if exists idx_files_whitelist_updated_at;
drop index if exists idx_files_updated_at;
drop table if exists files;

drop index if exists idx_players_created_at;
drop table if exists players;
