package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"time"

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
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取游戏列表失败", err)
		return
	}

	utils.JSONResponse(w, http.StatusOK, games)
}

// UpdateGame 处理 PUT /api/games/{gameId}
// 更新游戏信息（管理员）
func UpdateGame(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("gameId")
	if gameID == "" {
		utils.ErrorResponse(w, http.StatusBadRequest, "缺少游戏ID", nil)
		return
	}

	var req UpdateGameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "无效的请求格式", err)
		return
	}

	if err := database.UpdateGameInfo(r.Context(), gameID, req.Whitelist, req.Remark); err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "更新游戏信息失败", err)
		return
	}

	utils.SuccessResponse(w)
}

// DeleteGame 处理 DELETE /api/games/{gameId}
// 删除游戏（用户只能删除自己创建的游戏，管理员可以删除任何游戏）
func DeleteGame(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("gameId")
	if gameID == "" {
		utils.ErrorResponse(w, http.StatusBadRequest, "缺少游戏ID", nil)
		return
	}

	userID := middleware.GetSessionUserID(r)
	isAdmin := middleware.IsSessionAdmin(r)

	// 检查游戏是否存在
	game, err := database.GetGameByID(r.Context(), gameID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误", err)
		return
	}

	if game == nil {
		utils.ErrorResponse(w, http.StatusNotFound, "游戏不存在", nil)
		return
	}

	// 非管理员需要检查是否是创建者
	if !isAdmin {
		isCreator, err := database.IsGameCreator(r.Context(), userID, gameID)
		if err != nil {
			utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误", err)
			return
		}

		if !isCreator {
			utils.ErrorResponse(w, http.StatusForbidden, "只能删除自己创建的游戏", nil)
			return
		}
	}

	// 删除游戏
	if err := database.DeleteGame(r.Context(), gameID); err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "删除游戏失败", err)
		return
	}

	utils.SuccessResponse(w)
}

// DownloadGameHistory 处理 GET /api/games/{gameId}/download
// 下载游戏历史存档
func DownloadGameHistory(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("gameId")
	if gameID == "" {
		utils.ErrorResponse(w, http.StatusBadRequest, "缺少游戏ID", nil)
		return
	}

	userID := middleware.GetSessionUserID(r)
	isAdmin := middleware.IsSessionAdmin(r)

	// 检查游戏是否存在
	game, err := database.GetGameByID(r.Context(), gameID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误", err)
		return
	}

	if game == nil {
		utils.ErrorResponse(w, http.StatusNotFound, "游戏不存在", nil)
		return
	}

	// 非管理员需要检查是否是游戏参与者
	if !isAdmin {
		isPlayer := slices.Contains(game.Players, userID)
		if !isPlayer {
			utils.ErrorResponse(w, http.StatusForbidden, "无权下载此游戏", nil)
			return
		}
	}

	// 获取所有回合数据
	contents, err := database.GetAllTurnsForGame(r.Context(), gameID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取存档失败", err)
		return
	}

	if len(contents) == 0 {
		utils.ErrorResponse(w, http.StatusNotFound, "没有存档数据", nil)
		return
	}

	// 创建 ZIP 文件
	var entries []utils.FileEntry
	for _, content := range contents {
		filename := fmt.Sprintf("turn_%d_%s.json", content.Turns, content.CreatedAt.Format(time.RFC3339))
		entries = append(entries, utils.FileEntry{
			Name: filename,
			Data: content.Data,
		})
	}

	zipData, err := utils.CreateZip(entries)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "创建ZIP文件失败", err)
		return
	}

	filename := "game_" + gameID + ".zip"
	utils.FileResponse(w, "application/zip", filename, zipData)
}

