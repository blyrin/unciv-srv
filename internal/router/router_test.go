package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"unciv-srv/internal/config"
	"unciv-srv/internal/database"
	"unciv-srv/internal/middleware"
)

func TestSetup_ReturnsNonNil(t *testing.T) {
	cleanup, err := database.SetupTestDB()
	if err != nil {
		t.Fatalf("初始化测试数据库失败: %v", err)
	}
	defer cleanup()

	cfg := &config.Config{
		AdminUsername: "admin",
		AdminPassword: "admin123",
	}
	rl := middleware.NewRateLimiter(5, 5*time.Minute)
	defer rl.Close()

	mux := Setup(cfg, rl)
	if mux == nil {
		t.Fatal("Setup 不应返回 nil")
	}
}

func TestIsAlive(t *testing.T) {
	cleanup, err := database.SetupTestDB()
	if err != nil {
		t.Fatalf("初始化测试数据库失败: %v", err)
	}
	defer cleanup()

	cfg := &config.Config{
		AdminUsername: "admin",
		AdminPassword: "admin123",
	}
	rl := middleware.NewRateLimiter(5, 5*time.Minute)
	defer rl.Close()

	mux := Setup(cfg, rl)
	if mux == nil {
		t.Fatal("Setup 返回 nil")
	}

	r := httptest.NewRequest("GET", "/isalive", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}

	expected := `{"authVersion":1,"chatVersion":1}`
	if w.Body.String() != expected {
		t.Errorf("Body = %q, want %q", w.Body.String(), expected)
	}
}
