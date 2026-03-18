package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"

	"unciv-srv/internal/config"
	"unciv-srv/internal/middleware"
)

type fakeServer struct {
	listenErr      error
	shutdownErr    error
	listenStarted  chan struct{}
	listenBlocked  chan struct{}
	shutdownCalled bool
}

func (s *fakeServer) ListenAndServe() error {
	if s.listenStarted != nil {
		close(s.listenStarted)
	}
	if s.listenBlocked != nil {
		<-s.listenBlocked
	}
	if s.listenErr != nil {
		return s.listenErr
	}
	return http.ErrServerClosed
}

func (s *fakeServer) Shutdown(_ context.Context) error {
	s.shutdownCalled = true
	if s.listenBlocked != nil {
		select {
		case <-s.listenBlocked:
		default:
			close(s.listenBlocked)
		}
	}
	return s.shutdownErr
}

type fakeScheduler struct {
	startCalled bool
	stopCalled  bool
}

func (s *fakeScheduler) Start() {
	s.startCalled = true
}

func (s *fakeScheduler) Stop() {
	s.stopCalled = true
}

func restoreMainGlobals() func() {
	oldSetDefaultLogger := setDefaultLogger
	oldLoadEnvFile := loadEnvFile
	oldLoadConfig := loadConfig
	oldInitDB := initDB
	oldCloseDB := closeDB
	oldRunMigrations := runMigrations
	oldNewRateLimiter := newRateLimiter
	oldSetupRouter := setupRouter
	oldNewScheduler := newScheduler
	oldNewHTTPServer := newHTTPServer
	oldNotifySignals := notifySignals
	oldRunApp := runApp
	oldExitFunc := exitFunc

	return func() {
		setDefaultLogger = oldSetDefaultLogger
		loadEnvFile = oldLoadEnvFile
		loadConfig = oldLoadConfig
		initDB = oldInitDB
		closeDB = oldCloseDB
		runMigrations = oldRunMigrations
		newRateLimiter = oldNewRateLimiter
		setupRouter = oldSetupRouter
		newScheduler = oldNewScheduler
		newHTTPServer = oldNewHTTPServer
		notifySignals = oldNotifySignals
		runApp = oldRunApp
		exitFunc = oldExitFunc
	}
}

func TestRun_SuccessOnSignal(t *testing.T) {
	restore := restoreMainGlobals()
	t.Cleanup(restore)

	cfg := &config.Config{Port: "18080", MaxAttempts: 3, LockTime: 1}
	server := &fakeServer{
		listenStarted: make(chan struct{}),
		listenBlocked: make(chan struct{}),
	}
	sched := &fakeScheduler{}
	closeDBCalled := false

	loadEnvFile = func(string) error { return nil }
	loadConfig = func() *config.Config { return cfg }
	initDB = func(context.Context, *config.Config) error { return nil }
	closeDB = func() { closeDBCalled = true }
	runMigrations = func(context.Context) error { return nil }
	setupRouter = func(*config.Config, *middleware.RateLimiter) *http.ServeMux {
		return http.NewServeMux()
	}
	newScheduler = func() schedulerRunner { return sched }
	newHTTPServer = func(addr string, handler http.Handler) serverRunner {
		if addr != ":18080" {
			t.Fatalf("Addr = %q, want %q", addr, ":18080")
		}
		if handler == nil {
			t.Fatal("handler 不应为 nil")
		}
		return server
	}

	quit := make(chan os.Signal, 1)
	go func() {
		<-server.listenStarted
		quit <- syscall.SIGINT
	}()

	if err := run(quit); err != nil {
		t.Fatalf("run 返回错误: %v", err)
	}
	if !sched.startCalled || !sched.stopCalled {
		t.Fatalf("scheduler 调用异常: start=%v stop=%v", sched.startCalled, sched.stopCalled)
	}
	if !server.shutdownCalled {
		t.Fatal("应调用 Shutdown")
	}
	if !closeDBCalled {
		t.Fatal("应调用 closeDB")
	}
}

