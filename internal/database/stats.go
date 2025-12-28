package database

import "context"

// Stats 统计数据
type Stats struct {
	PlayerCount          int     `json:"playerCount"`
	WhitelistPlayerCount int     `json:"whitelistPlayerCount"`
	GameCount            int     `json:"gameCount"`
	WhitelistGameCount   int     `json:"whitelistGameCount"`
	TodayNewPlayers      int     `json:"todayNewPlayers"`
	TodayNewGames        int     `json:"todayNewGames"`
	ActivePlayers7Days   int     `json:"activePlayers7Days"`
	ActivePlayers30Days  int     `json:"activePlayers30Days"`
	AvgGameTurns         float64 `json:"avgGameTurns"`
}

// GetAllStats 获取所有统计信息
func GetAllStats(ctx context.Context) (*Stats, error) {
	var s Stats
	err := DB.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM players) AS player_count,
			(SELECT COUNT(*) FROM players WHERE whitelist = TRUE) AS whitelist_player_count,
			(SELECT COUNT(*) FROM files) AS game_count,
			(SELECT COUNT(*) FROM files WHERE whitelist = TRUE) AS whitelist_game_count,
			(SELECT COUNT(*) FROM players WHERE created_at >= CURRENT_DATE) AS today_new_players,
			(SELECT COUNT(*) FROM files WHERE created_at >= CURRENT_DATE) AS today_new_games,
			(SELECT COUNT(*) FROM players WHERE updated_at >= NOW() - INTERVAL '7 days') AS active_players_7days,
			(SELECT COUNT(*) FROM players WHERE updated_at >= NOW() - INTERVAL '30 days') AS active_players_30days,
			(SELECT COALESCE(AVG(max_turns), 0) FROM (
				SELECT MAX(turns) AS max_turns FROM files_content GROUP BY game_id
			) sub) AS avg_game_turns
	`).Scan(
		&s.PlayerCount, &s.WhitelistPlayerCount,
		&s.GameCount, &s.WhitelistGameCount,
		&s.TodayNewPlayers, &s.TodayNewGames,
		&s.ActivePlayers7Days, &s.ActivePlayers30Days,
		&s.AvgGameTurns,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}
