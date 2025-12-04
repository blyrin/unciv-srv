package handler

import (
	"encoding/json"
	"net/http"

	"unciv-srv/internal/config"
	"unciv-srv/internal/database"
	"unciv-srv/internal/middleware"
	"unciv-srv/pkg/utils"
)

// LoginRequest 登录请求
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// LoginResponse 登录响应
type LoginResponse struct {
	Success  bool   `json:"success"`
	Message  string `json:"message,omitempty"`
	IsAdmin  bool   `json:"isAdmin,omitempty"`
	PlayerID string `json:"playerId,omitempty"`
}

// LoginHandler 登录处理器配置
type LoginHandler struct {
	Config      *config.Config
	RateLimiter *middleware.RateLimiter
}

// Login 处理 POST /api/login
func (h *LoginHandler) Login(w http.ResponseWriter, r *http.Request) {
	ip := utils.GetClientIP(r)

	// 检查是否被限流
	if h.RateLimiter.IsLocked(ip) {
		remaining := h.RateLimiter.GetLockRemainingTime(ip)
		utils.JSONResponse(w, http.StatusTooManyRequests, LoginResponse{
			Success: false,
			Message: "请求过于频繁，请 " + remaining.String() + " 后再试",
		})
		return
	}

	// 解析请求
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.JSONResponse(w, http.StatusBadRequest, LoginResponse{
			Success: false,
			Message: "无效的请求格式",
		})
		return
	}

	// 验证管理员账户
	if req.Username == h.Config.AdminUsername {
		if req.Password == h.Config.AdminPassword {
			// 登录成功，重置限流
			h.RateLimiter.ResetAttempts(ip)

			// 创建 Session
			sessionID := middleware.CreateSession(req.Username, true)
			middleware.SetSessionCookie(w, sessionID)

			utils.JSONResponse(w, http.StatusOK, LoginResponse{
				Success: true,
				IsAdmin: true,
			})
			return
		}
	}

	// 验证玩家账户
	player, err := database.GetPlayerByID(r.Context(), req.Username)
	if err != nil {
		utils.JSONResponse(w, http.StatusInternalServerError, LoginResponse{
			Success: false,
			Message: "数据库错误",
		})
		return
	}

	if player != nil && player.Password == req.Password {
		// 登录成功，重置限流
		h.RateLimiter.ResetAttempts(ip)

		// 创建 Session
		sessionID := middleware.CreateSession(req.Username, false)
		middleware.SetSessionCookie(w, sessionID)

		utils.JSONResponse(w, http.StatusOK, LoginResponse{
			Success:  true,
			IsAdmin:  false,
			PlayerID: player.PlayerID,
		})
		return
	}

	// 登录失败，记录尝试
	if h.RateLimiter.RecordAttempt(ip) {
		utils.JSONResponse(w, http.StatusTooManyRequests, LoginResponse{
			Success: false,
			Message: "登录失败次数过多，请稍后再试",
		})
		return
	}

	remaining := h.RateLimiter.GetRemainingAttempts(ip)
	utils.JSONResponse(w, http.StatusUnauthorized, LoginResponse{
		Success: false,
		Message: "用户名或密码错误，剩余尝试次数: " + string(rune('0'+remaining)),
	})
}

// Logout 处理 GET /api/logout
func Logout(w http.ResponseWriter, r *http.Request) {
	// 获取 Session Cookie
	cookie, err := r.Cookie(middleware.SessionCookieName)
	if err == nil {
		middleware.DeleteSession(cookie.Value)
	}

	// 清除 Cookie
	middleware.ClearSessionCookie(w)

	// 重定向到首页
	http.Redirect(w, r, "/", http.StatusFound)
}
