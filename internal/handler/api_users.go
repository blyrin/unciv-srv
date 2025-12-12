package handler

import (
	"net/http"

	"unciv-srv/internal/database"
	"unciv-srv/internal/middleware"
	"unciv-srv/pkg/utils"
)

// UserGamesResponse 用户游戏列表响应
type UserGamesResponse struct {
	PlayerID string                   `json:"playerId"`
	Games    []database.GameWithTurns `json:"games"`
}

// GetUserGames 处理 GET /api/users/games
// 获取当前用户参与的游戏列表
func GetUserGames(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetSessionUserID(r)
	if userID == "" {
		utils.ErrorResponse(w, http.StatusUnauthorized, "未登录", nil)
		return
	}

	games, err := database.GetGamesByPlayer(r.Context(), userID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取游戏列表失败", err)
		return
	}

	// 确保 games 不为 nil
	if games == nil {
		games = []database.GameWithTurns{}
	}

	utils.JSONResponse(w, http.StatusOK, UserGamesResponse{
		PlayerID: userID,
		Games:    games,
	})
}

// GetStats 处理 GET /api/stats
// 获取统计信息（管理员）
func GetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := database.GetAllStats(r.Context())
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取统计信息失败", err)
		return
	}

	utils.JSONResponse(w, http.StatusOK, stats)
}

// GetUserStats 处理 GET /api/users/stats
// 获取当前用户的统计信息
func GetUserStats(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetSessionUserID(r)
	if userID == "" {
		utils.ErrorResponse(w, http.StatusUnauthorized, "未登录", nil)
		return
	}

	// 获取用户参与的游戏
	games, err := database.GetGamesByPlayer(r.Context(), userID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取统计信息失败", err)
		return
	}

	// 获取用户创建的游戏数量
	createdCount, err := database.GetGamesCreatedByPlayer(r.Context(), userID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取统计信息失败", err)
		return
	}

	utils.JSONResponse(w, http.StatusOK, map[string]int{
		"gameCount":    len(games),
		"createdCount": createdCount,
	})
}