// GetGameTurns 处理 GET /api/games/{gameId}/turns
// 获取游戏的所有回合元数据（用户只能查看自己参与的游戏，管理员可以查看任何游戏）
func GetGameTurns(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("gameId")
	if gameID == "" {
		utils.ErrorResponse(w, http.StatusBadRequest, "缺少游戏ID", nil)
		return
	}

	userID := middleware.GetSessionUserID(r)
	isAdmin := middleware.IsSessionAdmin(r)

	// 检查游戏是否存在
	game, err := database.GetGameByID(r.Context(), gameID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误", err)
		return
	}
	if game == nil {
		utils.ErrorResponse(w, http.StatusNotFound, "游戏不存在", nil)
		return
	}

	// 非管理员需要检查是否是游戏参与者
	if !isAdmin {
		isPlayer := slices.Contains(game.Players, userID)
		if !isPlayer {
			utils.ErrorResponse(w, http.StatusForbidden, "无权查看此游戏", nil)
			return
		}
	}

	turns, err := database.GetTurnsMetadata(r.Context(), gameID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "获取回合列表失败", err)
		return
	}

	if turns == nil {
		turns = []database.TurnMetadata{}
	}

	utils.JSONResponse(w, http.StatusOK, turns)
}

// DownloadSingleTurn 处理 GET /api/games/{gameId}/turns/{turnId}/download
// 下载单个回合存档（用户只能下载自己参与的游戏，管理员可以下载任何游戏）
func DownloadSingleTurn(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("gameId")
	turnIDStr := r.PathValue("turnId")

	if gameID == "" || turnIDStr == "" {
		utils.ErrorResponse(w, http.StatusBadRequest, "缺少参数", nil)
		return
	}

	turnID, err := strconv.ParseInt(turnIDStr, 10, 64)
	if err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "无效的回合ID", nil)
		return
	}

	userID := middleware.GetSessionUserID(r)
	isAdmin := middleware.IsSessionAdmin(r)

	// 检查游戏是否存在
	game, err := database.GetGameByID(r.Context(), gameID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误", err)
		return
	}
	if game == nil {
		utils.ErrorResponse(w, http.StatusNotFound, "游戏不存在", nil)
		return
	}

	// 非管理员需要检查是否是游戏参与者
	if !isAdmin {
		isPlayer := slices.Contains(game.Players, userID)
		if !isPlayer {
			utils.ErrorResponse(w, http.StatusForbidden, "无权下载此游戏", nil)
			return
		}
	}

	turn, err := database.GetTurnByID(r.Context(), turnID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误", err)
		return
	}
	if turn == nil || turn.GameID != gameID {
		utils.ErrorResponse(w, http.StatusNotFound, "回合不存在", nil)
		return
	}

	filename := fmt.Sprintf("game_%s_turn_%d.json", gameID, turn.Turns)
	utils.FileResponse(w, "application/json", filename, turn.Data)
}

// BatchUpdateGamesRequest 批量更新游戏请求
type BatchUpdateGamesRequest struct {
	GameIDs   []string `json:"gameIds"`
	Whitelist bool     `json:"whitelist"`
}

// BatchUpdateGames 处理 PATCH /api/games/batch
// 批量更新游戏白名单状态（管理员）
func BatchUpdateGames(w http.ResponseWriter, r *http.Request) {
	var req BatchUpdateGamesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "无效的请求格式", err)
		return
	}

	if len(req.GameIDs) == 0 {
		utils.ErrorResponse(w, http.StatusBadRequest, "未选择游戏", nil)
		return
	}

	if err := database.BatchUpdateGamesWhitelist(r.Context(), req.GameIDs, req.Whitelist); err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "批量更新失败", err)
		return
	}

	utils.SuccessResponse(w)
}

// BatchDeleteGamesRequest 批量删除游戏请求
type BatchDeleteGamesRequest struct {
	GameIDs []string `json:"gameIds"`
}

// BatchDeleteGames 处理 DELETE /api/games/batch
// 批量删除游戏（管理员）
func BatchDeleteGames(w http.ResponseWriter, r *http.Request) {
	var req BatchDeleteGamesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "无效的请求格式", err)
		return
	}

	if len(req.GameIDs) == 0 {
		utils.ErrorResponse(w, http.StatusBadRequest, "未选择游戏", nil)
		return
	}

	if err := database.BatchDeleteGames(r.Context(), req.GameIDs); err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "批量删除失败", err)
		return
	}

	utils.SuccessResponse(w)
}
