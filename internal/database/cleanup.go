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
	result, err := DB.ExecContext(ctx, `
		DELETE FROM files
		WHERE whitelist = 0 AND (
			updated_at < datetime('now', '-3 months')
			OR (created_at < datetime('now', '-10 minutes') AND updated_at = created_at AND created_at < datetime('now', '-1 day'))
		)
	`)
	if err != nil {
		return 0, err
	}

	count, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if count > 0 {
		slog.Info("清理过期游戏", "count", count)
	}

	return count, nil
}

// CleanupOldPreviews 清理旧的预览记录，只保留每个游戏最新的一条
func CleanupOldPreviews(ctx context.Context) (int64, error) {
	result, err := DB.ExecContext(ctx, `
		DELETE FROM files_preview
		WHERE EXISTS (
			SELECT 1 FROM files_preview fp2
			WHERE fp2.game_id = files_preview.game_id
			AND (fp2.turns > files_preview.turns OR (fp2.turns = files_preview.turns AND fp2.created_at > files_preview.created_at))
		)
	`)
	if err != nil {
		return 0, err
	}

	count, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if count > 0 {
		slog.Info("清理旧预览记录", "count", count)
	}

	return count, nil
}

// CleanupOldContents 清理旧的内容记录，只保留每个游戏最新的一条
func CleanupOldContents(ctx context.Context) (int64, error) {
	result, err := DB.ExecContext(ctx, `
		DELETE FROM files_content
		WHERE EXISTS (
			SELECT 1 FROM files_content fc2
			WHERE fc2.game_id = files_content.game_id
			AND (fc2.turns > files_content.turns OR (fc2.turns = files_content.turns AND fc2.created_at > files_content.created_at))
		)
	`)
	if err != nil {
		return 0, err
	}

	count, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
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

	// 更新查询优化器统计信息
	if _, err := DB.ExecContext(ctx, "ANALYZE"); err != nil {
		slog.Error("更新查询优化器失败", "error", err)
	}

	// 整理数据库碎片，回收已删除数据的空间
	if _, err := DB.ExecContext(ctx, "VACUUM"); err != nil {
		slog.Error("数据库碎片整理失败", "error", err)
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
