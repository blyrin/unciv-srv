package middleware

import (
	"context"
	"net/http"
	"sync"
	"time"

	"unciv-srv/pkg/utils"

	"github.com/google/uuid"
)

const (
	// SessionCookieName Session Cookie 名称
	SessionCookieName = "session_id"
	// SessionDuration Session 有效期
	SessionDuration = 24 * time.Hour
	// SessionUserIDKey 用户ID上下文键
	SessionUserIDKey ContextKey = "sessionUserID"
	// SessionIsAdminKey 是否管理员上下文键
	SessionIsAdminKey ContextKey = "sessionIsAdmin"
)

// Session 会话结构
type Session struct {
	ID        string
	UserID    string
	IsAdmin   bool
	CreatedAt time.Time
	ExpiresAt time.Time
}

// SessionStore 会话存储
type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

var store = &SessionStore{
	sessions: make(map[string]*Session),
}

// CreateSession 创建新会话
func CreateSession(userID string, isAdmin bool) string {
	sessionID := uuid.New().String()
	now := time.Now()

	store.mu.Lock()
	defer store.mu.Unlock()

	store.sessions[sessionID] = &Session{
		ID:        sessionID,
		UserID:    userID,
		IsAdmin:   isAdmin,
		CreatedAt: now,
		ExpiresAt: now.Add(SessionDuration),
	}

	return sessionID
}

// GetSession 获取会话
func GetSession(sessionID string) (*Session, bool) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	session, exists := store.sessions[sessionID]
	if !exists {
		return nil, false
	}

	// 检查是否过期
	if time.Now().After(session.ExpiresAt) {
		return nil, false
	}

	return session, true
}

// DeleteSession 删除会话
func DeleteSession(sessionID string) {
	store.mu.Lock()
	defer store.mu.Unlock()

	delete(store.sessions, sessionID)
}

// CleanupExpiredSessions 清理过期会话
func CleanupExpiredSessions() {
	store.mu.Lock()
	defer store.mu.Unlock()

	now := time.Now()
	for id, session := range store.sessions {
		if now.After(session.ExpiresAt) {
			delete(store.sessions, id)
		}
	}
}

// SetSessionCookie 设置 Session Cookie
func SetSessionCookie(w http.ResponseWriter, sessionID string) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		MaxAge:   int(SessionDuration.Seconds()),
		SameSite: http.SameSiteLaxMode,
	})
}

// ClearSessionCookie 清除 Session Cookie
func ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

// SessionAuth Session 认证中间件
func SessionAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 获取 Session Cookie
		cookie, err := r.Cookie(SessionCookieName)
		if err != nil {
			utils.ErrorResponse(w, http.StatusUnauthorized, "未登录")
			return
		}

		// 获取 Session
		session, exists := GetSession(cookie.Value)
		if !exists {
			ClearSessionCookie(w)
			utils.ErrorResponse(w, http.StatusUnauthorized, "会话已过期")
			return
		}

		// 将用户信息存入上下文
		ctx := context.WithValue(r.Context(), SessionUserIDKey, session.UserID)
		ctx = context.WithValue(ctx, SessionIsAdminKey, session.IsAdmin)

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// AdminOnly 管理员权限中间件
// 复用 SessionAuth 进行认证，然后检查管理员权限
func AdminOnly(next http.Handler) http.Handler {
	return SessionAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 检查是否是管理员
		if !IsSessionAdmin(r) {
			utils.ErrorResponse(w, http.StatusForbidden, "需要管理员权限")
			return
		}

		next.ServeHTTP(w, r)
	}))
}

// GetSessionUserID 从上下文获取用户ID
func GetSessionUserID(r *http.Request) string {
	if v := r.Context().Value(SessionUserIDKey); v != nil {
		return v.(string)
	}
	return ""
}

// IsSessionAdmin 从上下文检查是否是管理员
func IsSessionAdmin(r *http.Request) bool {
	if v := r.Context().Value(SessionIsAdminKey); v != nil {
		return v.(bool)
	}
	return false
}
