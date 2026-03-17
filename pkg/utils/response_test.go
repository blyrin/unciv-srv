package utils

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestJSONResponse(t *testing.T) {
	w := httptest.NewRecorder()
	data := map[string]string{"key": "value"}
	JSONResponse(w, http.StatusOK, data)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}

	var result map[string]string
	json.NewDecoder(w.Body).Decode(&result)
	if result["key"] != "value" {
		t.Errorf("响应内容不正确: %v", result)
	}
}

func TestTextResponse(t *testing.T) {
	w := httptest.NewRecorder()
	TextResponse(w, http.StatusOK, "hello")

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}
	if ct := w.Header().Get("Content-Type"); ct != "text/plain; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}
	if w.Body.String() != "hello" {
		t.Errorf("Body = %q, want %q", w.Body.String(), "hello")
	}
}

func TestErrorResponse(t *testing.T) {
	w := httptest.NewRecorder()
	ErrorResponse(w, http.StatusBadRequest, "出错了", nil)

	if w.Code != http.StatusBadRequest {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusBadRequest)
	}

	var body ErrorResponseBody
	json.NewDecoder(w.Body).Decode(&body)
	if body.Type != "error" {
		t.Errorf("Type = %q, want %q", body.Type, "error")
	}
	if body.Message != "出错了" {
		t.Errorf("Message = %q, want %q", body.Message, "出错了")
	}
}

func TestSuccessResponse(t *testing.T) {
	w := httptest.NewRecorder()
	SuccessResponse(w)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestFileResponse(t *testing.T) {
	w := httptest.NewRecorder()
	data := []byte("file content")
	FileResponse(w, "application/zip", "test.zip", data)

	if w.Code != http.StatusOK {
		t.Errorf("状态码 = %d, want %d", w.Code, http.StatusOK)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/zip" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cd := w.Header().Get("Content-Disposition"); cd != "attachment; filename=test.zip" {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if w.Body.String() != "file content" {
		t.Errorf("Body 不正确")
	}
}

func TestGetClientIP(t *testing.T) {
	tests := map[string]struct {
		headers    map[string]string
		remoteAddr string
		want       string
	}{
		"X-Forwarded-For单个IP": {
			headers: map[string]string{"X-Forwarded-For": "1.2.3.4"},
			want:    "1.2.3.4",
		},
		"X-Forwarded-For多个IP": {
			headers: map[string]string{"X-Forwarded-For": "1.2.3.4, 5.6.7.8"},
			want:    "1.2.3.4",
		},
		"X-Real-IP": {
			headers: map[string]string{"X-Real-IP": "9.8.7.6"},
			want:    "9.8.7.6",
		},
		"X-Forwarded-For优先于X-Real-IP": {
			headers: map[string]string{
				"X-Forwarded-For": "1.2.3.4",
				"X-Real-IP":       "9.8.7.6",
			},
			want: "1.2.3.4",
		},
		"仅RemoteAddr": {
			remoteAddr: "192.168.1.1:12345",
			want:       "192.168.1.1",
		},
		"RemoteAddr无端口": {
			remoteAddr: "192.168.1.1",
			want:       "192.168.1.1",
		},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/", nil)
			for k, v := range tt.headers {
				r.Header.Set(k, v)
			}
			if tt.remoteAddr != "" {
				r.RemoteAddr = tt.remoteAddr
			}

			got := GetClientIP(r)
			if got != tt.want {
				t.Errorf("GetClientIP() = %q, want %q", got, tt.want)
			}
		})
	}
}
