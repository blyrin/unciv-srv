package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"unciv-srv/internal/database"
)

func TestGetAllGames(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})
	database.CreateGame(ctx, testGameID2, []string{testPlayerID1})

	r := httptest.NewRequest("GET", "/api/games", nil)
	r = withSession(r, "admin", true)
	w := httptest.NewRecorder()
	GetAllGames(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}

	var games []database.GameWithTurns
	json.NewDecoder(w.Body).Decode(&games)
	if len(games) != 2 {
		t.Errorf("游戏数量 = %d, want 2", len(games))
	}
}

func TestUpdateGame(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})

	body := `{"whitelist":true,"remark":"VIP"}`
	r := httptest.NewRequest("PUT", "/api/games/"+testGameID1, strings.NewReader(body))
	r.SetPathValue("gameId", testGameID1)
	w := httptest.NewRecorder()
	UpdateGame(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestUpdateGame_NoGameID(t *testing.T) {
	r := httptest.NewRequest("PUT", "/api/games/", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	UpdateGame(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestDeleteGame_Admin(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})

	r := httptest.NewRequest("DELETE", "/api/games/"+testGameID1, nil)
	r.SetPathValue("gameId", testGameID1)
	r = withSession(r, "admin", true)
	w := httptest.NewRecorder()
	DeleteGame(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestDeleteGame_Creator(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})
	database.SaveFileContent(ctx, testGameID1, 1, testPlayerID1, "127.0.0.1", json.RawMessage(`{"turns":1}`))

	r := httptest.NewRequest("DELETE", "/api/games/"+testGameID1, nil)
	r.SetPathValue("gameId", testGameID1)
	r = withSession(r, testPlayerID1, false)
	w := httptest.NewRecorder()
	DeleteGame(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestDeleteGame_NonCreator(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreatePlayer(ctx, testPlayerID2, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1, testPlayerID2})
	database.SaveFileContent(ctx, testGameID1, 1, testPlayerID1, "127.0.0.1", json.RawMessage(`{"turns":1}`))

	r := httptest.NewRequest("DELETE", "/api/games/"+testGameID1, nil)
	r.SetPathValue("gameId", testGameID1)
	r = withSession(r, testPlayerID2, false) // player2 不是创建者
	w := httptest.NewRecorder()
	DeleteGame(w, r)

	if w.Code != http.StatusForbidden {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusForbidden)
	}
}

func TestDeleteGame_NotFound(t *testing.T) {
	setupHandlerTest(t)

	r := httptest.NewRequest("DELETE", "/api/games/"+testGameID1, nil)
	r.SetPathValue("gameId", testGameID1)
	r = withSession(r, "admin", true)
	w := httptest.NewRecorder()
	DeleteGame(w, r)

	if w.Code != http.StatusNotFound {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestDownloadGameHistory(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})
	database.SaveFileContent(ctx, testGameID1, 1, testPlayerID1, "127.0.0.1", json.RawMessage(`{"turns":1}`))
	database.SaveFileContent(ctx, testGameID1, 2, testPlayerID1, "127.0.0.1", json.RawMessage(`{"turns":2}`))

	r := httptest.NewRequest("GET", "/api/games/"+testGameID1+"/download", nil)
	r.SetPathValue("gameId", testGameID1)
	r = withSession(r, "admin", true)
	w := httptest.NewRecorder()
	DownloadGameHistory(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}

	if ct := w.Header().Get("Content-Type"); ct != "application/zip" {
		t.Errorf("Content-Type = %q, want application/zip", ct)
	}

	// 验证 ZIP 内容
	reader, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatalf("解析 ZIP 失败: %v", err)
	}
	if len(reader.File) != 2 {
		t.Errorf("ZIP 文件数量 = %d, want 2", len(reader.File))
	}
}

func TestDownloadGameHistory_NotFound(t *testing.T) {
	setupHandlerTest(t)

	r := httptest.NewRequest("GET", "/api/games/"+testGameID1+"/download", nil)
	r.SetPathValue("gameId", testGameID1)
	r = withSession(r, "admin", true)
	w := httptest.NewRecorder()
	DownloadGameHistory(w, r)

	if w.Code != http.StatusNotFound {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestGetGameTurns(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})
	database.SaveFileContent(ctx, testGameID1, 1, testPlayerID1, "127.0.0.1", json.RawMessage(`{"turns":1}`))

	r := httptest.NewRequest("GET", "/api/games/"+testGameID1+"/turns", nil)
	r.SetPathValue("gameId", testGameID1)
	r = withSession(r, "admin", true)
	w := httptest.NewRecorder()
	GetGameTurns(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}

	var turns []database.TurnMetadata
	json.NewDecoder(w.Body).Decode(&turns)
	if len(turns) != 1 {
		t.Errorf("回合数量 = %d, want 1", len(turns))
	}
}

func TestGetGameTurns_PlayerForbidden(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreatePlayer(ctx, testPlayerID2, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})

	r := httptest.NewRequest("GET", "/api/games/"+testGameID1+"/turns", nil)
	r.SetPathValue("gameId", testGameID1)
	r = withSession(r, testPlayerID2, false) // player2 不在游戏中
	w := httptest.NewRecorder()
	GetGameTurns(w, r)

	if w.Code != http.StatusForbidden {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusForbidden)
	}
}