func TestRun_ReturnsServerError(t *testing.T) {
	restore := restoreMainGlobals()
	t.Cleanup(restore)

	server := &fakeServer{listenErr: errors.New("listen failed")}
	sched := &fakeScheduler{}

	loadEnvFile = func(string) error { return nil }
	loadConfig = func() *config.Config { return &config.Config{Port: "19090", MaxAttempts: 3, LockTime: 1} }
	initDB = func(context.Context, *config.Config) error { return nil }
	closeDB = func() {}
	runMigrations = func(context.Context) error { return nil }
	setupRouter = func(*config.Config, *middleware.RateLimiter) *http.ServeMux { return http.NewServeMux() }
	newScheduler = func() schedulerRunner { return sched }
	newHTTPServer = func(string, http.Handler) serverRunner { return server }

	err := run(make(chan os.Signal, 1))
	if err == nil || !strings.Contains(err.Error(), "listen failed") {
		t.Fatalf("run 错误 = %v, want 包含 listen failed", err)
	}
	if !sched.stopCalled {
		t.Fatal("失败时也应停止 scheduler")
	}
}

func TestRun_InitDBError(t *testing.T) {
	restore := restoreMainGlobals()
	t.Cleanup(restore)

	loadEnvFile = func(string) error { return nil }
	loadConfig = func() *config.Config { return &config.Config{} }
	initDB = func(context.Context, *config.Config) error { return errors.New("db down") }

	err := run(make(chan os.Signal, 1))
	if err == nil || !strings.Contains(err.Error(), "db down") {
		t.Fatalf("run 错误 = %v, want 包含 db down", err)
	}
}

func TestRun_ShutdownError(t *testing.T) {
	restore := restoreMainGlobals()
	t.Cleanup(restore)

	server := &fakeServer{
		shutdownErr:   errors.New("shutdown failed"),
		listenStarted: make(chan struct{}),
		listenBlocked: make(chan struct{}),
	}

	loadEnvFile = func(string) error { return nil }
	loadConfig = func() *config.Config { return &config.Config{Port: "18081", MaxAttempts: 3, LockTime: 1} }
	initDB = func(context.Context, *config.Config) error { return nil }
	closeDB = func() {}
	runMigrations = func(context.Context) error { return nil }
	setupRouter = func(*config.Config, *middleware.RateLimiter) *http.ServeMux { return http.NewServeMux() }
	newScheduler = func() schedulerRunner { return &fakeScheduler{} }
	newHTTPServer = func(string, http.Handler) serverRunner { return server }

	quit := make(chan os.Signal, 1)
	go func() {
		<-server.listenStarted
		quit <- syscall.SIGTERM
	}()

	err := run(quit)
	if err == nil || !strings.Contains(err.Error(), "shutdown failed") {
		t.Fatalf("run 错误 = %v, want 包含 shutdown failed", err)
	}
}

func TestMain_ExitOnRunError(t *testing.T) {
	restore := restoreMainGlobals()
	t.Cleanup(restore)

	exitCode := 0
	setDefaultLogger = func() {}
	notifySignals = func(chan<- os.Signal, ...os.Signal) {}
	runApp = func(<-chan os.Signal) error { return errors.New("boom") }
	exitFunc = func(code int) { exitCode = code }

	main()

	if exitCode != 1 {
		t.Fatalf("exitCode = %d, want 1", exitCode)
	}
}

func TestMain_SuccessDoesNotExit(t *testing.T) {
	restore := restoreMainGlobals()
	t.Cleanup(restore)

	exitCode := 0
	setDefaultLogger = func() {}
	notifySignals = func(chan<- os.Signal, ...os.Signal) {}
	runApp = func(<-chan os.Signal) error { return nil }
	exitFunc = func(code int) { exitCode = code }

	main()

	if exitCode != 0 {
		t.Fatalf("exitCode = %d, want 0", exitCode)
	}
}

func TestVersionInfo(t *testing.T) {
	oldVersion := Version
	oldBuildTime := BuildTime
	oldGitCommit := GitCommit
	t.Cleanup(func() {
		Version = oldVersion
		BuildTime = oldBuildTime
		GitCommit = oldGitCommit
	})

	Version = "v1.2.3"
	BuildTime = time.Date(2026, 3, 18, 1, 2, 3, 0, time.UTC).Format(time.RFC3339)
	GitCommit = "abc123"

	got := VersionInfo()
	if !strings.Contains(got, "v1.2.3") || !strings.Contains(got, "abc123") {
		t.Fatalf("VersionInfo = %q, want 包含版本和提交", got)
	}
}
