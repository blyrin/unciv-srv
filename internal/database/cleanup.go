package database

import (
	"context"
	"log/slog"
	"time"
)

// CleanupExpiredGames 清理过期的非白名单游戏
// 规则：
// 1. 删除超过3个月未更新的非白名单游戏
// 2. 删除创建后1天内无更新且创建时间超过10分钟的游戏
func CleanupExpiredGames(ctx context.Context) (int64, error) {
	// 清理超过3个月未更新的非白名单游戏
	result1, err := DB.Exec(ctx, `
		DELETE FROM files
		WHERE whitelist = FALSE
		AND updated_at < NOW() - INTERVAL '3 months'
	`)
	if err != nil {
		return 0, err
	}
	count1 := result1.RowsAffected()

	// 清理创建后1天内无更新且创建时间超过10分钟的非白名单游戏
	result2, err := DB.Exec(ctx, `
		DELETE FROM files
		WHERE whitelist = FALSE
		AND created_at < NOW() - INTERVAL '10 minutes'
		AND updated_at = created_at
		AND created_at < NOW() - INTERVAL '1 day'
	`)
	if err != nil {
		return count1, err
	}
	count2 := result2.RowsAffected()

	total := count1 + count2
	if total > 0 {
		slog.Info("清理过期游戏", "count", total)
	}

	return total, nil
}

// CleanupOldPreviews 清理旧的预览记录，只保留每个游戏最新的一条
func CleanupOldPreviews(ctx context.Context) (int64, error) {
	result, err := DB.Exec(ctx, `
		DELETE FROM files_preview
		WHERE id NOT IN (
			SELECT DISTINCT ON (game_id) id
			FROM files_preview
			ORDER BY game_id, turns DESC, created_at DESC
		)
	`)
	if err != nil {
		return 0, err
	}

	count := result.RowsAffected()
	if count > 0 {
		slog.Info("清理旧预览记录", "count", count)
	}

	return count, nil
}

// CleanupOldContents 清理旧的内容记录，只保留每个游戏最新的一条
func CleanupOldContents(ctx context.Context) (int64, error) {
	result, err := DB.Exec(ctx, `
		DELETE FROM files_content
		WHERE id NOT IN (
			SELECT DISTINCT ON (game_id) id
			FROM files_content
			ORDER BY game_id, turns DESC, created_at DESC
		)
	`)
	if err != nil {
		return 0, err
	}

	count := result.RowsAffected()
	if count > 0 {
		slog.Info("清理旧内容记录", "count", count)
	}

	return count, nil
}

// RunCleanup 执行所有清理操作
func RunCleanup(ctx context.Context) error {
	startTime := time.Now()
	slog.Info("开始执行数据清理任务")

	// 清理过期游戏
	gamesCount, err := CleanupExpiredGames(ctx)
	if err != nil {
		slog.Error("清理过期游戏失败", "error", err)
		return err
	}

	// 清理旧预览记录
	previewsCount, err := CleanupOldPreviews(ctx)
	if err != nil {
		slog.Error("清理旧预览记录失败", "error", err)
		return err
	}

	// 清理旧内容记录
	contentsCount, err := CleanupOldContents(ctx)
	if err != nil {
		slog.Error("清理旧内容记录失败", "error", err)
		return err
	}

	duration := time.Since(startTime)
	slog.Info("数据清理任务完成",
		"games", gamesCount,
		"previews", previewsCount,
		"contents", contentsCount,
		"duration", duration,
	)

	return nil
}
