package database

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"unciv-srv/internal/config"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// DB 全局数据库连接
var DB *sql.DB

// InitDB 初始化数据库连接
func InitDB(ctx context.Context, cfg *config.Config) error {
	// 确保数据库目录存在
	if dir := filepath.Dir(cfg.DBPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("创建数据库目录失败: %w", err)
		}
	}

	dsn := cfg.DatabaseDSN()

	var err error
	DB, err = sql.Open("sqlite", dsn)
	if err != nil {
		return fmt.Errorf("打开数据库失败: %w", err)
	}

	// SQLite 单写模式
	DB.SetMaxOpenConns(1)

	// 测试连接
	if err := DB.PingContext(ctx); err != nil {
		return fmt.Errorf("数据库连接测试失败: %w", err)
	}

	if _, err = DB.ExecContext(ctx, `
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = NORMAL;
		PRAGMA foreign_keys = ON;
		PRAGMA cache_size = -32000;
		PRAGMA temp_store = MEMORY;
		PRAGMA page_size = 4096;
		PRAGMA mmap_size = 2147483648;
	`); err != nil {
		return fmt.Errorf("设置数据库参数失败: %w", err)
	}

	return nil
}

// RunMigrations 执行数据库迁移
func RunMigrations(ctx context.Context) error {
	// 确保迁移历史表存在
	if err := ensureMigrationsTable(ctx); err != nil {
		return err
	}

	// 读取已执行的迁移版本
	appliedVersions, err := getAppliedMigrations(ctx)
	if err != nil {
		return err
	}

	// 读取迁移文件
	migrations, err := readMigrationFiles()
	if err != nil {
		return err
	}

	// 按版本号排序
	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].Version < migrations[j].Version
	})

	// 执行未应用的迁移
	for _, m := range migrations {
		if _, applied := appliedVersions[m.Version]; applied {
			continue
		}

		slog.Info("执行迁移", "version", m.Version, "name", m.Name)

		// 开始事务
		tx, err := DB.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("开始事务失败: %w", err)
		}

		// 执行迁移 SQL
		if _, err := tx.ExecContext(ctx, m.SQL); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("执行迁移 %d_%s 失败: %w", m.Version, m.Name, err)
		}

		// 记录迁移历史
		if _, err := tx.ExecContext(ctx,
			"insert into schema_migrations (version, name) values (?, ?)",
			m.Version, m.Name,
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("记录迁移历史失败: %w", err)
		}

		// 提交事务
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("提交事务失败: %w", err)
		}

		slog.Info("迁移完成", "version", m.Version, "name", m.Name)
	}

	return nil
}

// Migration 迁移文件结构
type Migration struct {
	Version int
	Name    string
	SQL     string
}

// ensureMigrationsTable 确保迁移历史表存在
func ensureMigrationsTable(ctx context.Context) error {
	_, err := DB.ExecContext(ctx, `
		create table IF not exists schema_migrations (
			version integer primary key,
			name TEXT not null,
			applied_at DATETIME not null default (datetime('now'))
		)
	`)
	return err
}

// getAppliedMigrations 获取已应用的迁移版本
func getAppliedMigrations(ctx context.Context) (map[int]bool, error) {
	rows, err := DB.QueryContext(ctx, "select version from schema_migrations")
	if err != nil {
		return nil, err
	}
	defer func(rows *sql.Rows) { _ = rows.Close() }(rows)

	versions := make(map[int]bool)
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			return nil, err
		}
		versions[version] = true
	}

	return versions, rows.Err()
}

// readMigrationFiles 读取迁移文件
func readMigrationFiles() ([]Migration, error) {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("读取迁移目录失败: %w", err)
	}

	var migrations []Migration

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := entry.Name()

		// 只处理 .up.sql 文件
		if !strings.HasSuffix(name, ".up.sql") {
			continue
		}

		// 解析版本号和名称
		// 格式: 000001_init_schema.up.sql
		parts := strings.SplitN(name, "_", 2)
		if len(parts) != 2 {
			continue
		}

		version, err := strconv.Atoi(parts[0])
		if err != nil {
			continue
		}

		migrationName := strings.TrimSuffix(parts[1], ".up.sql")

		// 读取 SQL 内容
		content, err := fs.ReadFile(migrationsFS, "migrations/"+name)
		if err != nil {
			return nil, fmt.Errorf("读取迁移文件 %s 失败: %w", name, err)
		}

		migrations = append(migrations, Migration{
			Version: version,
			Name:    migrationName,
			SQL:     string(content),
		})
	}

	return migrations, nil
}

// Close 关闭数据库连接，关闭前执行 PRAGMA optimize 更新查询优化器统计信息
func Close() {
	if DB != nil {
		_, _ = DB.Exec("PRAGMA optimize")
		_ = DB.Close()
	}
}
