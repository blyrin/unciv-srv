package middleware

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

type hijackableResponseWriter struct {
	*httptest.ResponseRecorder
}

func (w *hijackableResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	serverConn, clientConn := net.Pipe()
	_ = clientConn.Close()
	return serverConn, bufio.NewReadWriter(bufio.NewReader(serverConn), bufio.NewWriter(serverConn)), nil
}

func TestLogger_CallsNext(t *testing.T) {
	called := false
	handler := Logger(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	r := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if !called {
		t.Error("Logger 应调用内部 handler")
	}
}

func TestLogger_CapturesStatusCode(t *testing.T) {
	handler := Logger(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))

	r := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusNotFound {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestResponseWriter_Hijack(t *testing.T) {
	rw := &responseWriter{
		ResponseWriter: &hijackableResponseWriter{ResponseRecorder: httptest.NewRecorder()},
		statusCode:     http.StatusOK,
	}

	conn, _, err := rw.Hijack()
	if err != nil {
		t.Fatalf("Hijack 失败: %v", err)
	}
	_ = conn.Close()
}
