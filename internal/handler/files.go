package handler

import (
	"io"
	"log/slog"
	"net/http"
	"slices"

	"unciv-srv/internal/database"
	"unciv-srv/internal/middleware"
	"unciv-srv/pkg/utils"
)

// GetFile 处理 GET /files/{gameId}
// 下载游戏存档
func GetFile(w http.ResponseWriter, r *http.Request) {
	gameID := middleware.GetGameID(r)
	isPreview := middleware.IsPreview(r)

	var data []byte

	if isPreview {
		file, err := database.GetLatestFilePreview(r.Context(), gameID)
		if err != nil {
			utils.ErrorResponse(w, http.StatusInternalServerError, "获取存档失败", err)
			return
		}
		if file == nil {
			utils.ErrorResponse(w, http.StatusNotFound, "找不到存档", nil)
			return
		}
		data = file.Data
	} else {
		file, err := database.GetLatestFileContent(r.Context(), gameID)
		if err != nil {
			utils.ErrorResponse(w, http.StatusInternalServerError, "获取存档失败", err)
			return
		}
		if file == nil {
			utils.ErrorResponse(w, http.StatusNotFound, "找不到存档", nil)
			return
		}
		data = file.Data
	}

	// 编码并返回
	encoded, err := utils.EncodeFile(data)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "编码存档失败", err)
		return
	}

	utils.TextResponse(w, http.StatusOK, encoded)
}

// PutFile 处理 PUT /files/{gameId}
// 上传游戏存档
func PutFile(w http.ResponseWriter, r *http.Request) {
	playerID := middleware.GetPlayerID(r)
	gameID := middleware.GetGameID(r)
	isPreview := middleware.IsPreview(r)
	ip := utils.GetClientIP(r)

	// 限制请求体大小
	r.Body = http.MaxBytesReader(w, r.Body, utils.MaxBodySize)
	defer func() { _ = r.Body.Close() }()

	// 读取请求体
	body, err := io.ReadAll(r.Body)
	if err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "读取请求体失败", err)
		return
	}

	if len(body) == 0 {
		utils.ErrorResponse(w, http.StatusBadRequest, "存档数据不能为空", nil)
		return
	}

	// 解码存档
	decodedData, err := utils.DecodeFile(string(body))
	if err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "存档格式无效", err)
		return
	}

	// 解析游戏数据
	gameData, err := utils.ParseGameData(decodedData)
	if err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "存档格式无效", err)
		return
	}

	// 验证游戏ID
	if gameData.GameID != gameID {
		slog.Warn("游戏ID不匹配", "playerId", playerID, "expected", gameID, "actual", gameData.GameID)
		utils.ErrorResponse(w, http.StatusBadRequest, "游戏ID不匹配", nil)
		return
	}

	// 获取玩家列表
	playerIDs, err := utils.GetPlayerIDsFromGameData(decodedData)
	if err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "无法获取玩家列表", err)
		return
	}

	// 验证当前玩家是否在游戏中
	if !slices.Contains(playerIDs, playerID) {
		slog.Warn("玩家不在游戏中", "playerId", playerID, "gameId", gameID)
		utils.ErrorResponse(w, http.StatusForbidden, "你不是该游戏的玩家", nil)
		return
	}

	ctx := r.Context()

	// 检查游戏是否存在
	game, err := database.GetGameByID(ctx, gameID)
	if err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误", err)
		return
	}

	if game == nil {
		// 创建新游戏
		if err := database.CreateGame(ctx, gameID, playerIDs); err != nil {
			utils.ErrorResponse(w, http.StatusInternalServerError, "创建游戏失败", err)
			return
		}
	} else {
		hasPermission := slices.Contains(game.Players, playerID)
		if !hasPermission {
			utils.ErrorResponse(w, http.StatusForbidden, "无权操作此游戏", nil)
			return
		}

		// 更新玩家列表
		if err := database.UpdateGamePlayers(ctx, gameID, playerIDs); err != nil {
			slog.Error("更新玩家列表失败", "gameId", gameID, "error", err)
		}
	}

	// 保存存档
	turns := gameData.Turns
	if isPreview {
		if err := database.SaveFilePreview(ctx, gameID, turns, playerID, ip, decodedData); err != nil {
			utils.ErrorResponse(w, http.StatusInternalServerError, "保存存档失败", err)
			return
		}
	} else {
		if err := database.SaveFileContent(ctx, gameID, turns, playerID, ip, decodedData); err != nil {
			utils.ErrorResponse(w, http.StatusInternalServerError, "保存存档失败", err)
			return
		}
	}

	// 更新游戏时间戳
	if err := database.UpdateGameTimestamp(ctx, gameID); err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "保存存档失败", err)
		return
	}

	utils.SuccessResponse(w)
}
