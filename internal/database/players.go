package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// GetPlayerByID 根据ID获取玩家
func GetPlayerByID(ctx context.Context, playerID string) (*Player, error) {
	var p Player
	var remark, createIP, updateIP *string

	err := DB.QueryRowContext(ctx, `
		SELECT player_id, password, created_at, updated_at, whitelist, remark, create_ip, update_ip
		FROM players
		WHERE player_id = ?
	`, playerID).Scan(
		&p.PlayerID, &p.Password, &p.CreatedAt, &p.UpdatedAt,
		&p.Whitelist, &remark, &createIP, &updateIP,
	)

	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if remark != nil {
		p.Remark = *remark
	}
	if createIP != nil {
		p.CreateIP = *createIP
	}
	if updateIP != nil {
		p.UpdateIP = *updateIP
	}

	return &p, nil
}

// CreatePlayer 创建新玩家
func CreatePlayer(ctx context.Context, playerID, password, ip string) error {
	now := time.Now()
	_, err := DB.ExecContext(ctx, `
		INSERT INTO players (player_id, password, created_at, updated_at, create_ip, update_ip)
		VALUES (?, ?, ?, ?, ?, ?)
	`, playerID, password, now, now, ip, ip)
	return err
}

// UpdatePlayerPassword 更新玩家密码
func UpdatePlayerPassword(ctx context.Context, playerID, password, ip string) error {
	_, err := DB.ExecContext(ctx, `
		UPDATE players
		SET password = ?, updated_at = ?, update_ip = ?
		WHERE player_id = ?
	`, password, time.Now(), ip, playerID)
	return err
}

// UpdatePlayerLastActive 更新玩家最后活跃时间和IP
func UpdatePlayerLastActive(ctx context.Context, playerID, ip string) error {
	_, err := DB.ExecContext(ctx, `
		UPDATE players
		SET updated_at = ?, update_ip = ?
		WHERE player_id = ?
	`, time.Now(), ip, playerID)
	return err
}

// GetAllPlayers 获取所有玩家列表
func GetAllPlayers(ctx context.Context) ([]Player, error) {
	rows, err := DB.QueryContext(ctx, `
		SELECT player_id, password, created_at, updated_at, whitelist, remark, create_ip, update_ip
		FROM players
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer func(rows *sql.Rows) { _ = rows.Close() }(rows)

	players := make([]Player, 0, 100)
	for rows.Next() {
		var p Player
		var remark, createIP, updateIP *string

		if err := rows.Scan(
			&p.PlayerID, &p.Password, &p.CreatedAt, &p.UpdatedAt,
			&p.Whitelist, &remark, &createIP, &updateIP,
		); err != nil {
			return nil, err
		}

		if remark != nil {
			p.Remark = *remark
		}
		if createIP != nil {
			p.CreateIP = *createIP
		}
		if updateIP != nil {
			p.UpdateIP = *updateIP
		}

		players = append(players, p)
	}

	return players, rows.Err()
}

// UpdatePlayerInfo 更新玩家信息（白名单和备注）
func UpdatePlayerInfo(ctx context.Context, playerID string, whitelist bool, remark string) error {
	_, err := DB.ExecContext(ctx, `
		UPDATE players
		SET whitelist = ?, remark = ?, updated_at = ?
		WHERE player_id = ?
	`, whitelist, remark, time.Now(), playerID)
	return err
}

// GetPlayerPassword 获取玩家密码
func GetPlayerPassword(ctx context.Context, playerID string) (string, error) {
	var password string
	err := DB.QueryRowContext(ctx, `
		SELECT password FROM players WHERE player_id = ?
	`, playerID).Scan(&password)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return password, err
}

// BatchUpdatePlayersWhitelist 批量更新玩家白名单状态
func BatchUpdatePlayersWhitelist(ctx context.Context, playerIDs []string, whitelist bool) error {
	if len(playerIDs) == 0 {
		return nil
	}
	placeholders := make([]string, len(playerIDs))
	args := make([]any, 0, len(playerIDs)+2)
	args = append(args, whitelist, time.Now())
	for i, id := range playerIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	query := fmt.Sprintf(`
		UPDATE players
		SET whitelist = ?, updated_at = ?
		WHERE player_id IN (%s)
	`, strings.Join(placeholders, ", "))
	_, err := DB.ExecContext(ctx, query, args...)
	return err
}
