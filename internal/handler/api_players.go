package handler

import (
	"encoding/json"
	"net/http"

	"unciv-srv/internal/database"
	"unciv-srv/pkg/utils"
)

// UpdatePlayerRequest 更新玩家请求
type UpdatePlayerRequest struct {
	Whitelist bool   `json:"whitelist"`
	Remark    string `json:"remark"`
}

// GetAllPlayers 处理 GET /api/players
// 获取所有玩家列表（管理员）
func GetAllPlayers(w http.ResponseWriter, r *http.Request) {
	players, err := database.GetAllPlayers(r.Context())
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取玩家列表失败")
		return
	}

	// 清除密码字段
	for i := range players {
		players[i].Password = ""
	}

	utils.SuccessResponse(w, players)
}

// UpdatePlayer 处理 PUT /api/players/{playerId}
// 更新玩家信息（管理员）
func UpdatePlayer(w http.ResponseWriter, r *http.Request) {
	playerID := r.PathValue("playerId")
	if playerID == "" {
		utils.ErrorResponse(w, http.StatusBadRequest, "缺少玩家ID")
		return
	}

	var req UpdatePlayerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "无效的请求格式")
		return
	}

	if err := database.UpdatePlayerInfo(r.Context(), playerID, req.Whitelist, req.Remark); err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "更新玩家信息失败")
		return
	}

	utils.SuccessResponse(w, map[string]bool{"success": true})
}

// GetPlayerPassword 处理 GET /api/players/{playerId}/password
// 获取玩家密码（管理员）
func GetPlayerPassword(w http.ResponseWriter, r *http.Request) {
	playerID := r.PathValue("playerId")
	if playerID == "" {
		utils.ErrorResponse(w, http.StatusBadRequest, "缺少玩家ID")
		return
	}

	password, err := database.GetPlayerPassword(r.Context(), playerID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取密码失败")
		return
	}

	if password == "" {
		utils.ErrorResponse(w, http.StatusNotFound, "玩家不存在")
		return
	}

	utils.SuccessResponse(w, map[string]string{"password": password})
}
