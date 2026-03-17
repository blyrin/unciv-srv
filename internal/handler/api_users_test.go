package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"unciv-srv/internal/database"
)

func TestGetUserGames(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})

	r := httptest.NewRequest("GET", "/api/users/games", nil)
	r = withSession(r, testPlayerID1, false)
	w := httptest.NewRecorder()
	GetUserGames(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}

	var resp UserGamesResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.PlayerID != testPlayerID1 {
		t.Errorf("PlayerID = %q, want %q", resp.PlayerID, testPlayerID1)
	}
	if len(resp.Games) != 1 {
		t.Errorf("游戏数量 = %d, want 1", len(resp.Games))
	}
}

func TestGetUserGames_NotLoggedIn(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/users/games", nil)
	w := httptest.NewRecorder()
	GetUserGames(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestGetUserStats(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})

	r := httptest.NewRequest("GET", "/api/users/stats", nil)
	r = withSession(r, testPlayerID1, false)
	w := httptest.NewRecorder()
	GetUserStats(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}

	var result map[string]int
	json.NewDecoder(w.Body).Decode(&result)
	if result["gameCount"] != 1 {
		t.Errorf("gameCount = %d, want 1", result["gameCount"])
	}
}

func TestGetUserStats_NotLoggedIn(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/users/stats", nil)
	w := httptest.NewRecorder()
	GetUserStats(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestGetStats_Admin(t *testing.T) {
	setupHandlerTest(t)

	r := httptest.NewRequest("GET", "/api/stats", nil)
	w := httptest.NewRecorder()
	GetStats(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestUpdateUserPassword_Success(t *testing.T) {
	setupHandlerTest(t)

	database.CreatePlayer(context.Background(), testPlayerID1, testPassword, "127.0.0.1")

	body := `{"oldPassword":"` + testPassword + `","newPassword":"newpass123"}`
	r := httptest.NewRequest("PUT", "/api/users/password", strings.NewReader(body))
	r = withSession(r, testPlayerID1, false)
	w := httptest.NewRecorder()
	UpdateUserPassword(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}

	// 验证密码已更新
	pwd, _ := database.GetPlayerPassword(context.Background(), testPlayerID1)
	if pwd != "newpass123" {
		t.Errorf("密码未更新: %q", pwd)
	}
}

func TestUpdateUserPassword_WrongOld(t *testing.T) {
	setupHandlerTest(t)

	database.CreatePlayer(context.Background(), testPlayerID1, testPassword, "127.0.0.1")

	body := `{"oldPassword":"wrong","newPassword":"newpass123"}`
	r := httptest.NewRequest("PUT", "/api/users/password", strings.NewReader(body))
	r = withSession(r, testPlayerID1, false)
	w := httptest.NewRecorder()
	UpdateUserPassword(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestUpdateUserPassword_TooShort(t *testing.T) {
	setupHandlerTest(t)

	body := `{"oldPassword":"old","newPassword":"12345"}`
	r := httptest.NewRequest("PUT", "/api/users/password", strings.NewReader(body))
	r = withSession(r, testPlayerID1, false)
	w := httptest.NewRecorder()
	UpdateUserPassword(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestUpdateUserPassword_NotLoggedIn(t *testing.T) {
	body := `{"oldPassword":"old","newPassword":"newpass123"}`
	r := httptest.NewRequest("PUT", "/api/users/password", strings.NewReader(body))
	w := httptest.NewRecorder()
	UpdateUserPassword(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}
