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

// basicAuthResult 解析 Basic Auth 的结果
type basicAuthResult struct {
	playerID string
	password string
}

// parseBasicAuth 解析 Basic Auth 头，返回玩家ID和密码
func parseBasicAuth(r *http.Request, w http.ResponseWriter) (*basicAuthResult, bool) {
	// 获取 Authorization 头
	auth := r.Header.Get("Authorization")
	if auth == "" {
		utils.ErrorResponse(w, http.StatusUnauthorized, "需要认证", nil)
		return nil, false
	}

	// 解析 Basic Auth
	if !strings.HasPrefix(auth, "Basic ") {
		utils.ErrorResponse(w, http.StatusUnauthorized, "无效的认证格式", nil)
		return nil, false
	}

	// Base64 解码
	payload, err := base64.StdEncoding.DecodeString(auth[6:])
	if err != nil {
		utils.ErrorResponse(w, http.StatusUnauthorized, "无效的认证数据", err)
		return nil, false
	}

	// 解析 username:password
	pair := string(payload)
	colonIdx := strings.Index(pair, ":")
	if colonIdx < 0 {
		utils.ErrorResponse(w, http.StatusUnauthorized, "无效的认证格式", nil)
		return nil, false
	}

	playerID := strings.TrimSpace(pair[:colonIdx])
	password := strings.TrimSpace(pair[colonIdx+1:])

	// 验证 playerID 格式（必须是 UUID）
	if !utils.ValidatePlayerID(playerID) {
		utils.ErrorResponse(w, http.StatusUnauthorized, "无效的玩家ID格式", nil)
		return nil, false
	}

	// 需要密码登录
	if password == "" || len(password) < 6 {
		utils.ErrorResponse(w, http.StatusUnauthorized, "密码至少6位", nil)
		return nil, false
	}

	return &basicAuthResult{playerID: playerID, password: password}, true
}

// BasicAuthWithRegister Basic 认证中间件（允许自动注册新玩家）
func BasicAuthWithRegister(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		result, ok := parseBasicAuth(r, w)
		if !ok {
			return
		}

		// 获取客户端 IP
		ip := utils.GetClientIP(r)
		ctx := r.Context()

		// 查询玩家
		player, err := database.GetPlayerByID(ctx, result.playerID)
		if err != nil {
			utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误", err)
			return
		}

		if player == nil {
			// 新玩家，自动注册
			if err := database.CreatePlayer(ctx, result.playerID, result.password, ip); err != nil {
				utils.ErrorResponse(w, http.StatusInternalServerError, "创建玩家失败", err)
				return
			}
		} else {
			// 验证密码
			if player.Password != result.password {
				utils.ErrorResponse(w, http.StatusUnauthorized, "密码错误", nil)
				return
			}

			// 更新最后活跃时间
			if err := database.UpdatePlayerLastActive(ctx, result.playerID, ip); err != nil {
				slog.Error("更新最后活跃时间失败", "playerId", result.playerID, "error", err)
			}
		}

		// 将玩家ID和密码存入上下文
		newCtx := context.WithValue(ctx, PlayerIDKey, result.playerID)
		newCtx = context.WithValue(newCtx, PlayerPasswordKey, result.password)

		next.ServeHTTP(w, r.WithContext(newCtx))
	})
}

// BasicAuth Basic 认证中间件（仅验证已存在的玩家）
func BasicAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		result, ok := parseBasicAuth(r, w)
		if !ok {
			return
		}

		// 获取客户端 IP
		ip := utils.GetClientIP(r)
		ctx := r.Context()

		// 查询玩家
		player, err := database.GetPlayerByID(ctx, result.playerID)
		if err != nil {
			utils.ErrorResponse(w, http.StatusInternalServerError, "数据库错误", err)
			return
		}

		if player == nil {
			// 玩家不存在，拒绝访问
			utils.ErrorResponse(w, http.StatusUnauthorized, "玩家不存在", nil)
			return
		}

		// 验证密码
		if player.Password != result.password {
			utils.ErrorResponse(w, http.StatusUnauthorized, "密码错误", nil)
			return
		}

		// 更新最后活跃时间
		if err := database.UpdatePlayerLastActive(ctx, result.playerID, ip); err != nil {
			slog.Error("更新最后活跃时间失败", "playerId", result.playerID, "error", err)
		}

		// 将玩家ID和密码存入上下文
		newCtx := context.WithValue(ctx, PlayerIDKey, result.playerID)
		newCtx = context.WithValue(newCtx, PlayerPasswordKey, result.password)

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

// ValidatePlayer 验证玩家凭证（不创建新玩家）
func ValidatePlayer(ctx context.Context, playerID, password string) (string, error) {
	// 验证 playerID 格式（必须是 UUID）
	if !utils.ValidatePlayerID(playerID) {
		return "", errors.New("无效的玩家ID格式")
	}

	// 查询玩家
	player, err := database.GetPlayerByID(ctx, playerID)
	if err != nil {
		return "", err
	}

	if player == nil || player.Password != password {
		return "", nil
	}

	return playerID, nil
}
