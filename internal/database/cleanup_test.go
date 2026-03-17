package database

import (
	"context"
	"encoding/json"
	"testing"
)

func TestCleanupExpiredGames(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)

	// 插入一个超过3个月未更新的非白名单游戏
	_, err := DB.ExecContext(ctx, `
		INSERT INTO files (game_id, players, created_at, updated_at, whitelist)
		VALUES (?, ?, datetime('now', '-4 months'), datetime('now', '-4 months'), 0)
	`, testGameID1, `["`+testPlayerID1+`"]`)
	if err != nil {
		t.Fatalf("插入过期游戏失败: %v", err)
	}

	// 插入一个正常游戏
	seedGame(t, testGameID2, []string{testPlayerID1})

	// 插入一个白名单的过期游戏（不应被删除）
	_, err = DB.ExecContext(ctx, `
		INSERT INTO files (game_id, players, created_at, updated_at, whitelist)
		VALUES (?, ?, datetime('now', '-4 months'), datetime('now', '-4 months'), 1)
	`, testGameID3, `["`+testPlayerID1+`"]`)
	if err != nil {
		t.Fatalf("插入白名单游戏失败: %v", err)
	}

	count, err := CleanupExpiredGames(ctx)
	if err != nil {
		t.Fatalf("CleanupExpiredGames 失败: %v", err)
	}
	if count != 1 {
		t.Errorf("清理数量 = %d, want 1", count)
	}

	// 验证正常游戏和白名单游戏仍在
	g2, _ := GetGameByID(ctx, testGameID2)
	g3, _ := GetGameByID(ctx, testGameID3)
	if g2 == nil {
		t.Error("正常游戏不应被删除")
	}
	if g3 == nil {
		t.Error("白名单游戏不应被删除")
	}
}

func TestCleanupOldPreviews(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	// 为同一游戏插入多条预览
	seedFilePreview(t, testGameID1, 1, testPlayerID1, json.RawMessage(`{"turns":1}`))
	seedFilePreview(t, testGameID1, 3, testPlayerID1, json.RawMessage(`{"turns":3}`))
	seedFilePreview(t, testGameID1, 5, testPlayerID1, json.RawMessage(`{"turns":5}`))

	count, err := CleanupOldPreviews(ctx)
	if err != nil {
		t.Fatalf("CleanupOldPreviews 失败: %v", err)
	}
	if count != 2 {
		t.Errorf("清理数量 = %d, want 2", count)
	}

	// 最新的应保留
	fp, _ := GetLatestFilePreview(ctx, testGameID1)
	if fp == nil {
		t.Fatal("最新预览应保留")
	}
	if fp.Turns != 5 {
		t.Errorf("保留的 Turns = %d, want 5", fp.Turns)
	}
}

func TestCleanupOldContents(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	seedFileContent(t, testGameID1, 1, testPlayerID1, json.RawMessage(`{"turns":1}`))
	seedFileContent(t, testGameID1, 3, testPlayerID1, json.RawMessage(`{"turns":3}`))
	seedFileContent(t, testGameID1, 5, testPlayerID1, json.RawMessage(`{"turns":5}`))

	count, err := CleanupOldContents(ctx)
	if err != nil {
		t.Fatalf("CleanupOldContents 失败: %v", err)
	}
	if count != 2 {
		t.Errorf("清理数量 = %d, want 2", count)
	}

	fc, _ := GetLatestFileContent(ctx, testGameID1)
	if fc == nil {
		t.Fatal("最新内容应保留")
	}
	if fc.Turns != 5 {
		t.Errorf("保留的 Turns = %d, want 5", fc.Turns)
	}
}

func TestRunCleanup(t *testing.T) {
	setupTest(t)

	// 空库执行不报错
	err := RunCleanup(context.Background())
	if err != nil {
		t.Fatalf("RunCleanup 失败: %v", err)
	}
}
