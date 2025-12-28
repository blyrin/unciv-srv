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
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取玩家列表失败", err)
		return
	}

	// 清除密码字段
	for i := range players {
		players[i].Password = ""
	}

	utils.JSONResponse(w, http.StatusOK, players)
}

// UpdatePlayer 处理 PUT /api/players/{playerId}
// 更新玩家信息（管理员）
func UpdatePlayer(w http.ResponseWriter, r *http.Request) {
	playerID := r.PathValue("playerId")
	if playerID == "" {
		utils.ErrorResponse(w, http.StatusBadRequest, "缺少玩家ID", nil)
		return
	}

	var req UpdatePlayerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "无效的请求格式", err)
		return
	}

	if err := database.UpdatePlayerInfo(r.Context(), playerID, req.Whitelist, req.Remark); err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "更新玩家信息失败", err)
		return
	}

	utils.SuccessResponse(w)
}

// GetPlayerPassword 处理 GET /api/players/{playerId}/password
// 获取玩家密码（管理员）
func GetPlayerPassword(w http.ResponseWriter, r *http.Request) {
	playerID := r.PathValue("playerId")
	if playerID == "" {
		utils.ErrorResponse(w, http.StatusBadRequest, "缺少玩家ID", nil)
		return
	}

	password, err := database.GetPlayerPassword(r.Context(), playerID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取密码失败", err)
		return
	}

	if password == "" {
		utils.ErrorResponse(w, http.StatusNotFound, "玩家不存在", nil)
		return
	}

	utils.JSONResponse(w, http.StatusOK, map[string]string{"password": password})
}

// BatchUpdatePlayersRequest 批量更新玩家请求
type BatchUpdatePlayersRequest struct {
	PlayerIDs []string `json:"playerIds"`
	Whitelist bool     `json:"whitelist"`
}

// BatchUpdatePlayers 处理 PATCH /api/players/batch
// 批量更新玩家白名单状态（管理员）
func BatchUpdatePlayers(w http.ResponseWriter, r *http.Request) {
	var req BatchUpdatePlayersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "无效的请求格式", err)
		return
	}

	if len(req.PlayerIDs) == 0 {
		utils.ErrorResponse(w, http.StatusBadRequest, "未选择玩家", nil)
		return
	}

	if err := database.BatchUpdatePlayersWhitelist(r.Context(), req.PlayerIDs, req.Whitelist); err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "批量更新失败", err)
		return
	}

	utils.SuccessResponse(w)
}
