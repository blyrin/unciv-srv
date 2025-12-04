// Package middleware 提供 HTTP 中间件
package middleware

import (
	"bufio"
	"log/slog"
	"net"
	"net/http"
	"time"

	"unciv-srv/pkg/utils"
)

// responseWriter 包装 http.ResponseWriter 以获取状态码
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// Hijack 实现 http.Hijacker 接口，支持 WebSocket 升级
func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return rw.ResponseWriter.(http.Hijacker).Hijack()
}

// Logger 请求日志中间件
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// 包装 ResponseWriter
		rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		// 处理请求
		next.ServeHTTP(rw, r)

		// 记录日志
		duration := time.Since(start)
		slog.Info("HTTP请求",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.statusCode,
			"duration", duration,
			"ip", utils.GetClientIP(r),
			"ua", r.UserAgent(),
		)
	})
}
