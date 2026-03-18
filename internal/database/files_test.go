package database

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestSaveAndGetLatestFileContent(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	data := json.RawMessage(`{"gameId":"test","turns":1}`)
	err := SaveFileContent(ctx, testGameID1, 1, testPlayerID1, testIP, data)
	if err != nil {
		t.Fatalf("SaveFileContent 失败: %v", err)
	}

	fc, err := GetLatestFileContent(ctx, testGameID1)
	if err != nil {
		t.Fatalf("GetLatestFileContent 失败: %v", err)
	}
	if fc == nil {
		t.Fatal("应返回文件内容")
	}
	if fc.GameID != testGameID1 {
		t.Errorf("GameID = %q, want %q", fc.GameID, testGameID1)
	}
	if fc.Turns != 1 {
		t.Errorf("Turns = %d, want 1", fc.Turns)
	}
}

func TestGetLatestFileContent_NotFound(t *testing.T) {
	setupTest(t)

	fc, err := GetLatestFileContent(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("GetLatestFileContent 失败: %v", err)
	}
	if fc != nil {
		t.Error("不存在的游戏应返回 nil")
	}
}

func TestGetLatestFileContent_ReturnsLatest(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	// 保存多个回合，最新回合应该被返回
	SaveFileContent(ctx, testGameID1, 1, testPlayerID1, testIP, json.RawMessage(`{"turns":1}`))
	time.Sleep(time.Millisecond)
	SaveFileContent(ctx, testGameID1, 5, testPlayerID1, testIP, json.RawMessage(`{"turns":5}`))
	time.Sleep(time.Millisecond)
	SaveFileContent(ctx, testGameID1, 3, testPlayerID1, testIP, json.RawMessage(`{"turns":3}`))

	fc, _ := GetLatestFileContent(ctx, testGameID1)
	if fc.Turns != 5 {
		t.Errorf("最新回合应为 5, got %d", fc.Turns)
	}
}

func TestSaveAndGetLatestFilePreview(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	data := json.RawMessage(`{"preview":true}`)
	err := SaveFilePreview(ctx, testGameID1, 1, testPlayerID1, testIP, data)
	if err != nil {
		t.Fatalf("SaveFilePreview 失败: %v", err)
	}

	fp, err := GetLatestFilePreview(ctx, testGameID1)
	if err != nil {
		t.Fatalf("GetLatestFilePreview 失败: %v", err)
	}
	if fp == nil {
		t.Fatal("应返回预览内容")
	}
	if fp.GameID != testGameID1 {
		t.Errorf("GameID = %q, want %q", fp.GameID, testGameID1)
	}
}

func TestGetLatestFilePreview_NotFound(t *testing.T) {
	setupTest(t)

	fp, err := GetLatestFilePreview(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("GetLatestFilePreview 失败: %v", err)
	}
	if fp != nil {
		t.Error("不存在的游戏应返回 nil")
	}
}

func TestGetAllTurnsForGame(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	SaveFileContent(ctx, testGameID1, 1, testPlayerID1, testIP, json.RawMessage(`{"turns":1}`))
	SaveFileContent(ctx, testGameID1, 2, testPlayerID1, testIP, json.RawMessage(`{"turns":2}`))
	SaveFileContent(ctx, testGameID1, 3, testPlayerID1, testIP, json.RawMessage(`{"turns":3}`))

	turns, err := GetAllTurnsForGame(ctx, testGameID1)
	if err != nil {
		t.Fatalf("GetAllTurnsForGame 失败: %v", err)
	}
	if len(turns) != 3 {
		t.Errorf("回合数量 = %d, want 3", len(turns))
	}
	// 应按 turns ASC 排序
	if turns[0].Turns != 1 || turns[2].Turns != 3 {
		t.Error("回合排序不正确")
	}
}

func TestGetTurnsMetadata(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	SaveFileContent(ctx, testGameID1, 1, testPlayerID1, testIP, json.RawMessage(`{"turns":1}`))
	SaveFileContent(ctx, testGameID1, 2, testPlayerID1, testIP, json.RawMessage(`{"turns":2}`))

	metadata, err := GetTurnsMetadata(ctx, testGameID1)
	if err != nil {
		t.Fatalf("GetTurnsMetadata 失败: %v", err)
	}
	if len(metadata) != 2 {
		t.Errorf("元数据数量 = %d, want 2", len(metadata))
	}
	if metadata[0].Turns != 1 {
		t.Errorf("第一条 Turns = %d, want 1", metadata[0].Turns)
	}
}

func TestGetTurnByID(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	SaveFileContent(ctx, testGameID1, 5, testPlayerID1, testIP, json.RawMessage(`{"turns":5}`))

	// 获取元数据以拿到 ID
	metadata, _ := GetTurnsMetadata(ctx, testGameID1)
	if len(metadata) == 0 {
		t.Fatal("应有元数据")
	}

	turn, err := GetTurnByID(ctx, metadata[0].ID)
	if err != nil {
		t.Fatalf("GetTurnByID 失败: %v", err)
	}
	if turn == nil {
		t.Fatal("应返回回合数据")
	}
	if turn.Turns != 5 {
		t.Errorf("Turns = %d, want 5", turn.Turns)
	}

	// 不存在的 ID
	turn, err = GetTurnByID(ctx, 99999)
	if err != nil {
		t.Fatalf("GetTurnByID 失败: %v", err)
	}
	if turn != nil {
		t.Error("不存在的 ID 应返回 nil")
	}
}

