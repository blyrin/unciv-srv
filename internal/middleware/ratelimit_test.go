package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRateLimiter_RecordAndLock(t *testing.T) {
	rl := NewRateLimiter(3, 5*time.Minute)
	defer rl.Close()

	ip := "192.168.1.1"

	// 前两次不应被锁定
	if rl.RecordAttempt(ip) {
		t.Error("第1次不应达到限制")
	}
	if rl.RecordAttempt(ip) {
		t.Error("第2次不应达到限制")
	}

	// 第3次达到限制
	if !rl.RecordAttempt(ip) {
		t.Error("第3次应达到限制")
	}

	// 应被锁定
	if !rl.IsLocked(ip) {
		t.Error("应被锁定")
	}
}

func TestRateLimiter_IsLocked_UnknownIP(t *testing.T) {
	rl := NewRateLimiter(3, 5*time.Minute)
	defer rl.Close()

	if rl.IsLocked("unknown") {
		t.Error("未知 IP 不应被锁定")
	}
}

func TestRateLimiter_ResetAttempts(t *testing.T) {
	rl := NewRateLimiter(3, 5*time.Minute)
	defer rl.Close()

	ip := "192.168.1.1"
	rl.RecordAttempt(ip)
	rl.RecordAttempt(ip)

	rl.ResetAttempts(ip)

	remaining := rl.GetRemainingAttempts(ip)
	if remaining != 3 {
		t.Errorf("重置后 remaining = %d, want 3", remaining)
	}
}

func TestRateLimiter_GetRemainingAttempts(t *testing.T) {
	rl := NewRateLimiter(5, 5*time.Minute)
	defer rl.Close()

	ip := "192.168.1.1"
	if got := rl.GetRemainingAttempts(ip); got != 5 {
		t.Errorf("初始 remaining = %d, want 5", got)
	}

	rl.RecordAttempt(ip)
	if got := rl.GetRemainingAttempts(ip); got != 4 {
		t.Errorf("1次后 remaining = %d, want 4", got)
	}
}

func TestRateLimiter_GetLockRemainingTime(t *testing.T) {
	rl := NewRateLimiter(2, 5*time.Minute)
	defer rl.Close()

	ip := "192.168.1.1"

	// 未锁定时返回 0
	if got := rl.GetLockRemainingTime(ip); got != 0 {
		t.Errorf("未锁定时剩余时间 = %v, want 0", got)
	}

	rl.RecordAttempt(ip) // count=1
	rl.RecordAttempt(ip) // count=2, 达到限制并设置 lockedAt

	remaining := rl.GetLockRemainingTime(ip)
	if remaining <= 0 || remaining > 5*time.Minute {
		t.Errorf("锁定剩余时间不合理: %v", remaining)
	}
}

func TestRateLimit_Middleware_Blocked(t *testing.T) {
	rl := NewRateLimiter(2, 5*time.Minute)
	defer rl.Close()

	// 先锁定 IP
	rl.RecordAttempt("192.0.2.1") // count=1
	rl.RecordAttempt("192.0.2.1") // count=2, 达到限制

	mw := RateLimit(rl)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("被锁定不应到达内部 handler")
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.0.2.1:12345"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusTooManyRequests {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusTooManyRequests)
	}
}

func TestRateLimit_Middleware_Allowed(t *testing.T) {
	rl := NewRateLimiter(5, 5*time.Minute)
	defer rl.Close()

	called := false
	mw := RateLimit(rl)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.0.2.1:12345"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if !called {
		t.Error("未锁定应允许通过")
	}
}

func TestRateLimiter_PruneAttempts(t *testing.T) {
	rl := NewRateLimiter(3, 5*time.Minute)
	defer rl.Close()

	now := time.Now()
	rl.attempts["old"] = &attemptInfo{count: 1, firstAt: now.Add(-25 * time.Hour)}
	rl.attempts["locked"] = &attemptInfo{count: 3, firstAt: now.Add(-time.Hour), lockedAt: now.Add(-10 * time.Minute)}
	rl.attempts["keep"] = &attemptInfo{count: 1, firstAt: now}

	rl.mu.Lock()
	rl.pruneAttempts(now)
	rl.mu.Unlock()

	if _, ok := rl.attempts["old"]; ok {
		t.Fatal("old 应被清理")
	}
	if _, ok := rl.attempts["locked"]; ok {
		t.Fatal("locked 应被清理")
	}
	if _, ok := rl.attempts["keep"]; !ok {
		t.Fatal("keep 不应被清理")
	}
}
