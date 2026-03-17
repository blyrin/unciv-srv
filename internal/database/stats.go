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
	ActiveGames7Days     int     `json:"activeGames7Days"`
	ActiveGames30Days    int     `json:"activeGames30Days"`
	TotalSaves           int     `json:"totalSaves"`
	TodayNewSaves        int     `json:"todayNewSaves"`
	AvgGameTurns         float64 `json:"avgGameTurns"`
	MaxGameTurns         int     `json:"maxGameTurns"`
}

// GetAllStats 获取所有统计信息
func GetAllStats(ctx context.Context) (*Stats, error) {
	var s Stats
	err := DB.QueryRowContext(ctx, `
		WITH player_stats AS (
			SELECT
				COUNT(*) AS player_count,
				COALESCE(SUM(CASE WHEN whitelist = 1 THEN 1 ELSE 0 END), 0) AS whitelist_player_count,
				COALESCE(SUM(CASE WHEN created_at >= date('now') THEN 1 ELSE 0 END), 0) AS today_new_players
			FROM players
		),
		game_stats AS (
			SELECT
				COUNT(*) AS game_count,
				COALESCE(SUM(CASE WHEN whitelist = 1 THEN 1 ELSE 0 END), 0) AS whitelist_game_count,
				COALESCE(SUM(CASE WHEN created_at >= date('now') THEN 1 ELSE 0 END), 0) AS today_new_games
			FROM files
		),
		content_stats AS (
			SELECT
				COUNT(*) AS total_saves,
				COALESCE(SUM(CASE WHEN created_at >= date('now') THEN 1 ELSE 0 END), 0) AS today_new_saves,
				COUNT(DISTINCT CASE WHEN created_player IS NOT NULL AND created_at >= datetime('now', '-7 days') THEN created_player END) AS active_players_7days,
				COUNT(DISTINCT CASE WHEN created_player IS NOT NULL AND created_at >= datetime('now', '-30 days') THEN created_player END) AS active_players_30days,
				COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-7 days') THEN game_id END) AS active_games_7days,
				COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-30 days') THEN game_id END) AS active_games_30days,
				COALESCE(MAX(turns), 0) AS max_game_turns
			FROM files_content
		),
		turn_stats AS (
			SELECT COALESCE(AVG(max_turns), 0) AS avg_game_turns
			FROM (SELECT MAX(turns) AS max_turns FROM files_content GROUP BY game_id)
		)
		SELECT
			p.player_count, p.whitelist_player_count,
			g.game_count, g.whitelist_game_count,
			p.today_new_players, g.today_new_games,
			c.active_players_7days, c.active_players_30days,
			c.active_games_7days, c.active_games_30days,
			c.total_saves, c.today_new_saves,
			t.avg_game_turns, c.max_game_turns
		FROM player_stats p, game_stats g, content_stats c, turn_stats t
	`).Scan(
		&s.PlayerCount, &s.WhitelistPlayerCount,
		&s.GameCount, &s.WhitelistGameCount,
		&s.TodayNewPlayers, &s.TodayNewGames,
		&s.ActivePlayers7Days, &s.ActivePlayers30Days,
		&s.ActiveGames7Days, &s.ActiveGames30Days,
		&s.TotalSaves, &s.TodayNewSaves,
		&s.AvgGameTurns, &s.MaxGameTurns,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}
