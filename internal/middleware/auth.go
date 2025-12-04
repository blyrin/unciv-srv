package middleware

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"

	"unciv-srv/internal/database"
	"unciv-srv/pkg/utils"

	"github.com/google/uuid"
)

// ContextKey 上下文键类型
type ContextKey string

const (
	// PlayerIDKey 玩家ID上下文键
	PlayerIDKey ContextKey = "playerID"
	// PlayerPasswordKey 玩家密码上下文键
	PlayerPasswordKey ContextKey = "playerPassword"
)

// BasicAuth Basic 认证中间件
// 用于游戏客户端接口认证
func BasicAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 获取 Authorization 头
		auth := r.Header.Get("Authorization")
		if auth == "" {
			w.Header().Set("WWW-Authenticate", `Basic realm="Unciv Server"`)
			utils.ErrorResponse(w, http.StatusUnauthorized, "需要认证")
			return
		}

		// 解析 Basic Auth
		if !strings.HasPrefix(auth, "Basic ") {
			utils.ErrorResponse(w, http.StatusUnauthorized, "无效的认证格式")
			return
		}

		// Base64 解码
		payload, err := base64.StdEncoding.DecodeString(auth[6:])
		if err != nil {
			utils.ErrorResponse(w, http.StatusUnauthorized, "无效的认证数据")
			return
		}

		// 解析 username:password
		pair := string(payload)
		colonIdx := strings.Index(pair, ":")
		if colonIdx < 0 {
			utils.ErrorResponse(w, http.StatusUnauthorized, "无效的认证格式")
			return
		}

		playerID := pair[:colonIdx]
		password := pair[colonIdx+1:]

		// 验证 playerID 格式（必须是 UUID）
		if _, err := uuid.Parse(playerID); err != nil {
			utils.ErrorResponse(w, http.StatusBadRequest, "无效的玩家ID格式")
			return
		}

		// 获取客户端 IP
		ip := utils.GetClientIP(r)
		ctx := r.Context()

		// 查询玩家
		player, err := database.GetPlayerByID(ctx, playerID)
		if err != nil {
			utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误")
			return
		}

		if player == nil {
			// 新玩家，自动注册
			if err := database.CreatePlayer(ctx, playerID, password, ip); err != nil {
				utils.ErrorResponse(w, http.StatusInternalServerError, "创建玩家失败")
				return
			}
		} else {
			// 验证密码
			if player.Password != password {
				utils.ErrorResponse(w, http.StatusUnauthorized, "密码错误")
				return
			}

			// 更新最后活跃时间
			database.UpdatePlayerLastActive(ctx, playerID, ip)
		}

		// 将玩家ID和密码存入上下文
		newCtx := context.WithValue(ctx, PlayerIDKey, playerID)
		newCtx = context.WithValue(newCtx, PlayerPasswordKey, password)

		next.ServeHTTP(w, r.WithContext(newCtx))
	})
}

// GetPlayerID 从上下文获取玩家ID
func GetPlayerID(r *http.Request) string {
	if v := r.Context().Value(PlayerIDKey); v != nil {
		return v.(string)
	}
	return ""
}

// GetPlayerPassword 从上下文获取玩家密码
func GetPlayerPassword(r *http.Request) string {
	if v := r.Context().Value(PlayerPasswordKey); v != nil {
		return v.(string)
	}
	return ""
}
