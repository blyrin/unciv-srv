// Package utils 提供通用工具函数
package utils

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// JSONResponse 发送 JSON 响应
func JSONResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		slog.Error("JSON响应写入失败", "error", err)
	}
}

// TextResponse 发送文本响应
func TextResponse(w http.ResponseWriter, status int, text string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	if _, err := w.Write([]byte(text)); err != nil {
		slog.Error("文本响应写入失败", "error", err)
	}
}

// ErrorResponse 发送错误响应
func ErrorResponse(w http.ResponseWriter, status int, message string, err error) {
	if err != nil {
		slog.Error(message, "error", err)
	}
	TextResponse(w, status, message)
}

// SuccessResponse 发送成功响应
func SuccessResponse(w http.ResponseWriter, data any) {
	JSONResponse(w, http.StatusOK, data)
}

// ZipResponse 发送 ZIP 文件响应
func ZipResponse(w http.ResponseWriter, filename string, data []byte) {
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename="+filename)
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(data); err != nil {
		slog.Error("ZIP响应写入失败", "error", err)
	}
}

// GetClientIP 获取客户端 IP
func GetClientIP(r *http.Request) string {
	// 优先从 X-Forwarded-For 获取
	if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
		// 可能有多个 IP，取第一个
		for i := 0; i < len(ip); i++ {
			if ip[i] == ',' {
				return ip[:i]
			}
		}
		return ip
	}
	// 其次从 X-Real-IP 获取
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	// 最后从 RemoteAddr 获取
	addr := r.RemoteAddr
	// 去除端口号
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' {
			return addr[:i]
		}
	}
	return addr
}
