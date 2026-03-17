package database

import (
	"context"
	"testing"
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
