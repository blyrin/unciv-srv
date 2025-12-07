// Package router 提供 HTTP 路由配置
package router

import (
	"embed"
	"io/fs"
	"net/http"

	"unciv-srv/internal/config"
	"unciv-srv/internal/handler"
	"unciv-srv/internal/middleware"
)

const healthCheckResponse = `{"authVersion":1,"chatVersion":1}`

//go:embed web
var webFS embed.FS

// Setup 配置所有路由
func Setup(cfg *config.Config, rateLimiter *middleware.RateLimiter) *http.ServeMux {
	mux := http.NewServeMux()

	// 静态文件服务
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		return nil
	}
	fileServer := http.FileServer(http.FS(sub))
	mux.Handle("/", fileServer)

	// 健康检查
	mux.HandleFunc("GET /isalive", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(healthCheckResponse))
	})

	// 游戏客户端接口（需要 Basic Auth）
	mux.Handle("GET /auth", middleware.Logger(middleware.BasicAuth(http.HandlerFunc(handler.GetAuth))))
	mux.Handle("PUT /auth", middleware.Logger(middleware.BasicAuth(http.HandlerFunc(handler.PutAuth))))
	mux.Handle("GET /files/{gameId}", middleware.Logger(middleware.ValidateGameID(middleware.BasicAuth(http.HandlerFunc(handler.GetFile)))))
	mux.Handle("PUT /files/{gameId}", middleware.Logger(middleware.ValidateGameID(middleware.BasicAuth(http.HandlerFunc(handler.PutFile)))))

	// WebSocket 聊天
	mux.Handle("/chat", middleware.Logger(http.HandlerFunc(handler.ChatWebSocket)))

	// 登录处理器
	loginHandler := &handler.LoginHandler{Config: cfg, RateLimiter: rateLimiter}

	// Web API - 登录/登出
	mux.Handle("POST /api/login", middleware.Logger(middleware.RateLimit(rateLimiter)(http.HandlerFunc(loginHandler.Login))))
	mux.Handle("GET /api/logout", middleware.Logger(http.HandlerFunc(handler.Logout)))

	// Web API - 管理员接口
	mux.Handle("GET /api/players", middleware.Logger(middleware.AdminOnly(http.HandlerFunc(handler.GetAllPlayers))))
	mux.Handle("PUT /api/players/{playerId}", middleware.Logger(middleware.AdminOnly(http.HandlerFunc(handler.UpdatePlayer))))
	mux.Handle("GET /api/players/{playerId}/password", middleware.Logger(middleware.AdminOnly(http.HandlerFunc(handler.GetPlayerPassword))))
	mux.Handle("GET /api/games", middleware.Logger(middleware.AdminOnly(http.HandlerFunc(handler.GetAllGames))))
	mux.Handle("PUT /api/games/{gameId}", middleware.Logger(middleware.AdminOnly(http.HandlerFunc(handler.UpdateGame))))
	mux.Handle("GET /api/stats", middleware.Logger(middleware.AdminOnly(http.HandlerFunc(handler.GetStats))))

	// Web API - 用户接口
	mux.Handle("GET /api/users/games", middleware.Logger(middleware.SessionAuth(http.HandlerFunc(handler.GetUserGames))))
	mux.Handle("GET /api/users/stats", middleware.Logger(middleware.SessionAuth(http.HandlerFunc(handler.GetUserStats))))
	mux.Handle("DELETE /api/games/{gameId}", middleware.Logger(middleware.SessionAuth(http.HandlerFunc(handler.DeleteGame))))
	mux.Handle("GET /api/games/{gameId}/download", middleware.Logger(middleware.SessionAuth(http.HandlerFunc(handler.DownloadGameHistory))))

	return mux
}
