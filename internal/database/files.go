package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// GetLatestFileContent 获取游戏的最新存档内容
func GetLatestFileContent(ctx context.Context, gameID string) (*FileContent, error) {
	var fc FileContent
	var createdPlayer *string
	var createdIP *string
	var data []byte

	err := DB.QueryRowContext(ctx, `
		SELECT id, game_id, turns, created_player, created_ip, created_at, data
		FROM files_content
		WHERE game_id = ?
		ORDER BY turns DESC, created_at DESC
		LIMIT 1
	`, gameID).Scan(
		&fc.ID, &fc.GameID, &fc.Turns, &createdPlayer, &createdIP, &fc.CreatedAt, &data,
	)

	if errors.Is(err, sql.ErrNoRows) {
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
	_, err := DB.ExecContext(ctx, `
		INSERT INTO files_content (game_id, turns, created_player, created_ip, created_at, data)
		VALUES (?, ?, ?, ?, ?, ?)
	`, gameID, turns, playerID, ip, time.Now(), data)
	return err
}

// GetLatestFilePreview 获取游戏的最新预览内容
func GetLatestFilePreview(ctx context.Context, gameID string) (*FilePreview, error) {
	var fp FilePreview
	var createdPlayer *string
	var createdIP *string
	var data []byte

	err := DB.QueryRowContext(ctx, `
		SELECT id, game_id, turns, created_player, created_ip, created_at, data
		FROM files_preview
		WHERE game_id = ?
		ORDER BY turns DESC, created_at DESC
		LIMIT 1
	`, gameID).Scan(
		&fp.ID, &fp.GameID, &fp.Turns, &createdPlayer, &createdIP, &fp.CreatedAt, &data,
	)

	if errors.Is(err, sql.ErrNoRows) {
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
	_, err := DB.ExecContext(ctx, `
		INSERT INTO files_preview (game_id, turns, created_player, created_ip, created_at, data)
		VALUES (?, ?, ?, ?, ?, ?)
	`, gameID, turns, playerID, ip, time.Now(), data)
	return err
}

// GetAllTurnsForGame 获取游戏的所有回合数据（用于打包下载）
func GetAllTurnsForGame(ctx context.Context, gameID string) ([]FileContent, error) {
	rows, err := DB.QueryContext(ctx, `
		SELECT id, game_id, turns, created_player, created_ip, created_at, data
		FROM files_content
		WHERE game_id = ?
		ORDER BY turns, created_at
	`, gameID)
	if err != nil {
		return nil, err
	}
	defer func(rows *sql.Rows) { _ = rows.Close() }(rows)

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
	rows, err := DB.QueryContext(ctx, `
		SELECT id, turns, created_player, created_ip, created_at
		FROM files_content
		WHERE game_id = ?
		ORDER BY turns, created_at
	`, gameID)
	if err != nil {
		return nil, err
	}
	defer func(rows *sql.Rows) { _ = rows.Close() }(rows)

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

	err := DB.QueryRowContext(ctx, `
		SELECT id, game_id, turns, created_player, created_ip, created_at, data
		FROM files_content
		WHERE id = ?
	`, turnID).Scan(
		&fc.ID, &fc.GameID, &fc.Turns, &createdPlayer, &createdIP, &fc.CreatedAt, &data,
	)

	if errors.Is(err, sql.ErrNoRows) {
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

// RollbackResult 回档结果
type RollbackResult struct {
	DeletedTurns    int64
	DeletedPreviews int64
	CurrentTurns    int
}

// ErrRollbackPreviewNotFound 未找到对应预览记录
var ErrRollbackPreviewNotFound = errors.New("未找到对应预览记录")

// RollbackGameToTurn 将游戏回退到指定存档
func RollbackGameToTurn(ctx context.Context, gameID string, turnID int64) (*RollbackResult, error) {
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	var target FileContent
	var createdPlayer, createdIP *string
	err = tx.QueryRowContext(ctx, `
		SELECT id, game_id, turns, created_player, created_ip, created_at
		FROM files_content
		WHERE id = ? AND game_id = ?
	`, turnID, gameID).Scan(
		&target.ID, &target.GameID, &target.Turns, &createdPlayer, &createdIP, &target.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if createdPlayer != nil {
		target.CreatedPlayer = *createdPlayer
	}
	if createdIP != nil {
		target.CreatedIP = *createdIP
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT id
		FROM files_content
		WHERE game_id = ?
		ORDER BY turns, created_at, id
	`, gameID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	deleteTurnIDs := make([]int64, 0)
	targetReached := false
	for rows.Next() {
		var currentID int64
		if err = rows.Scan(&currentID); err != nil {
			return nil, err
		}
		if targetReached {
			deleteTurnIDs = append(deleteTurnIDs, currentID)
			continue
		}
		if currentID == target.ID {
			targetReached = true
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}

	var targetPreviewID int64
	if createdPlayer != nil {
		err = tx.QueryRowContext(ctx, `
			SELECT id
			FROM files_preview
			WHERE game_id = ? AND turns = ? AND created_player = ?
			ORDER BY created_at, id
			LIMIT 1
		`, gameID, target.Turns, *createdPlayer).Scan(&targetPreviewID)
	} else {
		err = tx.QueryRowContext(ctx, `
			SELECT id
			FROM files_preview
			WHERE game_id = ? AND turns = ? AND created_player IS NULL
			ORDER BY created_at, id
			LIMIT 1
		`, gameID, target.Turns).Scan(&targetPreviewID)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrRollbackPreviewNotFound
	}
	if err != nil {
		return nil, err
	}

	var deletedTurns int64
	if len(deleteTurnIDs) > 0 {
		placeholders := make([]string, len(deleteTurnIDs))
		args := make([]any, 0, len(deleteTurnIDs)+1)
		args = append(args, gameID)
		for i, id := range deleteTurnIDs {
			placeholders[i] = "?"
			args = append(args, id)
		}

		deleteTurnsResult, execErr := tx.ExecContext(ctx, fmt.Sprintf(`
			DELETE FROM files_content
			WHERE game_id = ?
			AND id IN (%s)
		`, strings.Join(placeholders, ", ")), args...)
		if execErr != nil {
			return nil, execErr
		}
		deletedTurns, err = deleteTurnsResult.RowsAffected()
		if err != nil {
			return nil, err
		}
	}

	previewRows, err := tx.QueryContext(ctx, `
		SELECT id
		FROM files_preview
		WHERE game_id = ?
		ORDER BY turns, created_at, id
	`, gameID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = previewRows.Close() }()

	deletePreviewIDs := make([]int64, 0)
	targetPreviewReached := false
	for previewRows.Next() {
		var currentID int64
		if err = previewRows.Scan(&currentID); err != nil {
			return nil, err
		}
		if targetPreviewReached {
			deletePreviewIDs = append(deletePreviewIDs, currentID)
			continue
		}
		if currentID == targetPreviewID {
			targetPreviewReached = true
		}
	}
	if err = previewRows.Err(); err != nil {
		return nil, err
	}

	var deletedPreviews int64
	if len(deletePreviewIDs) > 0 {
		placeholders := make([]string, len(deletePreviewIDs))
		args := make([]any, 0, len(deletePreviewIDs)+1)
		args = append(args, gameID)
		for i, id := range deletePreviewIDs {
			placeholders[i] = "?"
			args = append(args, id)
		}

		deletePreviewsResult, execErr := tx.ExecContext(ctx, fmt.Sprintf(`
			DELETE FROM files_preview
			WHERE game_id = ?
			AND id IN (%s)
		`, strings.Join(placeholders, ", ")), args...)
		if execErr != nil {
			return nil, execErr
		}
		deletedPreviews, err = deletePreviewsResult.RowsAffected()
		if err != nil {
			return nil, err
		}
	}

	if _, err = tx.ExecContext(ctx, `
		UPDATE files
		SET updated_at = ?
		WHERE game_id = ?
	`, time.Now(), gameID); err != nil {
		return nil, err
	}

	if err = tx.Commit(); err != nil {
		return nil, err
	}

	return &RollbackResult{
		DeletedTurns:    deletedTurns,
		DeletedPreviews: deletedPreviews,
		CurrentTurns:    target.Turns,
	}, nil
}
