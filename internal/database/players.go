package database

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// GetPlayerByID 根据ID获取玩家
func GetPlayerByID(ctx context.Context, playerID string) (*Player, error) {
	var p Player
	var remark, createIP, updateIP *string

	err := DB.QueryRow(ctx, `
		SELECT player_id, password, created_at, updated_at, whitelist, remark, create_ip, update_ip
		FROM players
		WHERE player_id = $1
	`, playerID).Scan(
		&p.PlayerID, &p.Password, &p.CreatedAt, &p.UpdatedAt,
		&p.Whitelist, &remark, &createIP, &updateIP,
	)

	if errors.Is(err, pgx.ErrNoRows) {
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
	_, err := DB.Exec(ctx, `
		INSERT INTO players (player_id, password, created_at, updated_at, create_ip, update_ip)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, playerID, password, now, now, ip, ip)
	return err
}

// UpdatePlayerPassword 更新玩家密码
func UpdatePlayerPassword(ctx context.Context, playerID, password, ip string) error {
	_, err := DB.Exec(ctx, `
		UPDATE players
		SET password = $1, updated_at = $2, update_ip = $3
		WHERE player_id = $4
	`, password, time.Now(), ip, playerID)
	return err
}

// UpdatePlayerLastActive 更新玩家最后活跃时间和IP
func UpdatePlayerLastActive(ctx context.Context, playerID, ip string) error {
	_, err := DB.Exec(ctx, `
		UPDATE players
		SET updated_at = $1, update_ip = $2
		WHERE player_id = $3
	`, time.Now(), ip, playerID)
	return err
}

// GetAllPlayers 获取所有玩家列表
func GetAllPlayers(ctx context.Context) ([]Player, error) {
	rows, err := DB.Query(ctx, `
		SELECT player_id, password, created_at, updated_at, whitelist, remark, create_ip, update_ip
		FROM players
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

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
	_, err := DB.Exec(ctx, `
		UPDATE players
		SET whitelist = $1, remark = $2, updated_at = $3
		WHERE player_id = $4
	`, whitelist, remark, time.Now(), playerID)
	return err
}

// GetPlayerPassword 获取玩家密码
func GetPlayerPassword(ctx context.Context, playerID string) (string, error) {
	var password string
	err := DB.QueryRow(ctx, `
		SELECT password FROM players WHERE player_id = $1
	`, playerID).Scan(&password)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return password, err
}

// BatchUpdatePlayersWhitelist 批量更新玩家白名单状态
func BatchUpdatePlayersWhitelist(ctx context.Context, playerIDs []string, whitelist bool) error {
	if len(playerIDs) == 0 {
		return nil
	}
	_, err := DB.Exec(ctx, `
		UPDATE players
		SET whitelist = $1, updated_at = $2
		WHERE player_id = ANY($3)
	`, whitelist, time.Now(), playerIDs)
	return err
}
