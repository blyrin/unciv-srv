package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoad_Defaults(t *testing.T) {
	// 清除可能已设置的环境变量
	t.Setenv("PORT", "")
	t.Setenv("DB_PATH", "")
	t.Setenv("ADMIN_USERNAME", "")
	t.Setenv("ADMIN_PASSWORD", "")
	t.Setenv("MAX_ATTEMPTS", "")
	t.Setenv("LOCK_TIME", "")

	cfg := Load()

	if cfg.Port != "11451" {
		t.Errorf("Port = %q, want %q", cfg.Port, "11451")
	}
	if cfg.DBPath != "data/unciv-srv.db" {
		t.Errorf("DBPath = %q, want %q", cfg.DBPath, "data/unciv-srv.db")
	}
	if cfg.AdminUsername != "admin" {
		t.Errorf("AdminUsername = %q, want %q", cfg.AdminUsername, "admin")
	}
	if cfg.AdminPassword != "admin123" {
		t.Errorf("AdminPassword = %q, want %q", cfg.AdminPassword, "admin123")
	}
	if cfg.MaxAttempts != 5 {
		t.Errorf("MaxAttempts = %d, want 5", cfg.MaxAttempts)
	}
	if cfg.LockTime != 5 {
		t.Errorf("LockTime = %d, want 5", cfg.LockTime)
	}
}

func TestLoad_EnvOverride(t *testing.T) {
	t.Setenv("PORT", "8080")
	t.Setenv("DB_PATH", "/tmp/test.db")
	t.Setenv("ADMIN_USERNAME", "superadmin")
	t.Setenv("ADMIN_PASSWORD", "supersecret")
	t.Setenv("MAX_ATTEMPTS", "10")
	t.Setenv("LOCK_TIME", "15")

	cfg := Load()

	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want %q", cfg.Port, "8080")
	}
	if cfg.DBPath != "/tmp/test.db" {
		t.Errorf("DBPath = %q, want %q", cfg.DBPath, "/tmp/test.db")
	}
	if cfg.AdminUsername != "superadmin" {
		t.Errorf("AdminUsername = %q, want %q", cfg.AdminUsername, "superadmin")
	}
	if cfg.AdminPassword != "supersecret" {
		t.Errorf("AdminPassword = %q, want %q", cfg.AdminPassword, "supersecret")
	}
	if cfg.MaxAttempts != 10 {
		t.Errorf("MaxAttempts = %d, want 10", cfg.MaxAttempts)
	}
	if cfg.LockTime != 15 {
		t.Errorf("LockTime = %d, want 15", cfg.LockTime)
	}
}

func TestLoad_InvalidInt(t *testing.T) {
	t.Setenv("MAX_ATTEMPTS", "not_a_number")
	t.Setenv("LOCK_TIME", "")

	cfg := Load()

	if cfg.MaxAttempts != 5 {
		t.Errorf("MaxAttempts 非法值应返回默认值 5, got %d", cfg.MaxAttempts)
	}
}

func TestDatabaseDSN(t *testing.T) {
	cfg := &Config{DBPath: "test.db"}
	dsn := cfg.DatabaseDSN()

	if !strings.HasPrefix(dsn, "file:test.db?") {
		t.Errorf("DSN 应以 file:test.db? 开头, got %q", dsn)
	}
	if !strings.Contains(dsn, "journal_mode") {
		t.Error("DSN 应包含 journal_mode pragma")
	}
	if !strings.Contains(dsn, "foreign_keys") {
		t.Error("DSN 应包含 foreign_keys pragma")
	}
	if !strings.Contains(dsn, "busy_timeout") {
		t.Error("DSN 应包含 busy_timeout pragma")
	}
}

func TestLoadEnvFile(t *testing.T) {
	dir, err := os.MkdirTemp(".", "config-test-*")
	if err != nil {
		t.Fatalf("MkdirTemp 失败: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })

	envPath := filepath.Join(dir, ".env")
	content := "# comment\r\nPORT = 18080\r\nEMPTY=\r\nADMIN_PASSWORD='quoted'\r\nDB_PATH = \"data/test.db\"\r\nINVALID\r\n"
	if err := os.WriteFile(envPath, []byte(content), 0644); err != nil {
		t.Fatalf("WriteFile 失败: %v", err)
	}

	t.Setenv("PORT", "19090")
	t.Setenv("ADMIN_PASSWORD", "")

	if err := LoadEnvFile(envPath); err != nil {
		t.Fatalf("LoadEnvFile 失败: %v", err)
	}

	if got := os.Getenv("PORT"); got != "19090" {
		t.Fatalf("PORT = %q, want 19090", got)
	}
	if got := os.Getenv("ADMIN_PASSWORD"); got != "quoted" {
		t.Fatalf("ADMIN_PASSWORD = %q, want quoted", got)
	}
	if got := os.Getenv("DB_PATH"); got != "data/test.db" {
		t.Fatalf("DB_PATH = %q, want data/test.db", got)
	}
}

func TestSplitLines(t *testing.T) {
	lines := splitLines("a\r\nb\nc")
	if len(lines) != 3 || lines[0] != "a" || lines[2] != "c" {
		t.Fatalf("splitLines = %#v", lines)
	}
}

func TestParseEnvLine(t *testing.T) {
	key, value := parseEnvLine(" DB_PATH = \"data/test.db\" ")
	if key != "DB_PATH" || value != "data/test.db" {
		t.Fatalf("parseEnvLine = (%q, %q)", key, value)
	}

	key, value = parseEnvLine("INVALID")
	if key != "" || value != "" {
		t.Fatalf("非法行应返回空值, got (%q, %q)", key, value)
	}
}

func TestTrimHelpers(t *testing.T) {
	if got := trimSpace("\t hello \t"); got != "hello" {
		t.Fatalf("trimSpace = %q, want hello", got)
	}
	if got := trimQuotes(`"hello"`); got != "hello" {
		t.Fatalf("trimQuotes = %q, want hello", got)
	}
	if got := trimQuotes("'hello'"); got != "hello" {
		t.Fatalf("trimQuotes = %q, want hello", got)
	}
}
