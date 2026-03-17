package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestValidateGameID_NonUncivUA(t *testing.T) {
	handler := ValidateGameID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("非 Unciv UA 不应到达内部 handler")
	}))

	r := httptest.NewRequest("GET", "/files/12345678-1234-1234-1234-123456789012", nil)
	r.Header.Set("User-Agent", "Mozilla/5.0")
	r.SetPathValue("gameId", "12345678-1234-1234-1234-123456789012")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusForbidden {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusForbidden)
	}
}

func TestValidateGameID_EmptyGameID(t *testing.T) {
	handler := ValidateGameID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("空 gameId 不应到达内部 handler")
	}))

	r := httptest.NewRequest("GET", "/files/", nil)
	r.Header.Set("User-Agent", "Unciv/4.0")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestValidateGameID_InvalidFormat(t *testing.T) {
	handler := ValidateGameID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("无效格式不应到达内部 handler")
	}))

	r := httptest.NewRequest("GET", "/files/invalid-id", nil)
	r.Header.Set("User-Agent", "Unciv/4.0")
	r.SetPathValue("gameId", "invalid-id")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestValidateGameID_ValidUUID(t *testing.T) {
	called := false
	handler := ValidateGameID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		gameID := GetGameID(r)
		if gameID != "12345678-1234-1234-1234-123456789012" {
			t.Errorf("GameID = %q", gameID)
		}
		if IsPreview(r) {
			t.Error("不应为预览模式")
		}
	}))

	r := httptest.NewRequest("GET", "/files/12345678-1234-1234-1234-123456789012", nil)
	r.Header.Set("User-Agent", "Unciv/4.0")
	r.SetPathValue("gameId", "12345678-1234-1234-1234-123456789012")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if !called {
		t.Error("handler 应被调用")
	}
}

func TestValidateGameID_PreviewID(t *testing.T) {
	called := false
	handler := ValidateGameID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		gameID := GetGameID(r)
		if gameID != "12345678-1234-1234-1234-123456789012" {
			t.Errorf("GameID 应去除后缀: %q", gameID)
		}
		if !IsPreview(r) {
			t.Error("应为预览模式")
		}
	}))

	r := httptest.NewRequest("GET", "/files/12345678-1234-1234-1234-123456789012_Preview", nil)
	r.Header.Set("User-Agent", "Unciv/4.0")
	r.SetPathValue("gameId", "12345678-1234-1234-1234-123456789012_Preview")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if !called {
		t.Error("handler 应被调用")
	}
}

func TestGetGameID_Empty(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	if got := GetGameID(r); got != "" {
		t.Errorf("GetGameID = %q, want empty", got)
	}
}

func TestIsPreview_Default(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	if IsPreview(r) {
		t.Error("默认应为 false")
	}
}
