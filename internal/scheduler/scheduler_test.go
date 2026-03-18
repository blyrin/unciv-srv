package scheduler

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"unciv-srv/internal/database"
	"unciv-srv/internal/middleware"
)

const (
	schedulerPlayerID = "00000000-0000-0000-0000-000000000010"
	schedulerGameID   = "11111111-1111-1111-1111-111111111110"
)

func setupSchedulerTest(t *testing.T) {
	t.Helper()
	cleanup, err := database.SetupTestDB()
	if err != nil {
		t.Fatalf("初始化测试数据库失败: %v", err)
	}
	t.Cleanup(cleanup)
}

func TestNew(t *testing.T) {
	s := New()
	if s == nil || s.cron == nil {
		t.Fatal("New 应返回可用调度器")
	}
}

func TestStartAndStop(t *testing.T) {
	setupSchedulerTest(t)

	s := New()
	s.Start()
	defer s.Stop()

	entries := s.cron.Entries()
	if len(entries) != 2 {
		t.Fatalf("任务数量 = %d, want 2", len(entries))
	}

	for _, entry := range entries {
		entry.Job.Run()
	}
}

func TestRunCleanupNow(t *testing.T) {
	setupSchedulerTest(t)
	ctx := context.Background()

	if err := database.CreatePlayer(ctx, schedulerPlayerID, "password123", "127.0.0.1"); err != nil {
		t.Fatalf("CreatePlayer 失败: %v", err)
	}
	if err := database.CreateGame(ctx, schedulerGameID, []string{schedulerPlayerID}); err != nil {
		t.Fatalf("CreateGame 失败: %v", err)
	}
	if err := database.SaveFileContent(ctx, schedulerGameID, 1, schedulerPlayerID, "127.0.0.1", json.RawMessage(`{"turns":1}`)); err != nil {
		t.Fatalf("SaveFileContent 失败: %v", err)
	}
	if err := database.SaveFileContent(ctx, schedulerGameID, 2, schedulerPlayerID, "127.0.0.1", json.RawMessage(`{"turns":2}`)); err != nil {
		t.Fatalf("SaveFileContent 失败: %v", err)
	}

	sessionID := middleware.CreateSession("user", false)
	middleware.DeleteSession(sessionID)

	s := New()
	if err := s.RunCleanupNow(); err != nil {
		t.Fatalf("RunCleanupNow 失败: %v", err)
	}

	content, err := database.GetLatestFileContent(ctx, schedulerGameID)
	if err != nil {
		t.Fatalf("GetLatestFileContent 失败: %v", err)
	}
	if content == nil || content.Turns != 2 {
		t.Fatalf("最新回合 = %#v, want turns=2", content)
	}
}

func TestStopWithoutStart(t *testing.T) {
	s := New()
	done := make(chan struct{})
	go func() {
		s.Stop()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop 超时")
	}
}
