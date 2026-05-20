package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// getLatestFileData 获取游戏的最新文件数据（通用实现）
func getLatestFileData(ctx context.Context, table, gameID string) (*FileData, error) {
	var fd FileData
	var createdPlayer, createdIP *string
	var data []byte

	err := DB.QueryRowContext(ctx, fmt.Sprintf(`
		SELECT id, game_id, turns, created_player, created_ip, created_at, data
		FROM %s
		WHERE game_id = ?
		ORDER BY turns DESC, created_at DESC
		LIMIT 1
	`, table), gameID).Scan(
		&fd.ID, &fd.GameID, &fd.Turns, &createdPlayer, &createdIP, &fd.CreatedAt, &data,
	)

	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	fd.CreatedPlayer = deref(createdPlayer)
	fd.CreatedIP = deref(createdIP)
	fd.Data = data

	return &fd, nil
}

// saveFileData 保存文件数据（通用实现）
func saveFileData(ctx context.Context, table, gameID string, turns int, playerID, ip string, data json.RawMessage) error {
	_, err := DB.ExecContext(ctx, fmt.Sprintf(`
		INSERT INTO %s (game_id, turns, created_player, created_ip, created_at, data)
		VALUES (?, ?, ?, ?, ?, ?)
	`, table), gameID, turns, playerID, ip, time.Now(), data)
	return err
}

// GetLatestFileContent 获取游戏的最新存档内容
func GetLatestFileContent(ctx context.Context, gameID string) (*FileContent, error) {
	fd, err := getLatestFileData(ctx, "files_content", gameID)
	if err != nil || fd == nil {
		return nil, err
	}
	fc := FileContent{*fd}
	return &fc, nil
}

// SaveFileContent 保存游戏存档内容
func SaveFileContent(ctx context.Context, gameID string, turns int, playerID, ip string, data json.RawMessage) error {
	return saveFileData(ctx, "files_content", gameID, turns, playerID, ip, data)
}

// GetLatestFilePreview 获取游戏的最新预览内容
func GetLatestFilePreview(ctx context.Context, gameID string) (*FilePreview, error) {
	fd, err := getLatestFileData(ctx, "files_preview", gameID)
	if err != nil || fd == nil {
		return nil, err
	}
	fp := FilePreview{*fd}
	return &fp, nil
}

// SaveFilePreview 保存游戏预览内容
func SaveFilePreview(ctx context.Context, gameID string, turns int, playerID, ip string, data json.RawMessage) error {
	return saveFileData(ctx, "files_preview", gameID, turns, playerID, ip, data)
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
	defer rows.Close()

	var contents []FileContent
	for rows.Next() {
		var fc FileContent
		var createdPlayer, createdIP *string
		var data []byte

		if err := rows.Scan(
			&fc.ID, &fc.GameID, &fc.Turns, &createdPlayer, &createdIP, &fc.CreatedAt, &data,
		); err != nil {
			return nil, err
		}

		fc.CreatedPlayer = deref(createdPlayer)
		fc.CreatedIP = deref(createdIP)
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
	defer rows.Close()

	var turns []TurnMetadata
	for rows.Next() {
		var t TurnMetadata
		var createdPlayer, createdIP *string

		if err := rows.Scan(&t.ID, &t.Turns, &createdPlayer, &createdIP, &t.CreatedAt); err != nil {
			return nil, err
		}

		t.CreatedPlayer = deref(createdPlayer)
		t.CreatedIP = deref(createdIP)
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

	fc.CreatedPlayer = deref(createdPlayer)
	fc.CreatedIP = deref(createdIP)
	fc.Data = data

	return &fc, nil
}

// RollbackResult 回档结果
type RollbackResult struct {
	DeletedTurns    int64 `json:"deletedTurns"`
	DeletedPreviews int64 `json:"deletedPreviews"`
	CurrentTurns    int   `json:"currentTurns"`
}

// ErrRollbackPreviewNotFound 未找到对应预览记录
var ErrRollbackPreviewNotFound = errors.New("未找到对应预览记录")

// deleteRowsAfterTarget 删除目标 ID 之后的所有记录（基于 turns, created_at, id 排序）
func deleteRowsAfterTarget(ctx context.Context, tx *sql.Tx, table, gameID string, targetID int64) (int64, error) {
	result, err := tx.ExecContext(ctx, fmt.Sprintf(`
		DELETE FROM %s WHERE game_id = ? AND id IN (
			SELECT t1.id FROM %s t1 WHERE t1.game_id = ? AND t1.id != ? AND (
				t1.turns > (SELECT t2.turns FROM %s t2 WHERE t2.id = ?)
				OR (t1.turns = (SELECT t3.turns FROM %s t3 WHERE t3.id = ?)
					AND (t1.created_at > (SELECT t4.created_at FROM %s t4 WHERE t4.id = ?)
						OR (t1.created_at = (SELECT t5.created_at FROM %s t5 WHERE t5.id = ?) AND t1.id > ?)))
			)
		)
	`, table, table, table, table, table, table),
		gameID, gameID, targetID, targetID, targetID, targetID, targetID, targetID, targetID)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

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
		FROM files_content WHERE id = ? AND game_id = ?
	`, turnID, gameID).Scan(
		&target.ID, &target.GameID, &target.Turns, &createdPlayer, &createdIP, &target.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	target.CreatedPlayer = deref(createdPlayer)
	target.CreatedIP = deref(createdIP)

	var targetPreviewID int64
	if target.CreatedPlayer != "" {
		err = tx.QueryRowContext(ctx, `
			SELECT id FROM files_preview
			WHERE game_id = ? AND turns = ? AND created_player = ?
			ORDER BY created_at, id LIMIT 1
		`, gameID, target.Turns, target.CreatedPlayer).Scan(&targetPreviewID)
	} else {
		err = tx.QueryRowContext(ctx, `
			SELECT id FROM files_preview
			WHERE game_id = ? AND turns = ? AND created_player IS NULL
			ORDER BY created_at, id LIMIT 1
		`, gameID, target.Turns).Scan(&targetPreviewID)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrRollbackPreviewNotFound
	}
	if err != nil {
		return nil, err
	}

	deletedTurns, err := deleteRowsAfterTarget(ctx, tx, "files_content", gameID, target.ID)
	if err != nil {
		return nil, err
	}

	deletedPreviews, err := deleteRowsAfterTarget(ctx, tx, "files_preview", gameID, targetPreviewID)
	if err != nil {
		return nil, err
	}

	if _, err = tx.ExecContext(ctx, `UPDATE files SET updated_at = ? WHERE game_id = ?`, time.Now(), gameID); err != nil {
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
