package middleware

import (
	"context"
	"net/http"
	"strings"

	"unciv-srv/pkg/utils"
)

const (
	// GameIDKey 游戏ID上下文键
	GameIDKey ContextKey = "gameID"
	// IsPreviewKey 是否预览上下文键
	IsPreviewKey ContextKey = "isPreview"
)

// ValidateGameID 验证游戏ID中间件
// 用于 /files/* 接口
func ValidateGameID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 验证 User-Agent
		ua := r.UserAgent()
		if !strings.HasPrefix(ua, "Unciv") {
			utils.ErrorResponse(w, http.StatusForbidden, "非法客户端")
			return
		}

		// 获取游戏ID（从URL路径中）
		gameID := r.PathValue("gameId")
		if gameID == "" {
			utils.ErrorResponse(w, http.StatusBadRequest, "缺少游戏ID")
			return
		}

		// 验证游戏ID格式
		if !utils.ValidateGameID(gameID) {
			utils.ErrorResponse(w, http.StatusBadRequest, "无效的游戏ID格式")
			return
		}

		// 检查是否是预览
		isPreview := utils.IsPreviewID(gameID)

		// 获取基础游戏ID
		baseGameID := utils.GetBaseGameID(gameID)

		// 将信息存入上下文
		ctx := context.WithValue(r.Context(), GameIDKey, baseGameID)
		ctx = context.WithValue(ctx, IsPreviewKey, isPreview)

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetGameID 从上下文获取游戏ID
func GetGameID(r *http.Request) string {
	if v := r.Context().Value(GameIDKey); v != nil {
		return v.(string)
	}
	return ""
}

// IsPreview 从上下文获取是否是预览
func IsPreview(r *http.Request) bool {
	if v := r.Context().Value(IsPreviewKey); v != nil {
		return v.(bool)
	}
	return false
}
