package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"

	"unciv-srv/internal/database"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// MessageType 消息类型定义
type MessageType string

const (
	TypeJoin        MessageType = "join"
	TypeLeave       MessageType = "leave"
	TypeChat        MessageType = "chat"
	TypeJoinSuccess MessageType = "joinSuccess"
	TypeError       MessageType = "error"
)

// ChatMessage 聊天消息
type ChatMessage struct {
	Type    MessageType `json:"type"`
	GameID  string      `json:"gameId,omitempty"`
	CivName string      `json:"civName,omitempty"`
	Message string      `json:"message,omitempty"`
}

// JoinMessage 加入消息
type JoinMessage struct {
	Type    MessageType `json:"type"`
	GameIDs []string    `json:"gameIds"`
}

// LeaveMessage 离开消息
type LeaveMessage struct {
	Type    MessageType `json:"type"`
	GameIDs []string    `json:"gameIds"`
}

// JoinSuccessResponse 加入成功响应
type JoinSuccessResponse struct {
	Type    MessageType `json:"type"`
	GameIDs []string    `json:"gameIds"`
}

// ChatErrorResponse 错误响应
type ChatErrorResponse struct {
	Type    MessageType `json:"type"`
	Message string      `json:"message"`
}

// GenericMessage 通用消息（用于解析类型）
type GenericMessage struct {
	Type    MessageType `json:"type"`
	GameID  string      `json:"gameId,omitempty"`
	GameIDs []string    `json:"gameIds,omitempty"`
	CivName string      `json:"civName,omitempty"`
	Message string      `json:"message,omitempty"`
}

// 玩家连接管理
var (
	playerPeers   = make(map[string]map[*websocket.Conn]bool)
	playerPeersMu sync.RWMutex
)

// ChatWebSocket 处理 WebSocket 聊天连接
func ChatWebSocket(w http.ResponseWriter, r *http.Request) {
	// 解析认证信息
	playerID, err := parseWebSocketAuth(r.Context(), r)
	if err != nil {
		slog.Error("WebSocket认证失败", "error", err)
		http.Error(w, "认证失败", http.StatusUnauthorized)
		return
	}

	// 升级为 WebSocket 连接
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("WebSocket升级失败", "error", err)
		return
	}
	defer func(conn *websocket.Conn) { _ = conn.Close() }(conn)

	slog.Info("WebSocket连接已建立", "playerId", playerID)

	// 注册连接
	registerPeer(playerID, conn)
	defer unregisterPeer(playerID, conn)

	// 消息处理循环
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Error("WebSocket读取错误", "playerId", playerID, "error", err)
			}
			break
		}

		// 处理 ping 消息
		if string(message) == "ping" {
			_ = conn.WriteMessage(websocket.TextMessage, []byte("pong"))
			continue
		}

		// 解析消息
		var msg GenericMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			sendError(conn, "无效的消息格式")
			continue
		}

		// 处理不同类型的消息
		switch msg.Type {
		case TypeJoin:
			handleJoin(conn, playerID, msg.GameIDs)
		case TypeLeave:
			handleLeave(conn, playerID, msg.GameIDs)
		case TypeChat:
			handleChat(playerID, msg)
		default:
			slog.Warn("未知消息类型", "playerId", playerID, "type", msg.Type)
		}
	}

	slog.Info("WebSocket连接已关闭", "playerId", playerID)
}

// parseWebSocketAuth 解析 WebSocket 认证信息
func parseWebSocketAuth(ctx context.Context, r *http.Request) (string, error) {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return "", nil
	}

	if !strings.HasPrefix(auth, "Basic ") {
		return "", nil
	}

	payload, err := base64.StdEncoding.DecodeString(auth[6:])
	if err != nil {
		return "", err
	}

	pair := string(payload)
	colonIdx := strings.Index(pair, ":")
	if colonIdx < 0 {
		return "", nil
	}

	playerID := pair[:colonIdx]
	password := pair[colonIdx+1:]

	// 验证 UUID 格式
	if _, err := uuid.Parse(playerID); err != nil {
		return "", err
	}

	// 验证玩家
	player, err := database.GetPlayerByID(ctx, playerID)
	if err != nil {
		return "", err
	}

	if player == nil || player.Password != password {
		return "", nil
	}

	return playerID, nil
}

// registerPeer 注册连接
func registerPeer(playerID string, conn *websocket.Conn) {
	playerPeersMu.Lock()
	defer playerPeersMu.Unlock()

	if playerPeers[playerID] == nil {
		playerPeers[playerID] = make(map[*websocket.Conn]bool)
	}
	playerPeers[playerID][conn] = true
}

// unregisterPeer 注销连接
func unregisterPeer(playerID string, conn *websocket.Conn) {
	playerPeersMu.Lock()
	defer playerPeersMu.Unlock()

	if peers, ok := playerPeers[playerID]; ok {
		delete(peers, conn)
		if len(peers) == 0 {
			delete(playerPeers, playerID)
		}
	}
}

// handleJoin 处理加入消息
func handleJoin(conn *websocket.Conn, playerID string, gameIDs []string) {
	slog.Info("玩家加入聊天", "playerId", playerID, "gameIds", gameIDs)

	response := JoinSuccessResponse{
		Type:    TypeJoinSuccess,
		GameIDs: gameIDs,
	}
	sendJSON(conn, response)
}

// handleLeave 处理离开消息
func handleLeave(_ *websocket.Conn, playerID string, gameIDs []string) {
	slog.Info("玩家离开聊天", "playerId", playerID, "gameIds", gameIDs)
}

// handleChat 处理聊天消息
func handleChat(playerID string, msg GenericMessage) {
	slog.Info("聊天消息", "playerId", playerID, "gameId", msg.GameID, "civName", msg.CivName, "message", msg.Message)

	// 获取游戏中的所有玩家
	game, err := database.GetGameByID(context.Background(), msg.GameID)
	if err != nil {
		slog.Error("获取游戏失败", "gameId", msg.GameID, "error", err)
		return
	}

	if game == nil {
		return
	}

	// 广播消息给游戏中的所有玩家
	response := ChatMessage{
		Type:    TypeChat,
		GameID:  msg.GameID,
		CivName: msg.CivName,
		Message: msg.Message,
	}

	playerPeersMu.RLock()
	defer playerPeersMu.RUnlock()

	for _, pID := range game.Players {
		if peers, ok := playerPeers[pID]; ok {
			for conn := range peers {
				sendJSON(conn, response)
			}
		}
	}
}

// sendJSON 发送 JSON 消息
func sendJSON(conn *websocket.Conn, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		slog.Error("JSON序列化失败", "error", err)
		return
	}
	_ = conn.WriteMessage(websocket.TextMessage, data)
}

// sendError 发送错误消息
func sendError(conn *websocket.Conn, message string) {
	response := ChatErrorResponse{
		Type:    TypeError,
		Message: message,
	}
	sendJSON(conn, response)
}
