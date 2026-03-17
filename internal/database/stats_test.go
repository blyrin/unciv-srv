package database

import (
	"context"
	"encoding/json"
	"testing"
)

func TestGetAllStats_EmptyDB(t *testing.T) {
	setupTest(t)

	stats, err := GetAllStats(context.Background())
	if err != nil {
		t.Fatalf("GetAllStats 失败: %v", err)
	}
	if stats == nil {
		t.Fatal("stats 不应为 nil")
	}
	if stats.PlayerCount != 0 {
		t.Errorf("PlayerCount = %d, want 0", stats.PlayerCount)
	}
	if stats.GameCount != 0 {
		t.Errorf("GameCount = %d, want 0", stats.GameCount)
	}
	if stats.TotalSaves != 0 {
		t.Errorf("TotalSaves = %d, want 0", stats.TotalSaves)
	}
}

func TestGetAllStats_WithData(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedPlayer(t, testPlayerID2, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1, testPlayerID2})

	seedFileContent(t, testGameID1, 1, testPlayerID1, json.RawMessage(`{"turns":1}`))
	seedFileContent(t, testGameID1, 5, testPlayerID2, json.RawMessage(`{"turns":5}`))

	stats, err := GetAllStats(ctx)
	if err != nil {
		t.Fatalf("GetAllStats 失败: %v", err)
	}

	if stats.PlayerCount != 2 {
		t.Errorf("PlayerCount = %d, want 2", stats.PlayerCount)
	}
	if stats.GameCount != 1 {
		t.Errorf("GameCount = %d, want 1", stats.GameCount)
	}
	if stats.TotalSaves != 2 {
		t.Errorf("TotalSaves = %d, want 2", stats.TotalSaves)
	}
	if stats.MaxGameTurns != 5 {
		t.Errorf("MaxGameTurns = %d, want 5", stats.MaxGameTurns)
	}
}
