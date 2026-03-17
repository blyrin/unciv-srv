package database

import (
	"context"
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// SetupTestDB 初始化内存数据库供测试使用
// 返回 cleanup 函数用于测试结束后关闭数据库
func SetupTestDB() (func(), error) {
	var err error
	DB, err = sql.Open("sqlite", ":memory:")
	if err != nil {
		return nil, fmt.Errorf("打开测试数据库失败: %w", err)
	}

	DB.SetMaxOpenConns(1)

	if _, err = DB.Exec("PRAGMA foreign_keys = ON"); err != nil {
		DB.Close()
		return nil, fmt.Errorf("设置外键约束失败: %w", err)
	}

	if err := RunMigrations(context.Background()); err != nil {
		DB.Close()
		return nil, fmt.Errorf("执行迁移失败: %w", err)
	}

	cleanup := func() {
		if DB != nil {
			DB.Close()
			DB = nil
		}
	}

	return cleanup, nil
}
