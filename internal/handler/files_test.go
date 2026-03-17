package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"unciv-srv/internal/database"
	"unciv-srv/pkg/utils"
)

func TestGetFile_NotFound(t *testing.T) {
	setupHandlerTest(t)

	r := httptest.NewRequest("GET", "/files/"+testGameID1, nil)
	r = withGameID(r, testGameID1, false)
	w := httptest.NewRecorder()
	GetFile(w, r)

	if w.Code != http.StatusNotFound {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestGetFile_Content(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})

	originalData := json.RawMessage(`{"gameId":"` + testGameID1 + `","turns":5}`)
	database.SaveFileContent(ctx, testGameID1, 5, testPlayerID1, "127.0.0.1", originalData)

	r := httptest.NewRequest("GET", "/files/"+testGameID1, nil)
	r = withGameID(r, testGameID1, false)
	w := httptest.NewRecorder()
	GetFile(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}

	// 验证返回的编码数据可以解码
	decoded, err := utils.DecodeFile(w.Body.String())
	if err != nil {
		t.Fatalf("返回数据解码失败: %v", err)
	}
	if decoded == nil {
		t.Error("解码结果不应为 nil")
	}
}

func TestGetFile_Preview(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})
	database.SaveFilePreview(ctx, testGameID1, 3, testPlayerID1, "127.0.0.1", json.RawMessage(`{"preview":true}`))

	r := httptest.NewRequest("GET", "/files/"+testGameID1+"_Preview", nil)
	r = withGameID(r, testGameID1, true)
	w := httptest.NewRecorder()
	GetFile(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestPutFile_EmptyBody(t *testing.T) {
	setupHandlerTest(t)

	r := httptest.NewRequest("PUT", "/files/"+testGameID1, strings.NewReader(""))
	r = withPlayerID(r, testPlayerID1)
	r = withGameID(r, testGameID1, false)
	w := httptest.NewRecorder()
	PutFile(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestPutFile_InvalidEncoding(t *testing.T) {
	setupHandlerTest(t)

	r := httptest.NewRequest("PUT", "/files/"+testGameID1, strings.NewReader("not-valid-base64-gzip"))
	r = withPlayerID(r, testPlayerID1)
	r = withGameID(r, testGameID1, false)
	w := httptest.NewRecorder()
	PutFile(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestPutFile_GameIDMismatch(t *testing.T) {
	setupHandlerTest(t)

	// 编码的数据中 gameID 与 URL 不匹配
	encoded := buildGameData("other-game-id", 1, []string{testPlayerID1})

	r := httptest.NewRequest("PUT", "/files/"+testGameID1, strings.NewReader(encoded))
	r = withPlayerID(r, testPlayerID1)
	r = withGameID(r, testGameID1, false)
	w := httptest.NewRecorder()
	PutFile(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestPutFile_PlayerNotInGame(t *testing.T) {
	setupHandlerTest(t)

	encoded := buildGameData(testGameID1, 1, []string{testPlayerID2})

	r := httptest.NewRequest("PUT", "/files/"+testGameID1, strings.NewReader(encoded))
	r = withPlayerID(r, testPlayerID1) // player1 不在 playerIDs 中
	r = withGameID(r, testGameID1, false)
	w := httptest.NewRecorder()
	PutFile(w, r)

	if w.Code != http.StatusForbidden {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusForbidden)
	}
}

func TestPutFile_NewGame(t *testing.T) {
	setupHandlerTest(t)

	database.CreatePlayer(context.Background(), testPlayerID1, testPassword, "127.0.0.1")

	encoded := buildGameData(testGameID1, 1, []string{testPlayerID1})

	r := httptest.NewRequest("PUT", "/files/"+testGameID1, strings.NewReader(encoded))
	r = withPlayerID(r, testPlayerID1)
	r = withGameID(r, testGameID1, false)
	w := httptest.NewRecorder()
	PutFile(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}

	// 验证游戏已创建
	game, _ := database.GetGameByID(context.Background(), testGameID1)
	if game == nil {
		t.Error("游戏应已创建")
	}
}

func TestPutFile_ExistingGame(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})

	encoded := buildGameData(testGameID1, 5, []string{testPlayerID1})

	r := httptest.NewRequest("PUT", "/files/"+testGameID1, strings.NewReader(encoded))
	r = withPlayerID(r, testPlayerID1)
	r = withGameID(r, testGameID1, false)
	w := httptest.NewRecorder()
	PutFile(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestPutFile_ExistingGame_PlayerNotInDB(t *testing.T) {
	setupHandlerTest(t)
	ctx := context.Background()

	database.CreatePlayer(ctx, testPlayerID1, testPassword, "127.0.0.1")
	database.CreatePlayer(ctx, testPlayerID2, testPassword, "127.0.0.1")
	database.CreateGame(ctx, testGameID1, []string{testPlayerID1})

	// player2 在游戏数据中但不在数据库的 game.Players 中
	encoded := buildGameData(testGameID1, 5, []string{testPlayerID1, testPlayerID2})

	r := httptest.NewRequest("PUT", "/files/"+testGameID1, strings.NewReader(encoded))
	r = withPlayerID(r, testPlayerID2) // player2 不在 game.Players 中
	r = withGameID(r, testGameID1, false)
	w := httptest.NewRecorder()
	PutFile(w, r)

	if w.Code != http.StatusForbidden {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusForbidden)
	}
}
