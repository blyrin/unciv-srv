package main

import (
	"context"
	"errors"
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

func main() {
	// 配置日志
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	slog.Info(VersionInfo())

	// 加载 .env 文件
	if err := config.LoadEnvFile(".env"); err != nil {
		slog.Info("未找到 .env 文件，使用环境变量")
	}

	// 加载配置
	cfg := config.Load()

	// 创建上下文
	ctx := context.Background()

	// 初始化数据库
	slog.Info("连接数据库...")
	if err := database.InitDB(ctx, cfg); err != nil {
		slog.Error("数据库连接失败", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	// 运行数据库迁移
	slog.Info("执行数据库迁移...")
	if err := database.RunMigrations(ctx); err != nil {
		slog.Error("数据库迁移失败", "error", err)
		os.Exit(1)
	}

	// 创建限流器
	rateLimiter := middleware.NewRateLimiter(
		cfg.MaxAttempts,
		time.Duration(cfg.LockTime)*time.Minute,
	)
	defer rateLimiter.Close()

	// 创建路由
	mux := router.Setup(cfg, rateLimiter)

	// 创建服务器
	server := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: mux,
	}

	// 启动定时任务
	sched := scheduler.New()
	sched.Start()
	defer sched.Stop()

	// 启动服务器
	go func() {
		slog.Info("服务器启动", "port", cfg.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("服务器错误", "error", err)
			os.Exit(1)
		}
	}()

	// 等待终止信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("正在关闭服务器...")

	// 优雅关闭
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("服务器关闭失败", "error", err)
	}

	slog.Info("服务器已关闭")
}
