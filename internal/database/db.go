package database

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"unciv-srv/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DB 全局数据库连接池
var DB *pgxpool.Pool

// InitDB 初始化数据库连接
func InitDB(ctx context.Context, cfg *config.Config) error {
	dsn := cfg.DatabaseDSN()
	poolConfig, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return fmt.Errorf("解析数据库连接配置失败: %w", err)
	}

	cpus := int32(runtime.NumCPU())
	poolConfig.MaxConns = cpus * 2 // 设置最大连接数为 cpu 数 * 2
	poolConfig.MinConns = cpus     // 设置最小连接数为 cpu 数

	DB, err = pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return fmt.Errorf("创建数据库连接池失败: %w", err)
	}

	// 测试连接
	if err := DB.Ping(ctx); err != nil {
		return fmt.Errorf("数据库连接测试失败: %w", err)
	}

	slog.Info("数据库连接成功")
	return nil
}

// RunMigrations 执行数据库迁移
func RunMigrations(ctx context.Context, migrationsDir string) error {
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
	migrations, err := readMigrationFiles(migrationsDir)
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
		tx, err := DB.Begin(ctx)
		if err != nil {
			return fmt.Errorf("开始事务失败: %w", err)
		}

		// 执行迁移 SQL
		if _, err := tx.Exec(ctx, m.SQL); err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("执行迁移 %d_%s 失败: %w", m.Version, m.Name, err)
		}

		// 记录迁移历史
		if _, err := tx.Exec(ctx,
			"INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
			m.Version, m.Name,
		); err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("记录迁移历史失败: %w", err)
		}

		// 提交事务
		if err := tx.Commit(ctx); err != nil {
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
	_, err := DB.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	return err
}

// getAppliedMigrations 获取已应用的迁移版本
func getAppliedMigrations(ctx context.Context) (map[int]bool, error) {
	rows, err := DB.Query(ctx, "SELECT version FROM schema_migrations")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

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
func readMigrationFiles(dir string) ([]Migration, error) {
	entries, err := os.ReadDir(dir)
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
		content, err := os.ReadFile(filepath.Join(dir, name))
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

// Close 关闭数据库连接
func Close() {
	if DB != nil {
		DB.Close()
	}
}
