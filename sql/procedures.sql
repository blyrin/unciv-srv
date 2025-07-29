-- ========================================
-- 存储过程定义 / Stored Procedures Definition
-- ========================================
--
-- 在执行此文件之前，请确保已经运行了 structure.sql 创建表结构
-- Make sure to run structure.sql to create table structure before executing this file
--
-- ========================================
-- 用户认证相关存储过程 / User Authentication Stored Procedures
-- ========================================
-- 加载用户信息存储过程
-- Load user information stored procedure
create or replace function "sp_load_user"(
  in "p_player_id" uuid
)
  returns table (
    "player_id" uuid,
    "password"  varchar(255)
  )
  language plpgsql
as
$$
begin
  -- 查询用户信息 / Query user information
  return query select p."player_id", p."password" from "players" p where p."player_id" = "p_player_id";
end;
$$;

-- 保存用户认证信息存储过程
-- Save user authentication information stored procedure
create or replace function "sp_save_auth"(
  in "p_player_id" uuid,
  in "p_password" varchar(255),
  in "p_ip" varchar(255)
) returns void
  language plpgsql as
$$
begin
  -- 插入或更新用户认证信息 / Insert or update user authentication information
  insert into "players"(
    "player_id",
    "password",
    "create_ip",
    "update_ip"
  )
  values (
    "p_player_id",
    "p_password",
    "p_ip",
    "p_ip"
  )
  on conflict("player_id") do update set "password" = "p_password", "updated_at" = now(), "update_ip" = "p_ip";
end;
$$;

-- ========================================
-- 游戏文件相关存储过程 / Game Files Stored Procedures
-- ========================================
-- 加载游戏文件存储过程
-- Load game file stored procedure
create or replace function "sp_load_file_preview"(
  in "p_game_id" uuid
)
  returns table (
    "data" jsonb
  )
  language plpgsql
as
$$
begin
  -- 查询最新的游戏文件 / Query the latest game file
  return query select fc."data"
               from "files_preview" fc
               where fc."game_id" = "p_game_id"
               order by fc."created_at" desc,
                 fc."turns" desc
               limit 1;
end;
$$;

create or replace function "sp_load_file_content"(
  in "p_game_id" uuid
)
  returns table (
    "data" jsonb
  )
  language plpgsql
as
$$
begin
  -- 查询最新的游戏文件 / Query the latest game file
  return query select fc."data"
               from "files_content" fc
               where fc."game_id" = "p_game_id"
               order by fc."created_at" desc,
                 fc."turns" desc
               limit 1;
end;
$$;

-- 获取游戏玩家ID列表存储过程
-- Get game player IDs stored procedure
create or replace function "sp_get_player_ids_from_game"(
  in "p_game_id" uuid
)
  returns table (
    "player_id" uuid
  )
  language plpgsql
