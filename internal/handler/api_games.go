package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"

	"unciv-srv/internal/database"
	"unciv-srv/internal/middleware"
	"unciv-srv/pkg/utils"
)

// UpdateGameRequest 更新游戏请求
type UpdateGameRequest struct {
	Whitelist bool   `json:"whitelist"`
	Remark    string `json:"remark"`
}

// GetAllGames 处理 GET /api/games
// 获取所有游戏列表（管理员）
func GetAllGames(w http.ResponseWriter, r *http.Request) {
	games, err := database.GetAllGames(r.Context())
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取游戏列表失败")
		return
	}

	utils.SuccessResponse(w, games)
}

// UpdateGame 处理 PUT /api/games/{gameId}
// 更新游戏信息（管理员）
func UpdateGame(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("gameId")
	if gameID == "" {
		utils.ErrorResponse(w, http.StatusBadRequest, "缺少游戏ID")
		return
	}

	var req UpdateGameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "无效的请求格式")
		return
	}

	if err := database.UpdateGameInfo(r.Context(), gameID, req.Whitelist, req.Remark); err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "更新游戏信息失败")
		return
	}

	utils.SuccessResponse(w, map[string]bool{"success": true})
}

// DeleteGame 处理 DELETE /api/games/{gameId}
// 删除游戏（用户只能删除自己创建的游戏，管理员可以删除任何游戏）
func DeleteGame(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("gameId")
	if gameID == "" {
		utils.ErrorResponse(w, http.StatusBadRequest, "缺少游戏ID")
		return
	}

	userID := middleware.GetSessionUserID(r)
	isAdmin := middleware.IsSessionAdmin(r)

	// 检查游戏是否存在
	game, err := database.GetGameByID(r.Context(), gameID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误")
		return
	}

	if game == nil {
		utils.ErrorResponse(w, http.StatusNotFound, "游戏不存在")
		return
	}

	// 非管理员需要检查是否是创建者
	if !isAdmin {
		isCreator, err := database.IsGameCreator(r.Context(), userID, gameID)
		if err != nil {
			utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误")
			return
		}

		if !isCreator {
			utils.ErrorResponse(w, http.StatusForbidden, "只能删除自己创建的游戏")
			return
		}
	}

	// 删除游戏
	if err := database.DeleteGame(r.Context(), gameID); err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "删除游戏失败")
		return
	}

	utils.SuccessResponse(w, map[string]bool{"success": true})
}

// DownloadGameHistory 处理 GET /api/games/{gameId}/download
// 下载游戏历史存档
func DownloadGameHistory(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("gameId")
	if gameID == "" {
		utils.ErrorResponse(w, http.StatusBadRequest, "缺少游戏ID")
		return
	}

	userID := middleware.GetSessionUserID(r)
	isAdmin := middleware.IsSessionAdmin(r)

	// 检查游戏是否存在
	game, err := database.GetGameByID(r.Context(), gameID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误")
		return
	}

	if game == nil {
		utils.ErrorResponse(w, http.StatusNotFound, "游戏不存在")
		return
	}

	// 非管理员需要检查是否是游戏参与者
	if !isAdmin {
		isPlayer := slices.Contains(game.Players, userID)
		if !isPlayer {
			utils.ErrorResponse(w, http.StatusForbidden, "无权下载此游戏")
			return
		}
	}

	// 获取所有回合数据
	contents, err := database.GetAllTurnsForGame(r.Context(), gameID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取存档失败")
		return
	}

	if len(contents) == 0 {
		utils.ErrorResponse(w, http.StatusNotFound, "没有存档数据")
		return
	}

	// 创建 ZIP 文件
	var entries []utils.FileEntry
	for _, content := range contents {
		filename := fmt.Sprintf("turn_%d_%s.json", content.Turns, content.CreatedAt.Format("20060102_150405"))
		entries = append(entries, utils.FileEntry{
			Name: filename,
			Data: content.Data,
		})
	}

	zipData, err := utils.CreateZip(entries)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "创建ZIP文件失败")
		return
	}

	filename := gameID + ".zip"
	utils.ZipResponse(w, filename, zipData)
}
