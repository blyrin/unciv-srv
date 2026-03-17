package handler

import (
	"context"
	"encoding/json"
	"net/http"

	"unciv-srv/internal/middleware"
	"unciv-srv/pkg/utils"
)

const (
	testPlayerID1 = "00000000-0000-0000-0000-000000000001"
	testPlayerID2 = "00000000-0000-0000-0000-000000000002"
	testPlayerID3 = "00000000-0000-0000-0000-000000000003"
	testGameID1   = "11111111-1111-1111-1111-111111111111"
	testGameID2   = "22222222-2222-2222-2222-222222222222"
	testGameID3   = "33333333-3333-3333-3333-333333333333"
	testPassword  = "testpass123"
)

// withPlayerID 向请求上下文注入玩家ID
func withPlayerID(r *http.Request, playerID string) *http.Request {
	ctx := context.WithValue(r.Context(), middleware.PlayerIDKey, playerID)
	return r.WithContext(ctx)
}

// withSession 向请求上下文注入 session 信息
func withSession(r *http.Request, userID string, isAdmin bool) *http.Request {
	ctx := context.WithValue(r.Context(), middleware.SessionUserIDKey, userID)
	ctx = context.WithValue(ctx, middleware.SessionIsAdminKey, isAdmin)
	return r.WithContext(ctx)
}

// withGameID 向请求上下文注入游戏ID和预览标志
func withGameID(r *http.Request, gameID string, isPreview bool) *http.Request {
	ctx := context.WithValue(r.Context(), middleware.GameIDKey, gameID)
	ctx = context.WithValue(ctx, middleware.IsPreviewKey, isPreview)
	return r.WithContext(ctx)
}

// buildGameData 构造合法游戏存档数据并编码
func buildGameData(gameID string, turns int, playerIDs []string) string {
	players := make([]map[string]string, 0, len(playerIDs))
	for _, id := range playerIDs {
		players = append(players, map[string]string{
			"playerId":   id,
			"playerType": "Human",
		})
	}

	data := map[string]any{
		"gameId": gameID,
		"turns":  turns,
		"gameParameters": map[string]any{
			"players": players,
		},
	}

	jsonData, _ := json.Marshal(data)
	encoded, _ := utils.EncodeFile(json.RawMessage(jsonData))
	return encoded
}
