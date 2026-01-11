package handler

import (
	"encoding/json"
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

// UpdateUserPasswordRequest 用户修改密码请求
type UpdateUserPasswordRequest struct {
	OldPassword string `json:"oldPassword"`
	NewPassword string `json:"newPassword"`
}

// UpdateUserPassword 处理 PUT /api/users/password
// 用户修改自己的密码
func UpdateUserPassword(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetSessionUserID(r)
	if userID == "" {
		utils.ErrorResponse(w, http.StatusUnauthorized, "未登录", nil)
		return
	}

	var req UpdateUserPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "无效的请求格式", err)
		return
	}

	if req.NewPassword == "" || len(req.NewPassword) < 6 {
		utils.ErrorResponse(w, http.StatusBadRequest, "新密码至少6位", nil)
		return
	}

	// 验证旧密码
	currentPassword, err := database.GetPlayerPassword(r.Context(), userID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "验证密码失败", err)
		return
	}

	if currentPassword != req.OldPassword {
		utils.ErrorResponse(w, http.StatusBadRequest, "旧密码错误", nil)
		return
	}

	// 更新密码
	ip := utils.GetClientIP(r)
	if err := database.UpdatePlayerPassword(r.Context(), userID, req.NewPassword, ip); err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "更新密码失败", err)
		return
	}

	utils.SuccessResponse(w)
}
