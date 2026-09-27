-- 账号审核状态：REGISTER_MODE=approval 时新注册的账号为待审核（0），管理员审核通过后置 1
-- 历史账号默认视为已通过审核
alter table players add column approved INTEGER not null default 1;

create index if not exists idx_players_approved on players (approved);
