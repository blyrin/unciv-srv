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

func TestGetAllPlayers(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreatePlayer(ctx, testPlayerID2, testPassword, "127.0.0.1")

	r := httptest.NewRequest("GET", "/api/players", nil)
	w := httptest.NewRecorder()
	GetAllPlayers(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}

	var result database.PageResult[database.Player]
	json.NewDecoder(w.Body).Decode(&result)
	if len(result.Items) != 2 {
		t.Errorf("玩家数量 = %d, want 2", len(result.Items))
	}
	if result.Total != 2 {
		t.Errorf("Total = %d, want 2", result.Total)
	}

	// 密码应被清除
	for _, p := range result.Items {
		if p.Password != "" {
			t.Error("密码字段应被清除")
		}
	}
}

func TestUpdatePlayer(t *testing.T) {
	setupHandlerTest(t)

	database.CreatePlayer(context.Background(), testPlayerID1, testPassword, "127.0.0.1")

	body := `{"whitelist":true,"remark":"测试"}`
	r := httptest.NewRequest("PUT", "/api/players/"+testPlayerID1, strings.NewReader(body))
	r.SetPathValue("playerId", testPlayerID1)
	w := httptest.NewRecorder()
	UpdatePlayer(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestUpdatePlayer_NoPlayerID(t *testing.T) {
	r := httptest.NewRequest("PUT", "/api/players/", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	UpdatePlayer(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestGetPlayerPassword(t *testing.T) {
	setupHandlerTest(t)

	database.CreatePlayer(context.Background(), testPlayerID1, testPassword, "127.0.0.1")

	r := httptest.NewRequest("GET", "/api/players/"+testPlayerID1+"/password", nil)
	r.SetPathValue("playerId", testPlayerID1)
	w := httptest.NewRecorder()
	GetPlayerPassword(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}

	var result map[string]string
	json.NewDecoder(w.Body).Decode(&result)
	if result["password"] != testPassword {
		t.Errorf("password = %q, want %q", result["password"], testPassword)
	}
}

func TestGetPlayerPassword_NotFound(t *testing.T) {
	setupHandlerTest(t)

	r := httptest.NewRequest("GET", "/api/players/nonexistent/password", nil)
	r.SetPathValue("playerId", "nonexistent")
	w := httptest.NewRecorder()
	GetPlayerPassword(w, r)

	if w.Code != http.StatusNotFound {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestUpdatePlayerPassword(t *testing.T) {
	setupHandlerTest(t)

	database.CreatePlayer(context.Background(), testPlayerID1, testPassword, "127.0.0.1")

	body := `{"password":"newpass123"}`
	r := httptest.NewRequest("PUT", "/api/players/"+testPlayerID1+"/password", strings.NewReader(body))
	r.SetPathValue("playerId", testPlayerID1)
	w := httptest.NewRecorder()
	UpdatePlayerPassword(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestUpdatePlayerPassword_TooShort(t *testing.T) {
	setupHandlerTest(t)

	body := `{"password":"12345"}`
	r := httptest.NewRequest("PUT", "/api/players/"+testPlayerID1+"/password", strings.NewReader(body))
	r.SetPathValue("playerId", testPlayerID1)
	w := httptest.NewRecorder()
	UpdatePlayerPassword(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestBatchUpdatePlayers(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreatePlayer(ctx, testPlayerID2, testPassword, "127.0.0.1")

	body := `{"playerIds":["` + testPlayerID1 + `","` + testPlayerID2 + `"],"whitelist":true}`
	r := httptest.NewRequest("PATCH", "/api/players/batch", strings.NewReader(body))
	w := httptest.NewRecorder()
	BatchUpdatePlayers(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestBatchUpdatePlayers_EmptyList(t *testing.T) {
	body := `{"playerIds":[],"whitelist":true}`
	r := httptest.NewRequest("PATCH", "/api/players/batch", strings.NewReader(body))
	w := httptest.NewRecorder()
	BatchUpdatePlayers(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}
