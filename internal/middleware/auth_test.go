package middleware

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"unciv-srv/internal/database"
)

func setupAuthTest(t *testing.T) {
	t.Helper()
	cleanup, err := database.SetupTestDB()
	if err != nil {
		t.Fatalf("初始化测试数据库失败: %v", err)
	}
	t.Cleanup(cleanup)
}

func basicAuthHeader(userID, password string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(userID+":"+password))
}

const (
	authTestPlayerID = "00000000-0000-0000-0000-000000000001"
	authTestPassword = "testpass123"
)

func TestBasicAuthWithRegister_NoHeader(t *testing.T) {
	setupAuthTest(t)

	handler := BasicAuthWithRegister(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("不应到达内部 handler")
	}))

	r := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestBasicAuthWithRegister_InvalidFormat(t *testing.T) {
	setupAuthTest(t)

	handler := BasicAuthWithRegister(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("不应到达内部 handler")
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer token123")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestBasicAuthWithRegister_InvalidPlayerID(t *testing.T) {
	setupAuthTest(t)

	handler := BasicAuthWithRegister(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("不应到达内部 handler")
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", basicAuthHeader("not-a-uuid", authTestPassword))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestBasicAuthWithRegister_ShortPassword(t *testing.T) {
	setupAuthTest(t)

	handler := BasicAuthWithRegister(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("不应到达内部 handler")
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", basicAuthHeader(authTestPlayerID, "12345"))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestBasicAuthWithRegister_AutoRegister(t *testing.T) {
	setupAuthTest(t)

	called := false
	handler := BasicAuthWithRegister(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		playerID := GetPlayerID(r)
		if playerID != authTestPlayerID {
			t.Errorf("PlayerID = %q, want %q", playerID, authTestPlayerID)
		}
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", basicAuthHeader(authTestPlayerID, authTestPassword))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if !called {
		t.Error("handler 应被调用（自动注册）")
	}

	// 验证玩家已创建
	player, _ := database.GetPlayerByID(context.Background(), authTestPlayerID)
	if player == nil {
		t.Error("玩家应已被创建")
	}
}

func TestBasicAuthWithRegister_ExistingPlayer_CorrectPassword(t *testing.T) {
	setupAuthTest(t)

	database.CreatePlayer(context.Background(), authTestPlayerID, authTestPassword, "127.0.0.1")

	called := false
	handler := BasicAuthWithRegister(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", basicAuthHeader(authTestPlayerID, authTestPassword))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if !called {
		t.Error("handler 应被调用")
	}
}

func TestBasicAuthWithRegister_ExistingPlayer_WrongPassword(t *testing.T) {
	setupAuthTest(t)

	database.CreatePlayer(context.Background(), authTestPlayerID, authTestPassword, "127.0.0.1")

	handler := BasicAuthWithRegister(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("密码错误不应到达内部 handler")
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", basicAuthHeader(authTestPlayerID, "wrongpassword"))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestBasicAuth_NotRegistered(t *testing.T) {
	setupAuthTest(t)

	handler := BasicAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("不存在的玩家不应到达内部 handler")
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", basicAuthHeader(authTestPlayerID, authTestPassword))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestBasicAuth_ExistingPlayer(t *testing.T) {
	setupAuthTest(t)

	database.CreatePlayer(context.Background(), authTestPlayerID, authTestPassword, "127.0.0.1")

	called := false
	handler := BasicAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", basicAuthHeader(authTestPlayerID, authTestPassword))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if !called {
		t.Error("handler 应被调用")
	}
}

func TestBasicAuth_InvalidBase64(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Basic !!!")
	w := httptest.NewRecorder()

	BasicAuth(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("不应进入内部 handler")
	})).ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestBasicAuth_InvalidPair(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("invalidpair")))
	w := httptest.NewRecorder()

	BasicAuth(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("不应进入内部 handler")
	})).ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestBasicAuth_DatabaseError(t *testing.T) {
	setupAuthTest(t)

	if err := database.DB.Close(); err != nil {
		t.Fatalf("关闭数据库失败: %v", err)
	}

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(authTestPlayerID+":"+authTestPassword)))
	w := httptest.NewRecorder()

	BasicAuth(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("不应进入内部 handler")
	})).ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("状态码 = %d, want %d", w.Code, http.StatusInternalServerError)
	}
}

func TestValidatePlayer_Valid(t *testing.T) {
	setupAuthTest(t)

	database.CreatePlayer(context.Background(), authTestPlayerID, authTestPassword, "127.0.0.1")

	id, err := ValidatePlayer(context.Background(), authTestPlayerID, authTestPassword)
	if err != nil {
		t.Fatalf("ValidatePlayer 失败: %v", err)
	}
	if id != authTestPlayerID {
		t.Errorf("返回 ID = %q, want %q", id, authTestPlayerID)
	}
}

func TestValidatePlayer_WrongPassword(t *testing.T) {
	setupAuthTest(t)

	database.CreatePlayer(context.Background(), authTestPlayerID, authTestPassword, "127.0.0.1")

	id, err := ValidatePlayer(context.Background(), authTestPlayerID, "wrong")
	if err != nil {
		t.Fatalf("ValidatePlayer 不应返回错误: %v", err)
	}
	if id != "" {
		t.Errorf("密码错误应返回空 ID, got %q", id)
	}
}

func TestValidatePlayer_InvalidUUID(t *testing.T) {
	_, err := ValidatePlayer(context.Background(), "not-a-uuid", "pass")
	if err == nil {
		t.Error("无效 UUID 应返回错误")
	}
}

func TestGetPlayerID_Empty(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	if got := GetPlayerID(r); got != "" {
		t.Errorf("GetPlayerID = %q, want empty", got)
	}
}