func TestDownloadSingleTurn(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})
	database.SaveFileContent(ctx, testGameID1, 5, testPlayerID1, "127.0.0.1", json.RawMessage(`{"turns":5}`))

	// 获取 turn ID
	metadata, _ := database.GetTurnsMetadata(ctx, testGameID1)
	turnID := fmt.Sprintf("%d", metadata[0].ID)

	r := httptest.NewRequest("GET", "/api/games/"+testGameID1+"/turns/"+turnID+"/download", nil)
	r.SetPathValue("gameId", testGameID1)
	r.SetPathValue("turnId", turnID)
	r = withSession(r, "admin", true)
	w := httptest.NewRecorder()
	DownloadSingleTurn(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}

func TestDownloadSingleTurn_InvalidTurnID(t *testing.T) {
	setupHandlerTest(t)

	r := httptest.NewRequest("GET", "/api/games/"+testGameID1+"/turns/abc/download", nil)
	r.SetPathValue("gameId", testGameID1)
	r.SetPathValue("turnId", "abc")
	r = withSession(r, "admin", true)
	w := httptest.NewRecorder()
	DownloadSingleTurn(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestBatchUpdateGames(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})
	database.CreateGame(ctx, testGameID2, []string{testPlayerID1})

	body := `{"gameIds":["` + testGameID1 + `","` + testGameID2 + `"],"whitelist":true}`
	r := httptest.NewRequest("PATCH", "/api/games/batch", strings.NewReader(body))
	w := httptest.NewRecorder()
	BatchUpdateGames(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestBatchUpdateGames_EmptyList(t *testing.T) {
	body := `{"gameIds":[],"whitelist":true}`
	r := httptest.NewRequest("PATCH", "/api/games/batch", strings.NewReader(body))
	w := httptest.NewRecorder()
	BatchUpdateGames(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestBatchDeleteGames(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})
	database.CreateGame(ctx, testGameID2, []string{testPlayerID1})

	body := `{"gameIds":["` + testGameID1 + `","` + testGameID2 + `"]}`
	r := httptest.NewRequest("DELETE", "/api/games/batch", strings.NewReader(body))
	w := httptest.NewRecorder()
	BatchDeleteGames(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestBatchDeleteGames_EmptyList(t *testing.T) {
	body := `{"gameIds":[]}`
	r := httptest.NewRequest("DELETE", "/api/games/batch", strings.NewReader(body))
	w := httptest.NewRecorder()
	BatchDeleteGames(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}
