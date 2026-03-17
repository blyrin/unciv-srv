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

// GetGameByID 根据ID获取游戏
func GetGameByID(ctx context.Context, gameID string) (*Game, error) {
	var g Game
	var playersJSON []byte
	var remark *string

	err := DB.QueryRowContext(ctx, `
		SELECT game_id, players, created_at, updated_at, whitelist, remark
		FROM files
		WHERE game_id = ?
	`, gameID).Scan(
		&g.GameID, &playersJSON, &g.CreatedAt, &g.UpdatedAt, &g.Whitelist, &remark,
	)

	if errors.Is(err, sql.ErrNoRows) {
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
	_, err = DB.ExecContext(ctx, `
		INSERT INTO files (game_id, players, created_at, updated_at)
		VALUES (?, ?, ?, ?)
	`, gameID, playersJSON, now, now)
	return err
}

// UpdateGamePlayers 更新游戏玩家列表
func UpdateGamePlayers(ctx context.Context, gameID string, players []string) error {
	playersJSON, err := json.Marshal(players)
	if err != nil {
		return err
	}

	_, err = DB.ExecContext(ctx, `
		UPDATE files
		SET players = ?, updated_at = ?
		WHERE game_id = ?
	`, playersJSON, time.Now(), gameID)
	return err
}

// UpdateGameTimestamp 更新游戏时间戳
func UpdateGameTimestamp(ctx context.Context, gameID string) error {
	_, err := DB.ExecContext(ctx, `
		UPDATE files SET updated_at = ? WHERE game_id = ?
	`, time.Now(), gameID)
	return err
}

// scanGameWithTurns 从查询结果中扫描 GameWithTurns 记录
func scanGameWithTurns(rows *sql.Rows) (GameWithTurns, error) {
	var g GameWithTurns
	var playersJSON []byte
	var remark *string
	var createdPlayer *string

	if err := rows.Scan(
		&g.GameID, &playersJSON, &g.CreatedAt, &g.UpdatedAt,
		&g.Whitelist, &remark, &g.Turns, &createdPlayer,
	); err != nil {
		return g, err
	}

	if err := json.Unmarshal(playersJSON, &g.Players); err != nil {
		return g, err
	}

	if remark != nil {
		g.Remark = *remark
	}
	if createdPlayer != nil {
		g.CreatedPlayer = *createdPlayer
	}

	return g, nil
}

// GetAllGames 获取所有游戏列表（包含最新回合数）
func GetAllGames(ctx context.Context) ([]GameWithTurns, error) {
	rows, err := DB.QueryContext(ctx, `
		SELECT
			f.game_id, f.players, f.created_at, f.updated_at, f.whitelist, f.remark,
			COALESCE((SELECT turns FROM files_content WHERE game_id = f.game_id ORDER BY turns DESC, created_at DESC LIMIT 1), 0) AS turns,
			COALESCE((SELECT created_player FROM files_content WHERE game_id = f.game_id ORDER BY turns DESC, created_at DESC LIMIT 1), '') AS created_player
		FROM files f
		ORDER BY f.updated_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer func(rows *sql.Rows) { _ = rows.Close() }(rows)

	var games []GameWithTurns
	for rows.Next() {
		g, err := scanGameWithTurns(rows)
		if err != nil {
			return nil, err
		}
		games = append(games, g)
	}

	return games, rows.Err()
}

// GetGamesPage 分页获取游戏列表，支持关键字搜索
func GetGamesPage(ctx context.Context, keyword string, page, pageSize int) (*PageResult[GameWithTurns], error) {
	var where string
	var args []any

	if keyword != "" {
		where = ` WHERE f.game_id LIKE ? OR f.remark LIKE ? OR EXISTS (SELECT 1 FROM json_each(f.players) WHERE json_each.value LIKE ?)`
		like := "%" + keyword + "%"
		args = append(args, like, like, like)
	}

	// 查询总数
	var total int64
	err := DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM files f"+where, args...).Scan(&total)
	if err != nil {
		return nil, err
	}

	// 查询当前页
	offset := (page - 1) * pageSize
	queryArgs := append(args, pageSize, offset)
	rows, err := DB.QueryContext(ctx, `
		SELECT
			f.game_id, f.players, f.created_at, f.updated_at, f.whitelist, f.remark,
			COALESCE((SELECT turns FROM files_content WHERE game_id = f.game_id ORDER BY turns DESC, created_at DESC LIMIT 1), 0) AS turns,
			COALESCE((SELECT created_player FROM files_content WHERE game_id = f.game_id ORDER BY turns DESC, created_at DESC LIMIT 1), '') AS created_player
		FROM files f`+where+`
		ORDER BY f.updated_at DESC
		LIMIT ? OFFSET ?
	`, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer func(rows *sql.Rows) { _ = rows.Close() }(rows)

	items := make([]GameWithTurns, 0)
	for rows.Next() {
		g, err := scanGameWithTurns(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, g)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &PageResult[GameWithTurns]{Items: items, Total: total}, nil
}

// GetGamesByPlayer 获取玩家参与的游戏
func GetGamesByPlayer(ctx context.Context, playerID string) ([]GameWithTurns, error) {
	rows, err := DB.QueryContext(ctx, `
		SELECT
			f.game_id, f.players, f.created_at, f.updated_at, f.whitelist, f.remark,
			COALESCE((SELECT turns FROM files_content WHERE game_id = f.game_id ORDER BY turns DESC, created_at DESC LIMIT 1), 0) AS turns,
			COALESCE((SELECT created_player FROM files_content WHERE game_id = f.game_id ORDER BY turns DESC, created_at DESC LIMIT 1), '') AS created_player
		FROM files f
		WHERE EXISTS (SELECT 1 FROM json_each(f.players) WHERE json_each.value = ?)
		ORDER BY f.updated_at DESC
	`, playerID)
	if err != nil {
		return nil, err
	}
	defer func(rows *sql.Rows) { _ = rows.Close() }(rows)

	var games []GameWithTurns
	for rows.Next() {
		g, err := scanGameWithTurns(rows)
		if err != nil {
			return nil, err
		}
		games = append(games, g)
	}

	return games, rows.Err()
}

// DeleteGame 删除游戏
func DeleteGame(ctx context.Context, gameID string) error {
	_, err := DB.ExecContext(ctx, `DELETE FROM files WHERE game_id = ?`, gameID)
	return err
}

// UpdateGameInfo 更新游戏信息（白名单和备注）
func UpdateGameInfo(ctx context.Context, gameID string, whitelist bool, remark string) error {
	_, err := DB.ExecContext(ctx, `
		UPDATE files
		SET whitelist = ?, remark = ?, updated_at = ?
		WHERE game_id = ?
	`, whitelist, remark, time.Now(), gameID)
	return err
}

// IsGameCreator 检查玩家是否是游戏的创建者（第一个上传存档的玩家）
func IsGameCreator(ctx context.Context, playerID, gameID string) (bool, error) {
	var createdPlayer *string
	err := DB.QueryRowContext(ctx, `
		SELECT created_player
		FROM files_content
		WHERE game_id = ?
		ORDER BY created_at
		LIMIT 1
	`, gameID).Scan(&createdPlayer)

	if errors.Is(err, sql.ErrNoRows) {
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
	err := DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM (
			SELECT DISTINCT fc.game_id
			FROM files_content fc
			WHERE fc.created_player = ?
			AND fc.created_at = (
				SELECT MIN(created_at) FROM files_content WHERE game_id = fc.game_id
			)
		)
	`, playerID).Scan(&count)
	return count, err
}

// BatchUpdateGamesWhitelist 批量更新游戏白名单状态
func BatchUpdateGamesWhitelist(ctx context.Context, gameIDs []string, whitelist bool) error {
	if len(gameIDs) == 0 {
		return nil
	}
	placeholders := make([]string, len(gameIDs))
	args := make([]any, 0, len(gameIDs)+2)
	args = append(args, whitelist, time.Now())
	for i, id := range gameIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	query := fmt.Sprintf(`
		UPDATE files
		SET whitelist = ?, updated_at = ?
		WHERE game_id IN (%s)
	`, strings.Join(placeholders, ", "))
	_, err := DB.ExecContext(ctx, query, args...)
	return err
}

// BatchDeleteGames 批量删除游戏
func BatchDeleteGames(ctx context.Context, gameIDs []string) error {
	if len(gameIDs) == 0 {
		return nil
	}
	placeholders := make([]string, len(gameIDs))
	args := make([]any, 0, len(gameIDs))
	for i, id := range gameIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	query := fmt.Sprintf(`DELETE FROM files WHERE game_id IN (%s)`, strings.Join(placeholders, ", "))
	_, err := DB.ExecContext(ctx, query, args...)
	return err
}
