// Package handler 提供 HTTP 请求处理器
package handler

import (
	"io"
	"net/http"

	"unciv-srv/internal/database"
	"unciv-srv/internal/middleware"
	"unciv-srv/pkg/utils"
)

// GetAuth 处理 GET /auth
// 用于验证用户身份，如果用户不存在则自动注册
func GetAuth(w http.ResponseWriter, r *http.Request) {
	// 认证由中间件完成，到达这里说明认证成功
	utils.TextResponse(w, http.StatusOK, "认证成功")
}

// PutAuth 处理 PUT /auth
// 用于修改密码
func PutAuth(w http.ResponseWriter, r *http.Request) {
	playerID := middleware.GetPlayerID(r)
	if playerID == "" {
		utils.ErrorResponse(w, http.StatusUnauthorized, "未认证")
		return
	}

	// 读取新密码
	body, err := io.ReadAll(r.Body)
	if err != nil {
		utils.ErrorResponse(w, http.StatusBadRequest, "读取请求体失败")
		return
	}
	defer func(Body io.ReadCloser) { _ = Body.Close() }(r.Body)

	newPassword := string(body)
	if newPassword == "" {
		utils.ErrorResponse(w, http.StatusBadRequest, "密码不能为空")
		return
	}

	ip := utils.GetClientIP(r)

	// 更新密码
	if err := database.UpdatePlayerPassword(r.Context(), playerID, newPassword, ip); err != nil {
		utils.ErrorResponse(w, http.StatusInternalServerError, "更新密码失败")
		return
	}

	utils.TextResponse(w, http.StatusOK, "密码已更新")
}
