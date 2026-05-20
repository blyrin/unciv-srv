package middleware

import (
	"context"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"unciv-srv/internal/database"
	"unciv-srv/pkg/utils"
)

// ContextKey 上下文键类型
type ContextKey string

const (
	// PlayerIDKey 玩家ID上下文键
	PlayerIDKey ContextKey = "playerID"
	// PlayerPasswordKey 玩家密码上下文键
	PlayerPasswordKey ContextKey = "playerPassword"
)

// ParseBasicAuthCredentials 解析 Basic Auth 头，返回玩家ID和密码（纯函数，不写 HTTP 响应）
func ParseBasicAuthCredentials(r *http.Request) (playerID, password string, err error) {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return "", "", errors.New("需要认证")
	}

	if !strings.HasPrefix(auth, "Basic ") {
		return "", "", errors.New("无效的认证格式")
	}

	payload, err := base64.StdEncoding.DecodeString(auth[6:])
	if err != nil {
		return "", "", errors.New("无效的认证数据")
	}

	pair := string(payload)
	colonIdx := strings.Index(pair, ":")
	if colonIdx < 0 {
		return "", "", errors.New("无效的认证格式")
	}

	playerID = strings.TrimSpace(pair[:colonIdx])
	password = strings.TrimSpace(pair[colonIdx+1:])

	if !utils.ValidatePlayerID(playerID) {
		return "", "", errors.New("无效的玩家ID格式")
	}

	if password == "" || len(password) < 6 {
		return "", "", errors.New("密码至少6位")
	}

	return playerID, password, nil
}

// parseBasicAuth 解析 Basic Auth 头，验证格式并写 HTTP 错误响应
func parseBasicAuth(r *http.Request, w http.ResponseWriter) (playerID, password string, ok bool) {
	playerID, password, err := ParseBasicAuthCredentials(r)
	if err != nil {
		utils.ErrorResponse(w, http.StatusUnauthorized, err.Error(), nil)
		return "", "", false
	}
	return playerID, password, true
}

// basicAuthMiddleware Basic 认证中间件（通用实现）
func basicAuthMiddleware(next http.Handler, allowRegister bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		playerID, password, ok := parseBasicAuth(r, w)
		if !ok {
			return
		}

		ip := utils.GetClientIP(r)
		ctx := r.Context()

		player, err := database.GetPlayerByID(ctx, playerID)
		if err != nil {
			utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误", err)
			return
		}

		if player == nil {
			if allowRegister {
				if err := database.CreatePlayer(ctx, playerID, password, ip); err != nil {
					utils.ErrorResponse(w, http.StatusInternalServerError, "创建玩家失败", err)
					return
				}
			} else {
				utils.ErrorResponse(w, http.StatusUnauthorized, "玩家不存在", nil)
				return
			}
		} else {
			if player.Password != password {
				utils.ErrorResponse(w, http.StatusUnauthorized, "密码错误", nil)
				return
			}
			if err := database.UpdatePlayerLastActive(ctx, playerID, ip); err != nil {
				slog.Error("更新最后活跃时间失败", "playerId", playerID, "error", err)
			}
		}

		newCtx := context.WithValue(ctx, PlayerIDKey, playerID)
		newCtx = context.WithValue(newCtx, PlayerPasswordKey, password)
		next.ServeHTTP(w, r.WithContext(newCtx))
	})
}

// BasicAuthWithRegister Basic 认证中间件（允许自动注册新玩家）
func BasicAuthWithRegister(next http.Handler) http.Handler {
	return basicAuthMiddleware(next, true)
}

// BasicAuth Basic 认证中间件（仅验证已存在的玩家）
func BasicAuth(next http.Handler) http.Handler {
	return basicAuthMiddleware(next, false)
}

// GetPlayerID 从上下文获取玩家ID
func GetPlayerID(r *http.Request) string {
	if v := r.Context().Value(PlayerIDKey); v != nil {
		return v.(string)
	}
	return ""
}

// ValidatePlayer 验证玩家凭证（不创建新玩家）
func ValidatePlayer(ctx context.Context, playerID, password string) (string, error) {
	if !utils.ValidatePlayerID(playerID) {
		return "", errors.New("无效的玩家ID格式")
	}

	player, err := database.GetPlayerByID(ctx, playerID)
	if err != nil {
		return "", err
	}

	if player == nil || player.Password != password {
		return "", nil
	}

	return playerID, nil
}
