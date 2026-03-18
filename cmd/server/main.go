package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"unciv-srv/internal/config"
	"unciv-srv/internal/database"
	"unciv-srv/internal/middleware"
	"unciv-srv/internal/router"
	"unciv-srv/internal/scheduler"
)

type serverRunner interface {
	ListenAndServe() error
	Shutdown(ctx context.Context) error
}

type schedulerRunner interface {
	Start()
	Stop()
}

var (
	setDefaultLogger = func() {
		slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	}
	loadEnvFile    = config.LoadEnvFile
	loadConfig     = config.Load
	initDB         = database.InitDB
	closeDB        = database.Close
	runMigrations  = database.RunMigrations
	newRateLimiter = func(maxAttempts int, lockTime time.Duration) *middleware.RateLimiter {
		return middleware.NewRateLimiter(maxAttempts, lockTime)
	}
	setupRouter   = router.Setup
	newScheduler  = func() schedulerRunner { return scheduler.New() }
	newHTTPServer = func(addr string, handler http.Handler) serverRunner {
		return &http.Server{
			Addr:    addr,
			Handler: handler,
		}
	}
	notifySignals = signal.Notify
	runApp        = run
	exitFunc      = os.Exit
)

func main() {
	setDefaultLogger()
	slog.Info(VersionInfo())

	quit := make(chan os.Signal, 1)
	notifySignals(quit, syscall.SIGINT, syscall.SIGTERM)

	if err := runApp(quit); err != nil {
		slog.Error("服务器启动失败", "error", err)
		exitFunc(1)
	}
}

func run(quit <-chan os.Signal) error {
	if err := loadEnvFile(".env"); err != nil {
		slog.Info("未找到 .env 文件，使用环境变量")
	}

	cfg := loadConfig()
	ctx := context.Background()

	slog.Info("连接数据库...")
	if err := initDB(ctx, cfg); err != nil {
		return fmt.Errorf("数据库连接失败: %w", err)
	}
	defer closeDB()

	slog.Info("执行数据库迁移...")
	if err := runMigrations(ctx); err != nil {
		return fmt.Errorf("数据库迁移失败: %w", err)
	}

	rateLimiter := newRateLimiter(
		cfg.MaxAttempts,
		time.Duration(cfg.LockTime)*time.Minute,
	)
	defer rateLimiter.Close()

	mux := setupRouter(cfg, rateLimiter)
	if mux == nil {
		return errors.New("路由初始化失败")
	}

	sched := newScheduler()
	sched.Start()
	defer sched.Stop()

	server := newHTTPServer(":"+cfg.Port, mux)
	serverErr := make(chan error, 1)

	go func() {
		slog.Info("服务器启动", "port", cfg.Port)
		serverErr <- server.ListenAndServe()
	}()

	select {
	case sig := <-quit:
		slog.Info("收到终止信号", "signal", sig.String())
	case err := <-serverErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("服务器错误: %w", err)
		}
		return nil
	}

	slog.Info("正在关闭服务器...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("服务器关闭失败", "error", err)
		return fmt.Errorf("服务器关闭失败: %w", err)
	}

	slog.Info("服务器已关闭")
	return nil
}
