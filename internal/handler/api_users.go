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
		utils.ErrorResponse(w, http.StatusUnauthorized, "未登录")
		return
	}

	games, err := database.GetGamesByPlayer(r.Context(), userID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取游戏列表失败")
		return
	}

	// 确保 games 不为 nil
	if games == nil {
		games = []database.GameWithTurns{}
	}

	utils.SuccessResponse(w, UserGamesResponse{
		PlayerID: userID,
		Games:    games,
	})
}

// GetStats 处理 GET /api/stats
// 获取统计信息（管理员）
func GetStats(w http.ResponseWriter, r *http.Request) {
	playerCount, err := database.GetPlayerCount(r.Context())
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取统计信息失败")
		return
	}

	gameCount, err := database.GetGameCount(r.Context())
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取统计信息失败")
		return
	}

	whitelistPlayerCount, err := database.GetWhitelistPlayerCount(r.Context())
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取统计信息失败")
		return
	}

	whitelistGameCount, err := database.GetWhitelistGameCount(r.Context())
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取统计信息失败")
		return
	}

	utils.SuccessResponse(w, map[string]int{
		"playerCount":          playerCount,
		"gameCount":            gameCount,
		"whitelistPlayerCount": whitelistPlayerCount,
		"whitelistGameCount":   whitelistGameCount,
	})
}

// GetUserStats 处理 GET /api/users/stats
// 获取当前用户的统计信息
func GetUserStats(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetSessionUserID(r)
	if userID == "" {
		utils.ErrorResponse(w, http.StatusUnauthorized, "未登录")
		return
	}

	// 获取用户参与的游戏
	games, err := database.GetGamesByPlayer(r.Context(), userID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取统计信息失败")
		return
	}

	// 获取用户创建的游戏数量
	createdCount, err := database.GetGamesCreatedByPlayer(r.Context(), userID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取统计信息失败")
		return
	}

	utils.SuccessResponse(w, map[string]int{
		"gameCount":    len(games),
		"createdCount": createdCount,
	})
}
