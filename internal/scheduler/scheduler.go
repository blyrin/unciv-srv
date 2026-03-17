// Package scheduler 提供定时任务功能
package scheduler

import (
	"context"
	"log/slog"
	"os"

	"unciv-srv/internal/database"
	"unciv-srv/internal/middleware"

	"github.com/robfig/cron/v3"
)

// Scheduler 定时任务调度器
type Scheduler struct {
	cron *cron.Cron
}

// New 创建新的调度器
func New() *Scheduler {
	return &Scheduler{
		cron: cron.New(),
	}
}

// Start 启动调度器
func (s *Scheduler) Start() {
	// 每天凌晨 4 点执行数据清理
	_, err := s.cron.AddFunc("0 4 * * *", func() {
		slog.Info("执行定时数据清理任务")
		if err := database.RunCleanup(context.Background()); err != nil {
			slog.Error("数据清理任务失败", "error", err)
		}
	})

	// 每小时清理一次过期 Session
	_, err = s.cron.AddFunc("0 * * * *", func() {
		slog.Info("清理过期Session")
		middleware.CleanupExpiredSessions()
	})
	if err != nil {
		slog.Error("定时任务调度器启动失败", "error", err)
		os.Exit(1)
	}

	s.cron.Start()
	slog.Info("定时任务调度器已启动")
}

// Stop 停止调度器
func (s *Scheduler) Stop() {
	ctx := s.cron.Stop()
	<-ctx.Done()
	slog.Info("定时任务调度器已停止")
}

// RunCleanupNow 立即执行清理任务
func (s *Scheduler) RunCleanupNow() error {
	return database.RunCleanup(context.Background())
}
