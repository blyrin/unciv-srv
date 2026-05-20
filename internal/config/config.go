// Package config 提供应用配置管理功能
package config

import (
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config 应用配置结构
type Config struct {
	// 服务器配置
	Port string

	// 数据库配置
	DBPath string

	// 管理员账户
	AdminUsername string
	AdminPassword string

	// 限流配置
	MaxAttempts int // 最大尝试次数
	LockTime    int // 锁定时间（分钟）
}

// Load 从环境变量加载配置
func Load() *Config {
	return &Config{
		Port:          getEnv("PORT", "11451"),
		DBPath:        getEnv("DB_PATH", "data/unciv-srv.db"),
		AdminUsername: getEnv("ADMIN_USERNAME", "admin"),
		AdminPassword: getEnv("ADMIN_PASSWORD", "admin123"),
		MaxAttempts:   getEnvAsInt("MAX_ATTEMPTS", 5),
		LockTime:      getEnvAsInt("LOCK_TIME", 5),
	}
}

// DatabaseDSN 返回 SQLite 连接字符串
func (c *Config) DatabaseDSN() string {
	v := url.Values{}
	v.Add("_pragma", "journal_mode(WAL)")
	v.Add("_pragma", "busy_timeout(5000)")
	v.Add("_pragma", "foreign_keys(ON)")
	v.Add("_pragma", "cache_size(-32000)")
	v.Add("_pragma", "temp_store(MEMORY)")
	v.Add("_pragma", "page_size(4096)")
	v.Add("_pragma", "mmap_size(2147483648)")
	return fmt.Sprintf("file:%s?%s", c.DBPath, v.Encode())
}

// getEnv 获取环境变量，如果不存在则返回默认值
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvAsInt 获取环境变量并转换为整数，如果不存在或转换失败则返回默认值
func getEnvAsInt(key string, defaultValue int) int {
	valueStr := os.Getenv(key)
	if valueStr == "" {
		return defaultValue
	}
	value, err := strconv.Atoi(valueStr)
	if err != nil {
		return defaultValue
	}
	return value
}

// LoadEnvFile 从 .env 文件加载环境变量
func LoadEnvFile(filename string) error {
	data, err := os.ReadFile(filename)
	if err != nil {
		return err
	}

	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || line[0] == '#' {
			continue
		}

		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])
		value = strings.Trim(value, "\"'")

		if key != "" {
			if os.Getenv(key) == "" {
				if err := os.Setenv(key, value); err != nil {
					slog.Warn("设置环境变量失败", "key", key, "error", err)
				}
			}
		}
	}

	return nil
}
