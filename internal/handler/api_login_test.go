package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"unciv-srv/internal/config"
	"unciv-srv/internal/database"
	"unciv-srv/internal/middleware"
)

func TestLogin_Admin(t *testing.T) {
	setupHandlerTest(t)

	cfg := &config.Config{
		AdminUsername: "admin",
		AdminPassword: "admin123",
	}
	rl := middleware.NewRateLimiter(5, 5*time.Minute)
	defer rl.Close()

	h := &LoginHandler{Config: cfg, RateLimiter: rl}

	body := `{"username":"admin","password":"admin123"}`
	r := httptest.NewRequest("POST", "/api/login", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.Login(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}

	var resp LoginSuccessResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if !resp.IsAdmin {
		t.Error("管理员登录应返回 isAdmin=true")
	}

	// 检查是否设置了 cookie
	cookies := w.Result().Cookies()
	found := false
	for _, c := range cookies {
		if c.Name == middleware.SessionCookieName {
			found = true
		}
	}
	if !found {
		t.Error("应设置 session cookie")
	}
}

func TestLogin_Player(t *testing.T) {
	setupHandlerTest(t)

	cfg := &config.Config{
		AdminUsername: "admin",
		AdminPassword: "admin123",
	}
	rl := middleware.NewRateLimiter(5, 5*time.Minute)
	defer rl.Close()

	database.CreatePlayer(context.Background(), testPlayerID1, testPassword, "127.0.0.1")

	h := &LoginHandler{Config: cfg, RateLimiter: rl}

	body := `{"username":"` + testPlayerID1 + `","password":"` + testPassword + `"}`
	r := httptest.NewRequest("POST", "/api/login", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.Login(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}

	var resp LoginSuccessResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.IsAdmin {
		t.Error("玩家登录不应返回 isAdmin=true")
	}
	if resp.PlayerID != testPlayerID1 {
		t.Errorf("PlayerID = %q, want %q", resp.PlayerID, testPlayerID1)
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	setupHandlerTest(t)

	cfg := &config.Config{
		AdminUsername: "admin",
		AdminPassword: "admin123",
	}
	rl := middleware.NewRateLimiter(5, 5*time.Minute)
	defer rl.Close()

	h := &LoginHandler{Config: cfg, RateLimiter: rl}

	body := `{"username":"admin","password":"wrong"}`
	r := httptest.NewRequest("POST", "/api/login", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.Login(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestLogin_RateLimited(t *testing.T) {
	setupHandlerTest(t)

	cfg := &config.Config{
		AdminUsername: "admin",
		AdminPassword: "admin123",
	}
	rl := middleware.NewRateLimiter(2, 5*time.Minute)
	defer rl.Close()

	h := &LoginHandler{Config: cfg, RateLimiter: rl}

	// 两次错误尝试
	for i := 0; i < 2; i++ {
		body := `{"username":"admin","password":"wrong"}`
		r := httptest.NewRequest("POST", "/api/login", strings.NewReader(body))
		r.RemoteAddr = "192.0.2.1:12345"
		w := httptest.NewRecorder()
		h.Login(w, r)
	}

	// 第三次应被限流
	body := `{"username":"admin","password":"admin123"}`
	r := httptest.NewRequest("POST", "/api/login", strings.NewReader(body))
	r.RemoteAddr = "192.0.2.1:12345"
	w := httptest.NewRecorder()
	h.Login(w, r)

	if w.Code != http.StatusTooManyRequests {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusTooManyRequests)
	}
}

func TestCheckSession_NoCookie(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/session", nil)
	w := httptest.NewRecorder()
	CheckSession(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}

	var resp CheckSessionResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.IsLoggedIn {
		t.Error("无 cookie 应返回 isLoggedIn=false")
	}
}

func TestCheckSession_ValidSession(t *testing.T) {
	sessionID := middleware.CreateSession("admin", true)

	r := httptest.NewRequest("GET", "/api/session", nil)
	r.AddCookie(&http.Cookie{Name: middleware.SessionCookieName, Value: sessionID})
	w := httptest.NewRecorder()
	CheckSession(w, r)

	var resp CheckSessionResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if !resp.IsLoggedIn {
		t.Error("有效 session 应返回 isLoggedIn=true")
	}
	if !resp.IsAdmin {
		t.Error("管理员 session 应返回 isAdmin=true")
	}
}

func TestCheckSession_InvalidSession(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/session", nil)
	r.AddCookie(&http.Cookie{Name: middleware.SessionCookieName, Value: "invalid"})
	w := httptest.NewRecorder()
	CheckSession(w, r)

	var resp CheckSessionResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.IsLoggedIn {
		t.Error("无效 session 应返回 isLoggedIn=false")
	}
}

func TestLogout(t *testing.T) {
	sessionID := middleware.CreateSession("user", false)

	r := httptest.NewRequest("GET", "/api/logout", nil)
	r.AddCookie(&http.Cookie{Name: middleware.SessionCookieName, Value: sessionID})
	w := httptest.NewRecorder()
	Logout(w, r)

	if w.Code != http.StatusFound {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusFound)
	}

	// 验证 session 已删除
	_, exists := middleware.GetSession(sessionID)
	if exists {
		t.Error("logout 后 session 应被删除")
	}

	// 验证 cookie 已清除
	cookies := w.Result().Cookies()
	for _, c := range cookies {
		if c.Name == middleware.SessionCookieName && c.MaxAge == -1 {
			return
		}
	}
	t.Error("应清除 session cookie")
}
