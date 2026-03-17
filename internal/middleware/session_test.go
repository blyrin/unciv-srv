package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func clearSessionStore() {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.sessions = make(map[string]*Session)
}

func TestCreateAndGetSession(t *testing.T) {
	clearSessionStore()

	sessionID := CreateSession("user1", false)
	if sessionID == "" {
		t.Fatal("sessionID 不应为空")
	}

	session, exists := GetSession(sessionID)
	if !exists {
		t.Fatal("session 应存在")
	}
	if session.UserID != "user1" {
		t.Errorf("UserID = %q, want %q", session.UserID, "user1")
	}
	if session.IsAdmin {
		t.Error("IsAdmin 应为 false")
	}
}

func TestGetSession_NotFound(t *testing.T) {
	clearSessionStore()

	_, exists := GetSession("nonexistent")
	if exists {
		t.Error("不存在的 session 应返回 false")
	}
}

func TestGetSession_Expired(t *testing.T) {
	clearSessionStore()

	// 直接创建一个过期的 session
	store.mu.Lock()
	store.sessions["expired"] = &Session{
		ID:        "expired",
		UserID:    "user",
		ExpiresAt: time.Now().Add(-time.Hour),
	}
	store.mu.Unlock()

	_, exists := GetSession("expired")
	if exists {
		t.Error("过期的 session 应返回 false")
	}
}

func TestDeleteSession(t *testing.T) {
	clearSessionStore()

	sessionID := CreateSession("user1", false)
	DeleteSession(sessionID)

	_, exists := GetSession(sessionID)
	if exists {
		t.Error("删除后 session 不应存在")
	}
}

func TestCleanupExpiredSessions(t *testing.T) {
	clearSessionStore()

	// 创建一个正常和一个过期的
	CreateSession("normal", false)
	store.mu.Lock()
	store.sessions["expired"] = &Session{
		ID:        "expired",
		UserID:    "old",
		ExpiresAt: time.Now().Add(-time.Hour),
	}
	store.mu.Unlock()

	CleanupExpiredSessions()

	store.mu.RLock()
	count := len(store.sessions)
	store.mu.RUnlock()

	if count != 1 {
		t.Errorf("清理后应剩 1 个 session, got %d", count)
	}
}

func TestSetSessionCookie(t *testing.T) {
	w := httptest.NewRecorder()
	SetSessionCookie(w, "test-session-id")

	cookies := w.Result().Cookies()
	found := false
	for _, c := range cookies {
		if c.Name == SessionCookieName {
			found = true
			if c.Value != "test-session-id" {
				t.Errorf("Cookie Value = %q, want %q", c.Value, "test-session-id")
			}
			if !c.HttpOnly {
				t.Error("Cookie 应为 HttpOnly")
			}
		}
	}
	if !found {
		t.Error("未找到 session cookie")
	}
}

func TestClearSessionCookie(t *testing.T) {
	w := httptest.NewRecorder()
	ClearSessionCookie(w)

	cookies := w.Result().Cookies()
	for _, c := range cookies {
		if c.Name == SessionCookieName {
			if c.MaxAge != -1 {
				t.Errorf("MaxAge = %d, want -1", c.MaxAge)
			}
			return
		}
	}
	t.Error("未找到清除的 cookie")
}

func TestSessionAuth_NoCookie(t *testing.T) {
	clearSessionStore()

	handler := SessionAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("不应到达内部 handler")
	}))

	r := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestSessionAuth_ValidSession(t *testing.T) {
	clearSessionStore()
	sessionID := CreateSession("user1", true)

	called := false
	handler := SessionAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		userID := GetSessionUserID(r)
		if userID != "user1" {
			t.Errorf("UserID = %q, want %q", userID, "user1")
		}
		if !IsSessionAdmin(r) {
			t.Error("应为管理员")
		}
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: sessionID})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if !called {
		t.Error("内部 handler 应被调用")
	}
}

func TestSessionAuth_ExpiredSession(t *testing.T) {
	clearSessionStore()

	store.mu.Lock()
	store.sessions["expired"] = &Session{
		ID:        "expired",
		UserID:    "user",
		ExpiresAt: time.Now().Add(-time.Hour),
	}
	store.mu.Unlock()

	handler := SessionAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("不应到达内部 handler")
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "expired"})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestAdminOnly_Admin(t *testing.T) {
	clearSessionStore()
	sessionID := CreateSession("admin", true)

	called := false
	handler := AdminOnly(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: sessionID})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if !called {
		t.Error("管理员应能访问")
	}
}

func TestAdminOnly_NonAdmin(t *testing.T) {
	clearSessionStore()
	sessionID := CreateSession("player", false)

	handler := AdminOnly(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("非管理员不应到达内部 handler")
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: sessionID})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusForbidden {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusForbidden)
	}
}

func TestGetSessionUserID_Empty(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	if got := GetSessionUserID(r); got != "" {
		t.Errorf("GetSessionUserID = %q, want empty", got)
	}
}

func TestIsSessionAdmin_Default(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	if IsSessionAdmin(r) {
		t.Error("默认应为 false")
	}
}
