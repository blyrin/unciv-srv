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
CREATE
OR REPLACE FUNCTION "sp_load_user" (IN "p_player_id" uuid) RETURNS TABLE ("player_id" uuid, "password" varchar(255)) LANGUAGE plpgsql AS $$
BEGIN
    -- 查询用户信息 / Query user information
    RETURN QUERY
    SELECT
        p."player_id",
        p."password"
    FROM "players" p
    WHERE p."player_id" = "p_player_id";
END;
$$;

-- 保存用户认证信息存储过程
-- Save user authentication information stored procedure
CREATE
OR REPLACE FUNCTION "sp_save_auth" (
    IN "p_player_id" uuid,
    IN "p_password" varchar(255),
    IN "p_ip" varchar(255)
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    -- 插入或更新用户认证信息 / Insert or update user authentication information
    INSERT INTO "players"("player_id", "password", "create_ip", "update_ip")
    VALUES ("p_player_id", "p_password", "p_ip", "p_ip")
    ON CONFLICT("player_id") DO UPDATE
    SET
        "password" = "p_password",
        "updated_at" = now(),
        "update_ip" = "p_ip";
END;
$$;

-- ========================================
-- 游戏文件相关存储过程 / Game Files Stored Procedures
-- ========================================
-- 加载游戏文件存储过程
-- Load game file stored procedure
CREATE
OR REPLACE FUNCTION "sp_load_file_preview" (IN "p_game_id" uuid) RETURNS TABLE ("data" jsonb) LANGUAGE plpgsql AS $$
DECLARE
    "table_name" text;
BEGIN
    -- 查询最新的游戏文件 / Dynamically query the latest game file
    RETURN QUERY EXECUTE format('
        SELECT fc."data"
        FROM "files_preview" fc
        WHERE fc."game_id" = $1
        ORDER BY fc."created_at" DESC, fc."turns" DESC
        LIMIT 1', "table_name")
    USING "p_game_id";
END;
$$;

CREATE
OR REPLACE FUNCTION "sp_load_file_content" (IN "p_game_id" uuid) RETURNS TABLE ("data" jsonb) LANGUAGE plpgsql AS $$
DECLARE
    "table_name" text;
BEGIN
    -- 查询最新的游戏文件 / Dynamically query the latest game file
    RETURN QUERY EXECUTE format('
        SELECT fc."data"
        FROM "files_content" fc
        WHERE fc."game_id" = $1
        ORDER BY fc."created_at" DESC, fc."turns" DESC
        LIMIT 1', "table_name")
    USING "p_game_id";
END;
$$;

-- 获取游戏玩家ID列表存储过程
-- Get game player IDs stored procedure
CREATE
OR REPLACE FUNCTION "sp_get_player_ids_from_game" (IN "p_game_id" uuid) RETURNS TABLE ("player_id" uuid) LANGUAGE plpgsql AS $$
BEGIN
    -- 从游戏文件中提取玩家ID列表 / Extract player IDs from game files
    RETURN QUERY
    SELECT DISTINCT (player_elem.value #>> '{}')::uuid AS "player_id"
    FROM "files" f,
         jsonb_array_elements(f."players") AS player_elem
    WHERE f."game_id" = "p_game_id";
END;
$$;

-- 验证玩家权限的通用函数
-- Common function to validate player permissions
CREATE
OR REPLACE FUNCTION "sp_validate_player_permission" (
    IN "p_player_id" uuid,
    IN "p_game_id" uuid,
    IN "p_new_player_ids" jsonb
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    "existing_player_ids" uuid[];
    "player_exists_in_new_list" boolean;
    "save_exists" boolean;
BEGIN
    -- 检查玩家是否在新玩家列表中 / Check if player is in new player list
    SELECT EXISTS(
        SELECT 1
        FROM jsonb_array_elements_text("p_new_player_ids") AS player_id
        WHERE player_id::uuid = "p_player_id"
    ) INTO "player_exists_in_new_list";

    -- 如果玩家不在新玩家列表中，直接拒绝 / If player is not in new player list, reject directly
    IF NOT "player_exists_in_new_list" THEN
        RAISE EXCEPTION '玩家 % 试图修改不是自己的存档 %', "p_player_id", "p_game_id";
    END IF;

    -- 检查存档是否存在 / Check if save exists
    SELECT EXISTS(
        SELECT 1 FROM "files" WHERE "game_id" = "p_game_id"
    ) INTO "save_exists";

    -- 如果存档不存在，检查新玩家列表
    -- If save doesn't exist, check new player list
    IF NOT "save_exists" THEN
        RETURN;
    END IF;

    -- 如果存档存在，还需要额外校验现有的玩家 / If save exists, need additional validation of existing players
    -- 获取现有玩家ID列表 / Get existing player IDs
    SELECT array_agg(player_id) INTO "existing_player_ids"
    FROM "sp_get_player_ids_from_game"("p_game_id");

    -- 如果存在现有玩家且当前玩家不在现有玩家列表中，抛出异常
    -- If existing players exist and current player is not in existing player list, throw exception
    IF "existing_player_ids" IS NOT NULL
       AND array_length("existing_player_ids", 1) > 0
       AND NOT ("p_player_id" = ANY("existing_player_ids")) THEN
        RAISE EXCEPTION '玩家 % 试图修改不是自己的存档 %', "p_player_id", "p_game_id";
    END IF;
END;
$$;

-- 更新游戏基本信息的通用函数
-- Common function to update game basic information
CREATE
OR REPLACE FUNCTION "sp_update_game_info" (IN "p_game_id" uuid, IN "p_new_player_ids" jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    -- 更新或插入游戏基本信息 / Update or insert game basic information
    INSERT INTO "files"("game_id", "players")
    VALUES ("p_game_id", "p_new_player_ids")
    ON CONFLICT("game_id") DO UPDATE
    SET
        "updated_at" = now(),
        "players" = "p_new_player_ids";
END;
$$;

-- 保存游戏内容文件存储过程
-- Save game content file stored procedure
CREATE
OR REPLACE FUNCTION "sp_save_file_content" (
    IN "p_player_id" uuid,
    IN "p_game_id" uuid,
    IN "p_new_player_ids" jsonb,
    IN "p_turns" integer,
    IN "p_data" jsonb,
    IN "p_ip" varchar(255)
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    -- 验证玩家权限 / Validate player permission
    PERFORM "sp_validate_player_permission"("p_player_id", "p_game_id", "p_new_player_ids");

    -- 更新游戏基本信息 / Update game basic information
    PERFORM "sp_update_game_info"("p_game_id", "p_new_player_ids");

    -- 插入游戏内容 / Insert game content
    INSERT INTO "files_content"("game_id", "turns", "data", "created_player", "created_ip")
    VALUES ("p_game_id", "p_turns", "p_data", "p_player_id", "p_ip");
END;
$$;

-- 保存游戏预览文件存储过程
-- Save game preview file stored procedure
CREATE
OR REPLACE FUNCTION "sp_save_file_preview" (
    IN "p_player_id" uuid,
    IN "p_game_id" uuid,
    IN "p_new_player_ids" jsonb,
    IN "p_turns" integer,
    IN "p_data" jsonb,
    IN "p_ip" varchar(255)
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    -- 验证玩家权限 / Validate player permission
    PERFORM "sp_validate_player_permission"("p_player_id", "p_game_id", "p_new_player_ids");

    -- 更新游戏基本信息 / Update game basic information
    PERFORM "sp_update_game_info"("p_game_id", "p_new_player_ids");

    -- 插入游戏预览内容 / Insert game preview content
    INSERT INTO "files_preview"("game_id", "turns", "data", "created_player", "created_ip")
    VALUES ("p_game_id", "p_turns", "p_data", "p_player_id", "p_ip");
END;
$$;

-- ========================================
-- 管理员相关存储过程 / Admin Management Stored Procedures
-- ========================================
-- 获取所有玩家信息存储过程（管理员专用）
-- Get all players information stored procedure (admin only)
CREATE
OR REPLACE FUNCTION "sp_get_all_players" () RETURNS TABLE (
    "player_id" uuid,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    "whitelist" bool,
    "remark" varchar(255),
    "create_ip" varchar(255),
    "update_ip" varchar(255)
) LANGUAGE plpgsql AS $$
BEGIN
    -- 查询所有玩家信息，按创建时间降序排列 / Query all players information, ordered by creation time descending
    RETURN QUERY
    SELECT
        p."player_id",
        p."created_at",
        p."updated_at",
        p."whitelist",
        p."remark",
        p."create_ip",
        p."update_ip"
    FROM "players" p
    ORDER BY p."created_at" DESC;
END;
$$;

-- 获取所有游戏信息存储过程（管理员专用）
-- Get all games information stored procedure (admin only)
CREATE
OR REPLACE FUNCTION "sp_get_all_games" () RETURNS TABLE (
    "game_id" uuid,
    "players" jsonb,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    "whitelist" bool,
    "remark" varchar(255),
    "turns" int,
    "created_player" uuid
) LANGUAGE plpgsql AS $$
BEGIN
    -- 查询所有游戏信息，包含最新回合数和创建者信息 / Query all games information with latest turns and creator info
    RETURN QUERY
    SELECT
        f."game_id",
        f."players",
        f."created_at",
        f."updated_at",
        f."whitelist",
        f."remark",
        fc."turns",
        fc."created_player"
    FROM "files" f
    LEFT JOIN LATERAL (
        SELECT fc_inner."turns", fc_inner."created_player"
        FROM "files_content" fc_inner
        WHERE fc_inner."game_id" = f."game_id"
        ORDER BY fc_inner."created_at" DESC, fc_inner."turns" DESC
        LIMIT 1
    ) fc ON true
    ORDER BY f."updated_at" DESC;
END;
$$;

-- 获取用户相关游戏信息存储过程（普通用户专用）
-- Get user games information stored procedure (regular user only)
CREATE
OR REPLACE FUNCTION "sp_get_user_games" (IN "p_player_id" uuid) RETURNS TABLE (
    "game_id" uuid,
    "players" jsonb,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    "whitelist" bool,
    "remark" varchar(255),
    "turns" int,
    "created_player" uuid
) LANGUAGE plpgsql AS $$
BEGIN
    -- 查询用户相关的游戏信息 / Query user-related games information
    RETURN QUERY
    SELECT
        f."game_id",
        f."players",
        f."created_at",
        f."updated_at",
        f."whitelist",
        f."remark",
        fc."turns",
        fc."created_player"
    FROM "files" f
    LEFT JOIN LATERAL (
        SELECT fc_inner."turns", fc_inner."created_player"
        FROM "files_content" fc_inner
        WHERE fc_inner."game_id" = f."game_id"
        ORDER BY fc_inner."created_at" DESC, fc_inner."turns" DESC
        LIMIT 1
    ) fc ON true
    WHERE f."players" ? "p_player_id"::text
    ORDER BY f."updated_at" DESC;
END;
$$;

-- 更新玩家信息存储过程
-- Update player information stored procedure
CREATE
OR REPLACE FUNCTION "sp_update_player" (
    IN "p_player_id" uuid,
    IN "p_whitelist" bool DEFAULT NULL,
    IN "p_remark" varchar(255) DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    -- 动态构建更新语句，只更新有值的字段 / Dynamically build update statement, only update fields with values
    UPDATE "players"
    SET
        "whitelist" = CASE WHEN "p_whitelist" IS NOT NULL THEN "p_whitelist" ELSE "whitelist" END,
        "remark" = CASE WHEN "p_remark" IS NOT NULL THEN "p_remark" ELSE "remark" END,
        "updated_at" = now()
    WHERE "player_id" = "p_player_id";

    -- 检查是否找到了要更新的玩家 / Check if player was found for update
    IF NOT FOUND THEN
        RAISE EXCEPTION '玩家 % 不存在', "p_player_id";
    END IF;
END;
$$;

-- 更新游戏信息存储过程
-- Update game information stored procedure
CREATE
OR REPLACE FUNCTION "sp_update_game" (
    IN "p_game_id" uuid,
    IN "p_whitelist" bool DEFAULT NULL,
    IN "p_remark" varchar(255) DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    -- 动态构建更新语句，只更新有值的字段 / Dynamically build update statement, only update fields with values
    UPDATE "files"
    SET
        "whitelist" = CASE WHEN "p_whitelist" IS NOT NULL THEN "p_whitelist" ELSE "whitelist" END,
        "remark" = CASE WHEN "p_remark" IS NOT NULL THEN "p_remark" ELSE "remark" END,
        "updated_at" = now()
    WHERE "game_id" = "p_game_id";

    -- 检查是否找到了要更新的游戏 / Check if game was found for update
    IF NOT FOUND THEN
        RAISE EXCEPTION '游戏 % 不存在', "p_game_id";
    END IF;
END;
$$;

-- 检查游戏删除权限存储过程
-- Check game deletion permission stored procedure
CREATE
OR REPLACE FUNCTION "sp_check_game_delete_permission" (IN "p_game_id" uuid) RETURNS TABLE ("created_player" uuid) LANGUAGE plpgsql AS $$
BEGIN
    -- 查询游戏的最新创建者用于权限检查 / Query game's latest creator for permission check
    RETURN QUERY
    SELECT fc."created_player"
    FROM "files_content" fc
    WHERE fc."game_id" = "p_game_id"
    ORDER BY fc."created_at" DESC
    LIMIT 1;
END;
$$;

-- 删除游戏存储过程
-- Delete game stored procedure
CREATE
OR REPLACE FUNCTION "sp_delete_game" (IN "p_game_id" uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    -- 删除游戏及其相关数据（通过外键约束自动删除相关内容） / Delete game and related data (related content deleted automatically via foreign key constraints)
    DELETE FROM "files" WHERE "game_id" = "p_game_id";

    -- 检查是否找到了要删除的游戏 / Check if game was found for deletion
    IF NOT FOUND THEN
        RAISE EXCEPTION '游戏 % 不存在', "p_game_id";
    END IF;
END;
$$;

-- ========================================
-- 清理相关存储过程 / Cleanup Stored Procedures
-- ========================================
-- 清理过期游戏和玩家数据存储过程
-- Cleanup expired games and player data stored procedure
CREATE
OR REPLACE FUNCTION "sp_cleanup_data" () RETURNS TABLE ("deleted_game_count" integer) LANGUAGE plpgsql AS $$
DECLARE
    "deleted_games" uuid[];
    "game_count" integer := 0;
BEGIN
    -- 删除过期的游戏文件 / Delete expired game files
    WITH deleted_games_cte AS (
        DELETE FROM "files"
        WHERE "whitelist" = false
          AND ((now() - interval '3 months') > "updated_at"
            OR ((now() - interval '1 days') > "created_at"
                AND ("created_at" + interval '10 minutes') > "updated_at"))
        RETURNING "game_id"
    )
    SELECT array_agg("game_id"), count(*) INTO "deleted_games", "game_count"
    FROM deleted_games_cte;

    -- 清理旧的预览记录，只保留每个游戏的最新记录
    -- Cleanup old preview records, keep only the latest record for each game
    WITH latest_preview_records AS (
        SELECT "id"
        FROM "files_preview"
        WHERE ("game_id", "created_at") IN (
            SELECT "game_id", max("created_at")
            FROM "files_preview"
            GROUP BY "game_id"
        )
    )
    DELETE FROM "files_preview"
    WHERE "id" NOT IN (SELECT "id" FROM latest_preview_records);

    -- 清理旧的内容记录，只保留每个游戏的最新记录
    -- Cleanup old content records, keep only the latest record for each game
    WITH latest_content_records AS (
        SELECT "id"
        FROM "files_content"
        WHERE ("game_id", "created_at") IN (
            SELECT "game_id", max("created_at")
            FROM "files_content"
            GROUP BY "game_id"
        )
    )
    DELETE FROM "files_content"
    WHERE "id" NOT IN (SELECT "id" FROM latest_content_records);

    -- 返回删除的数量 / Return deleted counts
    RETURN QUERY SELECT "game_count";
END;
$$;