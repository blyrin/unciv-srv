package database

import "context"

// Stats 统计数据
type Stats struct {
	PlayerCount          int `json:"playerCount"`
	WhitelistPlayerCount int `json:"whitelistPlayerCount"`
	GameCount            int `json:"gameCount"`
	WhitelistGameCount   int `json:"whitelistGameCount"`
}

// GetAllStats 获取所有统计信息
func GetAllStats(ctx context.Context) (*Stats, error) {
	var s Stats
	err := DB.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM players) AS player_count,
			(SELECT COUNT(*) FROM players WHERE whitelist = TRUE) AS whitelist_player_count,
			(SELECT COUNT(*) FROM files) AS game_count,
			(SELECT COUNT(*) FROM files WHERE whitelist = TRUE) AS whitelist_game_count
	`).Scan(&s.PlayerCount, &s.WhitelistPlayerCount, &s.GameCount, &s.WhitelistGameCount)
	if err != nil {
		return nil, err
	}
	return &s, nil
}