func TestRollbackGameToTurn(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	SaveFileContent(ctx, testGameID1, 1, testPlayerID1, testIP, json.RawMessage(`{"turns":1}`))
	time.Sleep(time.Millisecond)
	SaveFileContent(ctx, testGameID1, 2, testPlayerID1, testIP, json.RawMessage(`{"turns":2}`))
	time.Sleep(time.Millisecond)
	SaveFileContent(ctx, testGameID1, 3, testPlayerID1, testIP, json.RawMessage(`{"turns":3}`))

	SaveFilePreview(ctx, testGameID1, 1, testPlayerID1, testIP, json.RawMessage(`{"turns":1}`))
	time.Sleep(time.Millisecond)
	SaveFilePreview(ctx, testGameID1, 2, testPlayerID1, testIP, json.RawMessage(`{"turns":2}`))
	time.Sleep(time.Millisecond)
	SaveFilePreview(ctx, testGameID1, 3, testPlayerID1, testIP, json.RawMessage(`{"turns":3}`))

	turns, err := GetTurnsMetadata(ctx, testGameID1)
	if err != nil {
		t.Fatalf("GetTurnsMetadata 失败: %v", err)
	}

	result, err := RollbackGameToTurn(ctx, testGameID1, turns[1].ID)
	if err != nil {
		t.Fatalf("RollbackGameToTurn 失败: %v", err)
	}
	if result == nil {
		t.Fatal("回档结果不应为 nil")
	}
	if result.DeletedTurns != 1 {
		t.Errorf("DeletedTurns = %d, want 1", result.DeletedTurns)
	}
	if result.DeletedPreviews != 1 {
		t.Errorf("DeletedPreviews = %d, want 1", result.DeletedPreviews)
	}
	if result.CurrentTurns != 2 {
		t.Errorf("CurrentTurns = %d, want 2", result.CurrentTurns)
	}

	contents, err := GetAllTurnsForGame(ctx, testGameID1)
	if err != nil {
		t.Fatalf("GetAllTurnsForGame 失败: %v", err)
	}
	if len(contents) != 2 {
		t.Fatalf("回档后回合数量 = %d, want 2", len(contents))
	}
	if contents[len(contents)-1].Turns != 2 {
		t.Errorf("最新回合 = %d, want 2", contents[len(contents)-1].Turns)
	}

	preview, err := GetLatestFilePreview(ctx, testGameID1)
	if err != nil {
		t.Fatalf("GetLatestFilePreview 失败: %v", err)
	}
	if preview == nil {
		t.Fatal("回档后预览不应为空")
	}
	if preview.Turns != 2 {
		t.Errorf("预览回合 = %d, want 2", preview.Turns)
	}
}

func TestRollbackGameToTurn_UsesOldestMatchedPreview(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	SaveFileContent(ctx, testGameID1, 1, testPlayerID1, testIP, json.RawMessage(`{"turns":1}`))
	time.Sleep(time.Millisecond)
	SaveFileContent(ctx, testGameID1, 2, testPlayerID1, testIP, json.RawMessage(`{"turns":2}`))

	SaveFilePreview(ctx, testGameID1, 1, testPlayerID1, testIP, json.RawMessage(`{"turns":1,"preview":"old"}`))
	time.Sleep(time.Millisecond)
	SaveFilePreview(ctx, testGameID1, 2, testPlayerID1, testIP, json.RawMessage(`{"turns":2,"preview":"first"}`))
	time.Sleep(time.Millisecond)
	SaveFilePreview(ctx, testGameID1, 2, testPlayerID1, testIP, json.RawMessage(`{"turns":2,"preview":"second"}`))

	turns, err := GetTurnsMetadata(ctx, testGameID1)
	if err != nil {
		t.Fatalf("GetTurnsMetadata 失败: %v", err)
	}

	result, err := RollbackGameToTurn(ctx, testGameID1, turns[1].ID)
	if err != nil {
		t.Fatalf("RollbackGameToTurn 失败: %v", err)
	}
	if result == nil {
		t.Fatal("回档结果不应为 nil")
	}
	if result.DeletedPreviews != 1 {
		t.Errorf("DeletedPreviews = %d, want 1", result.DeletedPreviews)
	}

	var previewCount int
	err = DB.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM files_preview
		WHERE game_id = ?
	`, testGameID1).Scan(&previewCount)
	if err != nil {
		t.Fatalf("统计预览数量失败: %v", err)
	}
	if previewCount != 2 {
		t.Errorf("预览数量 = %d, want 2", previewCount)
	}
}
