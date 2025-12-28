package database

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// GetLatestFileContent 获取游戏的最新存档内容
func GetLatestFileContent(ctx context.Context, gameID string) (*FileContent, error) {
	var fc FileContent
	var createdPlayer *string
	var createdIP *string
	var data []byte

	err := DB.QueryRow(ctx, `
		SELECT id, game_id, turns, created_player, created_ip, created_at, data
		FROM files_content
		WHERE game_id = $1
		ORDER BY turns DESC, created_at DESC
		LIMIT 1
	`, gameID).Scan(
		&fc.ID, &fc.GameID, &fc.Turns, &createdPlayer, &createdIP, &fc.CreatedAt, &data,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if createdPlayer != nil {
		fc.CreatedPlayer = *createdPlayer
	}
	if createdIP != nil {
		fc.CreatedIP = *createdIP
	}
	fc.Data = data

	return &fc, nil
}

// SaveFileContent 保存游戏存档内容
func SaveFileContent(ctx context.Context, gameID string, turns int, playerID, ip string, data json.RawMessage) error {
	_, err := DB.Exec(ctx, `
		INSERT INTO files_content (game_id, turns, created_player, created_ip, created_at, data)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, gameID, turns, playerID, ip, time.Now(), data)
	return err
}

// GetLatestFilePreview 获取游戏的最新预览内容
func GetLatestFilePreview(ctx context.Context, gameID string) (*FilePreview, error) {
	var fp FilePreview
	var createdPlayer *string
	var createdIP *string
	var data []byte

	err := DB.QueryRow(ctx, `
		SELECT id, game_id, turns, created_player, created_ip, created_at, data
		FROM files_preview
		WHERE game_id = $1
		ORDER BY turns DESC, created_at DESC
		LIMIT 1
	`, gameID).Scan(
		&fp.ID, &fp.GameID, &fp.Turns, &createdPlayer, &createdIP, &fp.CreatedAt, &data,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if createdPlayer != nil {
		fp.CreatedPlayer = *createdPlayer
	}
	if createdIP != nil {
		fp.CreatedIP = *createdIP
	}
	fp.Data = data

	return &fp, nil
}

// SaveFilePreview 保存游戏预览内容
func SaveFilePreview(ctx context.Context, gameID string, turns int, playerID, ip string, data json.RawMessage) error {
	_, err := DB.Exec(ctx, `
		INSERT INTO files_preview (game_id, turns, created_player, created_ip, created_at, data)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, gameID, turns, playerID, ip, time.Now(), data)
	return err
}

// GetAllTurnsForGame 获取游戏的所有回合数据（用于打包下载）
func GetAllTurnsForGame(ctx context.Context, gameID string) ([]FileContent, error) {
	rows, err := DB.Query(ctx, `
		SELECT id, game_id, turns, created_player, created_ip, created_at, data
		FROM files_content
		WHERE game_id = $1
		ORDER BY turns, created_at
	`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var contents []FileContent
	for rows.Next() {
		var fc FileContent
		var createdPlayer *string
		var createdIP *string
		var data []byte

		if err := rows.Scan(
			&fc.ID, &fc.GameID, &fc.Turns, &createdPlayer, &createdIP, &fc.CreatedAt, &data,
		); err != nil {
			return nil, err
		}

		if createdPlayer != nil {
			fc.CreatedPlayer = *createdPlayer
		}
		if createdIP != nil {
			fc.CreatedIP = *createdIP
		}
		fc.Data = data

		contents = append(contents, fc)
	}

	return contents, rows.Err()
}

// GetTurnsMetadata 获取游戏的所有回合元数据（不含存档数据）
func GetTurnsMetadata(ctx context.Context, gameID string) ([]TurnMetadata, error) {
	rows, err := DB.Query(ctx, `
		SELECT id, turns, created_player, created_ip, created_at
		FROM files_content
		WHERE game_id = $1
		ORDER BY turns, created_at
	`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var turns []TurnMetadata
	for rows.Next() {
		var t TurnMetadata
		var createdPlayer, createdIP *string

		if err := rows.Scan(&t.ID, &t.Turns, &createdPlayer, &createdIP, &t.CreatedAt); err != nil {
			return nil, err
		}

		if createdPlayer != nil {
			t.CreatedPlayer = *createdPlayer
		}
		if createdIP != nil {
			t.CreatedIP = *createdIP
		}

		turns = append(turns, t)
	}

	return turns, rows.Err()
}

// GetTurnByID 根据 ID 获取单个回合数据
func GetTurnByID(ctx context.Context, turnID int64) (*FileContent, error) {
	var fc FileContent
	var createdPlayer, createdIP *string
	var data []byte

	err := DB.QueryRow(ctx, `
		SELECT id, game_id, turns, created_player, created_ip, created_at, data
		FROM files_content
		WHERE id = $1
	`, turnID).Scan(
		&fc.ID, &fc.GameID, &fc.Turns, &createdPlayer, &createdIP, &fc.CreatedAt, &data,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if createdPlayer != nil {
		fc.CreatedPlayer = *createdPlayer
	}
	if createdIP != nil {
		fc.CreatedIP = *createdIP
	}
	fc.Data = data

	return &fc, nil
}