as
$$
begin
  -- 从游戏文件中提取玩家ID列表 / Extract player IDs from game files
  return query select distinct (player_elem.value #>> '{}')::uuid as "player_id"
               from "files" f,
                 jsonb_array_elements(f."players") as player_elem
               where f."game_id" = "p_game_id";
end;
$$;

-- 验证玩家权限的通用函数
-- Common function to validate player permissions
create or replace function "sp_validate_player_permission"(
  in "p_player_id" uuid,
  in "p_game_id" uuid,
  in "p_new_player_ids" jsonb
) returns void
  language plpgsql as
$$
declare
  "existing_player_ids"       uuid[];
  "player_exists_in_new_list" boolean;
  "save_exists"               boolean;
begin
  -- 检查玩家是否在新玩家列表中 / Check if player is in new player list
  select exists(
    select 1 from jsonb_array_elements_text("p_new_player_ids") as player_id where player_id::uuid = "p_player_id"
  )
  into "player_exists_in_new_list";

  -- 如果玩家不在新玩家列表中，直接拒绝 / If player is not in new player list, reject directly
  if not "player_exists_in_new_list" then
    raise exception '玩家 % 试图修改不是自己的存档 %', "p_player_id", "p_game_id";
  end if;

  -- 检查存档是否存在 / Check if save exists
  select exists(
    select 1
    from "files"
    where "game_id" = "p_game_id"
  )
  into "save_exists";

  -- 如果存档不存在，检查新玩家列表
  -- If save doesn't exist, check new player list
  if not "save_exists" then return; end if;

  -- 如果存档存在，还需要额外校验现有的玩家 / If save exists, need additional validation of existing players
  -- 获取现有玩家ID列表 / Get existing player IDs
  select array_agg(player_id) into "existing_player_ids" from "sp_get_player_ids_from_game"("p_game_id");

  -- 如果存在现有玩家且当前玩家不在现有玩家列表中，抛出异常
  -- If existing players exist and current player is not in existing player list, throw exception
  if "existing_player_ids" is not null and array_length("existing_player_ids", 1) > 0 and
     not ("p_player_id" = any ("existing_player_ids")) then
    raise exception '玩家 % 试图修改不是自己的存档 %', "p_player_id", "p_game_id";
  end if;
end;
$$;

-- 更新游戏基本信息的通用函数
-- Common function to update game basic information
create or replace function "sp_update_game_info"(
  in "p_game_id" uuid,
  in "p_new_player_ids" jsonb
) returns void
  language plpgsql as
$$
begin
  -- 更新或插入游戏基本信息 / Update or insert game basic information
  insert into "files"(
    "game_id",
    "players"
  )
  values (
    "p_game_id",
    "p_new_player_ids"
  )
  on conflict("game_id") do update set "updated_at" = now(), "players" = "p_new_player_ids";
end;
$$;

-- 保存游戏内容文件存储过程
-- Save game content file stored procedure
create or replace function "sp_save_file_content"(
  in "p_player_id" uuid,
  in "p_game_id" uuid,
  in "p_new_player_ids" jsonb,
  in "p_turns" integer,
  in "p_data" jsonb,
  in "p_ip" varchar(255)
) returns void
  language plpgsql as
$$
begin
  -- 验证玩家权限 / Validate player permission
  perform "sp_validate_player_permission"("p_player_id", "p_game_id", "p_new_player_ids");

  -- 更新游戏基本信息 / Update game basic information
  perform "sp_update_game_info"("p_game_id", "p_new_player_ids");

  -- 插入游戏内容 / Insert game content
  insert into "files_content"(
    "game_id",
    "turns",
    "data",
    "created_player",
    "created_ip"
  )
  values (
    "p_game_id",
    "p_turns",
    "p_data",
    "p_player_id",
    "p_ip"
  );
end;
$$;

-- 保存游戏预览文件存储过程
-- Save game preview file stored procedure
create or replace function "sp_save_file_preview"(
  in "p_player_id" uuid,
  in "p_game_id" uuid,
  in "p_new_player_ids" jsonb,
  in "p_turns" integer,
  in "p_data" jsonb,
  in "p_ip" varchar(255)
) returns void
  language plpgsql as
$$
begin
  -- 验证玩家权限 / Validate player permission
  perform "sp_validate_player_permission"("p_player_id", "p_game_id", "p_new_player_ids");

  -- 更新游戏基本信息 / Update game basic information
  perform "sp_update_game_info"("p_game_id", "p_new_player_ids");

  -- 插入游戏预览内容 / Insert game preview content
  insert into "files_preview"(
    "game_id",
    "turns",
    "data",
    "created_player",
    "created_ip"
  )
  values (
    "p_game_id",
    "p_turns",
    "p_data",
    "p_player_id",
    "p_ip"
  );
end;
$$;

-- ========================================
-- 管理员相关存储过程 / Admin Management Stored Procedures
-- ========================================
-- 获取所有玩家信息存储过程（管理员专用）
-- Get all players information stored procedure (admin only)
create or replace function "sp_get_all_players"()
  returns table (
    "player_id"  uuid,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    "whitelist"  bool,
    "remark"     varchar(255),
    "create_ip"  varchar(255),
    "update_ip"  varchar(255)
  )
  language plpgsql
as
$$
begin
  -- 查询所有玩家信息，按创建时间降序排列 / Query all players information, ordered by creation time descending
  return query select p."player_id",
                 p."created_at",
                 p."updated_at",
                 p."whitelist",
                 p."remark",
                 p."create_ip",
                 p."update_ip"
               from "players" p
               order by p."created_at" desc;
end;
$$;

-- 获取所有游戏信息存储过程（管理员专用）
-- Get all games information stored procedure (admin only)
create or replace function "sp_get_all_games"()
  returns table (
    "game_id"        uuid,
    "players"        jsonb,
    "created_at"     timestamptz,
    "updated_at"     timestamptz,
    "whitelist"      bool,
    "remark"         varchar(255),
    "turns"          int,
    "created_player" uuid
  )
  language plpgsql
as
$$
begin
  -- 查询所有游戏信息，包含最新回合数和创建者信息 / Query all games information with latest turns and creator info
  return query with "latest_file_content" as (
    select fc."game_id",
      fc."turns",
      fc."created_player",
        row_number() over (partition by fc."game_id" order by fc."created_at" desc, fc."turns" desc) as "rn"
    from "files_content" fc
  )
               select f."game_id",
                 f."players",
                 f."created_at",
                 f."updated_at",
                 f."whitelist",
                 f."remark",
                 lfc."turns",
                 lfc."created_player"
               from "files" f
               left join "latest_file_content" lfc on f."game_id" = lfc."game_id" and lfc."rn" = 1
               order by f."updated_at" desc;
end;
$$;

-- 获取用户相关游戏信息存储过程（普通用户专用）
-- Get user games information stored procedure (regular user only)
create or replace function "sp_get_user_games"(
  in "p_player_id" uuid
)
  returns table (
    "game_id"        uuid,
    "players"        jsonb,
    "created_at"     timestamptz,
    "updated_at"     timestamptz,
    "whitelist"      bool,
    "remark"         varchar(255),
    "turns"          int,
    "created_player" uuid
  )
  language plpgsql
as
$$
begin
  -- 查询用户相关的游戏信息 / Query user-related games information
  return query with "latest_file_content" as (
    select fc."game_id",
      fc."turns",
      fc."created_player",
        row_number() over (partition by fc."game_id" order by fc."created_at" desc, fc."turns" desc) as "rn"
    from "files_content" fc
  )
               select f."game_id",
                 f."players",
                 f."created_at",
                 f."updated_at",
                 f."whitelist",
                 f."remark",
                 lfc."turns",
                 lfc."created_player"
               from "files" f
               left join "latest_file_content" lfc on f."game_id" = lfc."game_id" and lfc."rn" = 1
               where f."players" ? "p_player_id"::text
               order by f."updated_at" desc;
end;
$$;

-- 更新玩家信息存储过程
-- Update player information stored procedure
create or replace function "sp_update_player"(
  in "p_player_id" uuid,
  in "p_whitelist" bool default null,
  in "p_remark" varchar(255) default null
) returns void
  language plpgsql as
$$
begin
  -- 使用 COALESCE 更新有值的字段 / Update fields with values using COALESCE
  update "players"
  set "whitelist" = coalesce("p_whitelist", "whitelist"),
    "remark"      = coalesce("p_remark", "remark"),
    "updated_at"  = now()
  where "player_id" = "p_player_id";

  -- 检查是否找到了要更新的玩家 / Check if player was found for update
  if not FOUND then raise exception '玩家 % 不存在', "p_player_id"; end if;
end;
$$;

-- 更新游戏信息存储过程
-- Update game information stored procedure
create or replace function "sp_update_game"(
  in "p_game_id" uuid,
  in "p_whitelist" bool default null,
  in "p_remark" varchar(255) default null
) returns void
  language plpgsql as
$$
begin
  -- 使用 COALESCE 更新有值的字段 / Update fields with values using COALESCE
  update "files"
  set "whitelist" = coalesce("p_whitelist", "whitelist"),
    "remark"      = coalesce("p_remark", "remark"),
    "updated_at"  = now()
  where "game_id" = "p_game_id";

  -- 检查是否找到了要更新的游戏 / Check if game was found for update
  if not FOUND then raise exception '游戏 % 不存在', "p_game_id"; end if;
end;
$$;

-- 检查游戏删除权限存储过程
-- Check game deletion permission stored procedure
create or replace function "sp_check_game_delete_permission"(
  in "p_game_id" uuid
)
  returns table (
    "created_player" uuid
  )
  language plpgsql
as
$$
begin
  -- 从游戏文件中提取最新的创建者用于权限检查
  -- Extract the latest creator from game files for permission check
  return query select (f."players" ->> 0)::uuid as "created_player"
               from "files" f
               where f."game_id" = "p_game_id"
               limit 1;
end;
$$;

-- 删除游戏存储过程
-- Delete game stored procedure
create or replace function "sp_delete_game"(
  in "p_game_id" uuid
) returns void
  language plpgsql as
$$
begin
  -- 删除游戏及其相关数据（通过外键约束自动删除相关内容） / Delete game and related data (related content deleted automatically via foreign key constraints)
  delete from "files" where "game_id" = "p_game_id";

  -- 检查是否找到了要删除的游戏 / Check if game was found for deletion
  if not FOUND then raise exception '游戏 % 不存在', "p_game_id"; end if;
end;
$$;

-- ========================================
-- 游戏下载相关存储过程 / Game Download Stored Procedures
-- ========================================
-- 获取游戏所有回合数据存储过程
-- Get all turns data for a game stored procedure
create or replace function "sp_get_all_turns_for_game"(
  in "p_game_id" uuid
)
  returns table (
    "turns"        int,
    "content_data" jsonb
  )
  language plpgsql
as
$$
begin
  -- 查询所有内容数据 / Query all content data
  return query select c.turns, c.data as content_data
               from "files_content" as c
               where c.game_id = "p_game_id"
               order by c.turns;
end;
$$;

-- ========================================
-- 清理相关存储过程 / Cleanup Stored Procedures
-- ========================================
-- 清理过期游戏和玩家数据存储过程
-- Cleanup expired games and player data stored procedure
create or replace function "sp_cleanup_data"()
  returns table (
    "deleted_game_count" integer
  )
  language plpgsql
as
$$
declare
  "game_count" integer := 0;
begin
  -- 删除过期的游戏文件 / Delete expired game files
  with "deleted_games_cte" as ( delete from "files" where "whitelist" = false and
                                                          ((now() - interval '3 months') > "updated_at" or
                                                           ((now() - interval '1 days') > "created_at" and
                                                            ("created_at" + interval '10 minutes') >
                                                            "updated_at")) returning "game_id"
  )
  select count(*)
  into "game_count"
  from "deleted_games_cte";
  -- 清理旧的预览记录，只保留每个游戏的最新记录
  -- Cleanup old preview records, keep only the latest record for each game
  with "records_to_delete" as (
    select "id", row_number() over (partition by "game_id" order by "created_at" desc, "turns" desc) as "rn"
    from "files_preview"
  )
  delete
  from "files_preview"
  where "id" in (
    select "id"
    from "records_to_delete"
    where "rn" > 1
  );
  -- 清理旧的内容记录，只保留每个游戏的最新记录
  -- Cleanup old content records, keep only the latest record for each game
  with "records_to_delete" as (
    select "id", row_number() over (partition by "game_id" order by "created_at" desc, "turns" desc) as "rn"
    from "files_content"
  )
  delete
  from "files_content"
  where "id" in (
    select "id"
    from "records_to_delete"
    where "rn" > 1
  );
  -- 返回删除的数量 / Return deleted counts
  return query select "game_count";
end;
$$;
