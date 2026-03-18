package router

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestSetup_KeyRoutes(t *testing.T) {
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

	if err := database.CreatePlayer(context.Background(), "00000000-0000-0000-0000-000000000001", "password123", "127.0.0.1"); err != nil {
		t.Fatalf("CreatePlayer 失败: %v", err)
	}

	mux := Setup(cfg, rl)

	t.Run("根路径", func(t *testing.T) {
		r := httptest.NewRequest("GET", "/", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("状态码 = %d, want %d", w.Code, http.StatusOK)
		}
	})

	t.Run("auth 需要认证", func(t *testing.T) {
		r := httptest.NewRequest("GET", "/auth", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
		}
	})

	t.Run("files 需要认证", func(t *testing.T) {
		r := httptest.NewRequest("GET", "/files/11111111-1111-1111-1111-111111111111", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("状态码 = %d, want %d", w.Code, http.StatusForbidden)
		}
	})

	t.Run("login 请求格式错误", func(t *testing.T) {
		r := httptest.NewRequest("POST", "/api/login", strings.NewReader("{"))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
		}
	})

	t.Run("chat 需要认证", func(t *testing.T) {
		r := httptest.NewRequest("GET", "/chat", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
		}
	})

	t.Run("auth 成功", func(t *testing.T) {
		r := httptest.NewRequest("GET", "/auth", nil)
		r.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("00000000-0000-0000-0000-000000000001:password123")))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != http.StatusNoContent {
			t.Fatalf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
		}
	})
}
