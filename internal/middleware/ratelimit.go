package middleware

import (
	"context"
	"net/http"
	"sync"
	"time"

	"unciv-srv/pkg/utils"
)

// RateLimiter 限流器
type RateLimiter struct {
	ctx         context.Context
	cancel      context.CancelFunc
	mu          sync.RWMutex
	attempts    map[string]*attemptInfo
	maxAttempts int
	lockTime    time.Duration
}

type attemptInfo struct {
	count    int
	firstAt  time.Time
	lockedAt time.Time
}

// NewRateLimiter 创建新的限流器
func NewRateLimiter(maxAttempts int, lockTime time.Duration) *RateLimiter {
	ctx, cancel := context.WithCancel(context.Background())

	rl := &RateLimiter{
		ctx:         ctx,
		cancel:      cancel,
		attempts:    make(map[string]*attemptInfo),
		maxAttempts: maxAttempts,
		lockTime:    lockTime,
	}

	// 启动清理协程
	go rl.cleanup()

	return rl
}

// cleanup 定期清理过期记录
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-rl.ctx.Done():
			return
		case <-ticker.C:
			rl.mu.Lock()
			now := time.Now()
			for ip, info := range rl.attempts {
				// 清理已解锁且超过24小时的记录
				if info.lockedAt.IsZero() && now.Sub(info.firstAt) > 24*time.Hour {
					delete(rl.attempts, ip)
				}
				// 清理已解锁的记录（锁定时间过后）
				if !info.lockedAt.IsZero() && now.Sub(info.lockedAt) > rl.lockTime {
					delete(rl.attempts, ip)
				}
			}
			rl.mu.Unlock()
		}
	}
}

// Close 停止限流器并清理资源
func (rl *RateLimiter) Close() {
	if rl.cancel != nil {
		rl.cancel()
	}
}

// IsLocked 检查IP是否被锁定
func (rl *RateLimiter) IsLocked(ip string) bool {
	rl.mu.RLock()
	defer rl.mu.RUnlock()

	info, exists := rl.attempts[ip]
	if !exists {
		return false
	}

	// 检查是否在锁定期内
	if !info.lockedAt.IsZero() {
		if time.Since(info.lockedAt) < rl.lockTime {
			return true
		}
	}

	return false
}

// RecordAttempt 记录尝试
// 返回是否达到限制
func (rl *RateLimiter) RecordAttempt(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()

	info, exists := rl.attempts[ip]
	if !exists {
		rl.attempts[ip] = &attemptInfo{
			count:   1,
			firstAt: now,
		}
		return false
	}

	// 如果之前被锁定但已解锁，重置计数
	if !info.lockedAt.IsZero() && now.Sub(info.lockedAt) >= rl.lockTime {
		info.count = 1
		info.firstAt = now
		info.lockedAt = time.Time{}
		return false
	}

	// 增加计数
	info.count++

	// 检查是否达到限制
	if info.count >= rl.maxAttempts {
		info.lockedAt = now
		return true
	}

	return false
}

// ResetAttempts 重置尝试记录（登录成功时调用）
func (rl *RateLimiter) ResetAttempts(ip string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	delete(rl.attempts, ip)
}

// GetRemainingAttempts 获取剩余尝试次数
func (rl *RateLimiter) GetRemainingAttempts(ip string) int {
	rl.mu.RLock()
	defer rl.mu.RUnlock()

	info, exists := rl.attempts[ip]
	if !exists {
		return rl.maxAttempts
	}

	remaining := rl.maxAttempts - info.count
	if remaining < 0 {
		return 0
	}
	return remaining
}

// GetLockRemainingTime 获取剩余锁定时间
func (rl *RateLimiter) GetLockRemainingTime(ip string) time.Duration {
	rl.mu.RLock()
	defer rl.mu.RUnlock()

	info, exists := rl.attempts[ip]
	if !exists || info.lockedAt.IsZero() {
		return 0
	}

	elapsed := time.Since(info.lockedAt)
	if elapsed >= rl.lockTime {
		return 0
	}

	return rl.lockTime - elapsed
}

// RateLimit 限流中间件
func RateLimit(limiter *RateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := utils.GetClientIP(r)

			// 检查是否被锁定
			if limiter.IsLocked(ip) {
				remaining := limiter.GetLockRemainingTime(ip)
				utils.ErrorResponse(w, http.StatusTooManyRequests,
					"请求过于频繁，请稍后再试 ("+remaining.Round(time.Second).String()+")")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
