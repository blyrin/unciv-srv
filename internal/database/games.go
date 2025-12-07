package database

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
)

// GetGameByID 根据ID获取游戏
func GetGameByID(ctx context.Context, gameID string) (*Game, error) {
	var g Game
	var playersJSON []byte
	var remark *string

	err := DB.QueryRow(ctx, `
		SELECT game_id, players, created_at, updated_at, whitelist, remark
		FROM files
		WHERE game_id = $1
	`, gameID).Scan(
		&g.GameID, &playersJSON, &g.CreatedAt, &g.UpdatedAt, &g.Whitelist, &remark,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	// 解析玩家列表JSON
	if err := json.Unmarshal(playersJSON, &g.Players); err != nil {
		return nil, err
	}

	if remark != nil {
		g.Remark = *remark
	}
	return &g, nil
}

// CreateGame 创建新游戏
func CreateGame(ctx context.Context, gameID string, players []string) error {
	playersJSON, err := json.Marshal(players)
	if err != nil {
		return err
	}

	now := time.Now()
	_, err = DB.Exec(ctx, `
		INSERT INTO files (game_id, players, created_at, updated_at)
		VALUES ($1, $2, $3, $4)
	`, gameID, playersJSON, now, now)
	return err
}

// UpdateGamePlayers 更新游戏玩家列表
func UpdateGamePlayers(ctx context.Context, gameID string, players []string) error {
	playersJSON, err := json.Marshal(players)
	if err != nil {
		return err
	}

	_, err = DB.Exec(ctx, `
		UPDATE files
		SET players = $1, updated_at = $2
		WHERE game_id = $3
	`, playersJSON, time.Now(), gameID)
	return err
}

// UpdateGameTimestamp 更新游戏时间戳
func UpdateGameTimestamp(ctx context.Context, gameID string) error {
	_, err := DB.Exec(ctx, `
		UPDATE files SET updated_at = $1 WHERE game_id = $2
	`, time.Now(), gameID)
	return err
}

// GetAllGames 获取所有游戏列表（包含最新回合数）
func GetAllGames(ctx context.Context) ([]GameWithTurns, error) {
	rows, err := DB.Query(ctx, `
		SELECT
			f.game_id, f.players, f.created_at, f.updated_at, f.whitelist, f.remark,
			COALESCE(lfc.turns, 0) AS turns,
			COALESCE(lfc.created_player::TEXT, '') AS created_player
		FROM files f
		LEFT JOIN LATERAL (
			SELECT turns, created_player
			FROM files_content
			WHERE game_id = f.game_id
			ORDER BY turns DESC, created_at DESC
			LIMIT 1
		) lfc ON TRUE
		ORDER BY f.updated_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var games []GameWithTurns
	for rows.Next() {
		var g GameWithTurns
		var playersJSON []byte
		var remark *string
		var createdPlayer *string

		if err := rows.Scan(
			&g.GameID, &playersJSON, &g.CreatedAt, &g.UpdatedAt,
			&g.Whitelist, &remark, &g.Turns, &createdPlayer,
		); err != nil {
			return nil, err
		}

		if err := json.Unmarshal(playersJSON, &g.Players); err != nil {
			return nil, err
		}

		if remark != nil {
			g.Remark = *remark
		}
		if createdPlayer != nil {
			g.CreatedPlayer = *createdPlayer
		}

		games = append(games, g)
	}

	return games, rows.Err()
}

// GetGamesByPlayer 获取玩家参与的游戏
func GetGamesByPlayer(ctx context.Context, playerID string) ([]GameWithTurns, error) {
	rows, err := DB.Query(ctx, `
		SELECT
			f.game_id, f.players, f.created_at, f.updated_at, f.whitelist, f.remark,
			COALESCE(lfc.turns, 0) AS turns,
			COALESCE(lfc.created_player::TEXT, '') AS created_player
		FROM files f
		LEFT JOIN LATERAL (
			SELECT turns, created_player
			FROM files_content
			WHERE game_id = f.game_id
			ORDER BY turns DESC, created_at DESC
			LIMIT 1
		) lfc ON TRUE
		WHERE f.players @> $1::jsonb
		ORDER BY f.updated_at DESC
	`, `["`+playerID+`"]`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var games []GameWithTurns
	for rows.Next() {
		var g GameWithTurns
		var playersJSON []byte
		var remark *string
		var createdPlayer *string

		if err := rows.Scan(
			&g.GameID, &playersJSON, &g.CreatedAt, &g.UpdatedAt,
			&g.Whitelist, &remark, &g.Turns, &createdPlayer,
		); err != nil {
			return nil, err
		}

		if err := json.Unmarshal(playersJSON, &g.Players); err != nil {
			return nil, err
		}

		if remark != nil {
			g.Remark = *remark
		}
		if createdPlayer != nil {
			g.CreatedPlayer = *createdPlayer
		}

		games = append(games, g)
	}

	return games, rows.Err()
}

// DeleteGame 删除游戏
func DeleteGame(ctx context.Context, gameID string) error {
	_, err := DB.Exec(ctx, `DELETE FROM files WHERE game_id = $1`, gameID)
	return err
}

// UpdateGameInfo 更新游戏信息（白名单和备注）
func UpdateGameInfo(ctx context.Context, gameID string, whitelist bool, remark string) error {
	_, err := DB.Exec(ctx, `
		UPDATE files
		SET whitelist = $1, remark = $2, updated_at = $3
		WHERE game_id = $4
	`, whitelist, remark, time.Now(), gameID)
	return err
}

// GetGameCount 获取游戏总数
func GetGameCount(ctx context.Context) (int, error) {
	var count int
	err := DB.QueryRow(ctx, `SELECT COUNT(*) FROM files`).Scan(&count)
	return count, err
}

// GetWhitelistGameCount 获取白名单游戏数量
func GetWhitelistGameCount(ctx context.Context) (int, error) {
	var count int
	err := DB.QueryRow(ctx, `SELECT COUNT(*) FROM files WHERE whitelist = TRUE`).Scan(&count)
	return count, err
}

// ValidatePlayerPermission 验证玩家是否有权限操作游戏
func ValidatePlayerPermission(ctx context.Context, playerID, gameID string) (bool, error) {
	game, err := GetGameByID(ctx, gameID)
	if err != nil {
		return false, err
	}

	// 游戏不存在，允许创建
	if game == nil {
		return true, nil
	}

	// 检查玩家是否存在于游戏中
	return slices.Contains(game.Players, playerID), nil
}

// IsGameCreator 检查玩家是否是游戏的创建者（第一个上传存档的玩家）
func IsGameCreator(ctx context.Context, playerID, gameID string) (bool, error) {
	var createdPlayer *string
	err := DB.QueryRow(ctx, `
		SELECT created_player::TEXT
		FROM files_content
		WHERE game_id = $1
		ORDER BY created_at
		LIMIT 1
	`, gameID).Scan(&createdPlayer)

	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	if createdPlayer == nil {
		return false, nil
	}
	return *createdPlayer == playerID, nil
}

// GetGamesCreatedByPlayer 获取玩家创建的游戏数量
func GetGamesCreatedByPlayer(ctx context.Context, playerID string) (int, error) {
	var count int
	err := DB.QueryRow(ctx, `
		SELECT COUNT(DISTINCT fc.game_id)
		FROM files_content fc
		INNER JOIN (
			SELECT game_id, MIN(created_at) AS min_created_at
			FROM files_content
			GROUP BY game_id
		) first_uploads ON fc.game_id = first_uploads.game_id AND fc.created_at = first_uploads.min_created_at
		WHERE fc.created_player = $1
	`, playerID).Scan(&count)
	return count, err
}
