-- 账号审核状态：REGISTER_MODE=approval 时新注册的账号为待审核（0），管理员审核通过后置 1
-- 历史账号一律按未审核处理（0），需要管理员在后台逐个通过后才能使用联机功能；
-- 默认值取 0 而不是 1，避免遗漏审核字段的写入被当成已通过
alter table players add column approved INTEGER not null default 0;

create index if not exists idx_players_approved on players (approved);
