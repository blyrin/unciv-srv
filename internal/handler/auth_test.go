package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"unciv-srv/internal/database"
)

func setupHandlerTest(t *testing.T) {
	t.Helper()
	cleanup, err := database.SetupTestDB()
	if err != nil {
		t.Fatalf("初始化测试数据库失败: %v", err)
	}
	t.Cleanup(cleanup)
}

func TestGetAuth(t *testing.T) {
	r := httptest.NewRequest("GET", "/auth", nil)
	w := httptest.NewRecorder()
	GetAuth(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestPutAuth_EmptyBody(t *testing.T) {
	setupHandlerTest(t)

	r := httptest.NewRequest("PUT", "/auth", strings.NewReader(""))
	r = withPlayerID(r, testPlayerID1)
	w := httptest.NewRecorder()
	PutAuth(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestPutAuth_Success(t *testing.T) {
	setupHandlerTest(t)

	database.CreatePlayer(r_ctx(), testPlayerID1, testPassword, "127.0.0.1")

	r := httptest.NewRequest("PUT", "/auth", strings.NewReader("newpassword"))
	r = withPlayerID(r, testPlayerID1)
	w := httptest.NewRecorder()
	PutAuth(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}

	// 验证密码已更新
	pwd, _ := database.GetPlayerPassword(r_ctx(), testPlayerID1)
	if pwd != "newpassword" {
		t.Errorf("密码未更新: %q", pwd)
	}
}

func TestPutAuth_NoPlayerID(t *testing.T) {
	r := httptest.NewRequest("PUT", "/auth", strings.NewReader("newpassword"))
	w := httptest.NewRecorder()
	PutAuth(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func r_ctx() context.Context {
	return context.Background()
}
