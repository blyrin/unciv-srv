package database

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"unciv-srv/internal/config"
)

func TestRunMigrations_Idempotent(t *testing.T) {
	setupTest(t)

	// 第二次执行迁移应该不报错
	err := RunMigrations(context.Background())
	if err != nil {
		t.Fatalf("重复执行迁移失败: %v", err)
	}

	// 第三次
	err = RunMigrations(context.Background())
	if err != nil {
		t.Fatalf("第三次执行迁移失败: %v", err)
	}
}

func TestRunMigrations_SchemaRecorded(t *testing.T) {
	setupTest(t)

	var count int
	err := DB.QueryRowContext(context.Background(),
		"SELECT COUNT(*) FROM schema_migrations",
	).Scan(&count)
	if err != nil {
		t.Fatalf("查询迁移记录失败: %v", err)
	}

	if count == 0 {
		t.Error("schema_migrations 应有记录")
	}
}

func TestInitDBAndClose(t *testing.T) {
	dir, err := os.MkdirTemp(".", "db-test-*")
	if err != nil {
		t.Fatalf("MkdirTemp 失败: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })

	cfg := &config.Config{
		DBPath: filepath.Join(dir, "nested", "unciv.db"),
	}

	if err := InitDB(context.Background(), cfg); err != nil {
		t.Fatalf("InitDB 失败: %v", err)
	}
	t.Cleanup(func() {
		Close()
		DB = nil
	})

	if err := RunMigrations(context.Background()); err != nil {
		t.Fatalf("RunMigrations 失败: %v", err)
	}
	if _, err := os.Stat(cfg.DBPath); err != nil {
		t.Fatalf("数据库文件不存在: %v", err)
	}

	Close()
	if err := DB.Ping(); err == nil {
		t.Fatal("关闭后 Ping 应失败")
	}
}

func TestSetupTestDB(t *testing.T) {
	cleanup, err := SetupTestDB()
	if err != nil {
		t.Fatalf("SetupTestDB 失败: %v", err)
	}
	cleanup()
}

func TestRunCleanup_DBError(t *testing.T) {
	setupTest(t)

	if err := DB.Close(); err != nil {
		t.Fatalf("关闭数据库失败: %v", err)
	}

	err := RunCleanup(context.Background())
	if err == nil || !strings.Contains(err.Error(), "closed") {
		t.Fatalf("RunCleanup 错误 = %v, want 包含 closed", err)
	}
}
