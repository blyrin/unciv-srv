package database

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

const (
	testPlayerID1 = "00000000-0000-0000-0000-000000000001"
	testPlayerID2 = "00000000-0000-0000-0000-000000000002"
	testPlayerID3 = "00000000-0000-0000-0000-000000000003"
	testGameID1   = "11111111-1111-1111-1111-111111111111"
	testGameID2   = "22222222-2222-2222-2222-222222222222"
	testGameID3   = "33333333-3333-3333-3333-333333333333"
	testPassword  = "testpass123"
	testIP        = "127.0.0.1"
)

func setupTest(t *testing.T) {
	t.Helper()
	cleanup, err := SetupTestDB()
	if err != nil {
		t.Fatalf("初始化测试数据库失败: %v", err)
	}
	t.Cleanup(cleanup)
}

func seedPlayer(t *testing.T, playerID, password string) {
	t.Helper()
	now := time.Now()
	_, err := DB.ExecContext(context.Background(), `
		INSERT INTO players (player_id, password, created_at, updated_at, create_ip, update_ip)
		VALUES (?, ?, ?, ?, ?, ?)
	`, playerID, password, now, now, testIP, testIP)
	if err != nil {
		t.Fatalf("seed player 失败: %v", err)
	}
}

func seedGame(t *testing.T, gameID string, playerIDs []string) {
	t.Helper()
	playersJSON, _ := json.Marshal(playerIDs)
	now := time.Now()
	_, err := DB.ExecContext(context.Background(), `
		INSERT INTO files (game_id, players, created_at, updated_at)
		VALUES (?, ?, ?, ?)
	`, gameID, playersJSON, now, now)
	if err != nil {
		t.Fatalf("seed game 失败: %v", err)
	}
}

func seedFileContent(t *testing.T, gameID string, turns int, playerID string, data json.RawMessage) {
	t.Helper()
	_, err := DB.ExecContext(context.Background(), `
		INSERT INTO files_content (game_id, turns, created_player, created_ip, created_at, data)
		VALUES (?, ?, ?, ?, ?, ?)
	`, gameID, turns, playerID, testIP, time.Now(), data)
	if err != nil {
		t.Fatalf("seed file content 失败: %v", err)
	}
}

func seedFilePreview(t *testing.T, gameID string, turns int, playerID string, data json.RawMessage) {
	t.Helper()
	_, err := DB.ExecContext(context.Background(), `
		INSERT INTO files_preview (game_id, turns, created_player, created_ip, created_at, data)
		VALUES (?, ?, ?, ?, ?, ?)
	`, gameID, turns, playerID, testIP, time.Now(), data)
	if err != nil {
		t.Fatalf("seed file preview 失败: %v", err)
	}
}
