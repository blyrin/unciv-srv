// Package config 提供应用配置管理功能
package config

import (
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
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

	lines := splitLines(string(data))
	for _, line := range lines {
		// 跳过空行和注释
		if line == "" || line[0] == '#' {
			continue
		}

		// 解析 KEY=VALUE 格式
		key, value := parseEnvLine(line)
		if key != "" {
			// 只设置未定义的环境变量
			if os.Getenv(key) == "" {
				if err := os.Setenv(key, value); err != nil {
					slog.Warn("设置环境变量失败", "key", key, "error", err)
					continue
				}
			}
		}
	}

	return nil
}

// splitLines 按行分割字符串
func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			// 移除可能的 \r
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, line)
			start = i + 1
		}
	}
	// 添加最后一行（如果有）
	if start < len(s) {
		line := s[start:]
		if len(line) > 0 && line[len(line)-1] == '\r' {
			line = line[:len(line)-1]
		}
		lines = append(lines, line)
	}
	return lines
}

// parseEnvLine 解析环境变量行
func parseEnvLine(line string) (key, value string) {
	// 查找等号位置
	for i := 0; i < len(line); i++ {
		if line[i] == '=' {
			key = line[:i]
			value = line[i+1:]

			// 移除键的前后空格
			key = trimSpace(key)

			// 移除值的引号和前后空格
			value = trimSpace(value)
			value = trimQuotes(value)

			return key, value
		}
	}
	return "", ""
}

// trimSpace 移除字符串前后的空格
func trimSpace(s string) string {
	start := 0
	end := len(s)

	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}

	return s[start:end]
}

// trimQuotes 移除字符串的引号
func trimQuotes(s string) string {
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}
