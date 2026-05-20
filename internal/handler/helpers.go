package handler

import (
	"net/http"
	"slices"
	"strconv"

	"unciv-srv/internal/database"
	"unciv-srv/internal/middleware"
	"unciv-srv/pkg/utils"
)

// getGameOrError 获取游戏，失败时写 HTTP 错误响应
func getGameOrError(w http.ResponseWriter, r *http.Request, gameID string) (*database.Game, bool) {
	game, err := database.GetGameByID(r.Context(), gameID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误", err)
		return nil, false
	}
	if game == nil {
		utils.ErrorResponse(w, http.StatusNotFound, "游戏不存在", nil)
		return nil, false
	}
	return game, true
}

// getGameWithPlayerCheck 获取游戏并验证玩家是参与者（非管理员时）
func getGameWithPlayerCheck(w http.ResponseWriter, r *http.Request, gameID string, forbiddenMsg string) (*database.Game, bool) {
	game, ok := getGameOrError(w, r, gameID)
	if !ok {
		return nil, false
	}
	if !middleware.IsSessionAdmin(r) {
		userID := middleware.GetSessionUserID(r)
		if !slices.Contains(game.Players, userID) {
			utils.ErrorResponse(w, http.StatusForbidden, forbiddenMsg, nil)
			return nil, false
		}
	}
	return game, true
}

// getGameWithCreatorCheck 获取游戏并验证玩家是创建者（非管理员时）
func getGameWithCreatorCheck(w http.ResponseWriter, r *http.Request, gameID string, forbiddenMsg string) (*database.Game, bool) {
	game, ok := getGameOrError(w, r, gameID)
	if !ok {
		return nil, false
	}
	if !middleware.IsSessionAdmin(r) {
		userID := middleware.GetSessionUserID(r)
		isCreator, err := database.IsGameCreator(r.Context(), userID, gameID)
		if err != nil {
			utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误", err)
			return nil, false
		}
		if !isCreator {
			utils.ErrorResponse(w, http.StatusForbidden, forbiddenMsg, nil)
			return nil, false
		}
	}
	return game, true
}

// parsePagination 解析分页参数
func parsePagination(r *http.Request) (page, pageSize int, keyword string) {
	page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ = strconv.Atoi(r.URL.Query().Get("pageSize"))
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	keyword = r.URL.Query().Get("keyword")
	return
}
