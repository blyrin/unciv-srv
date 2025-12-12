package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"unciv-srv/internal/database"
	"unciv-srv/internal/middleware"

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

// peerConn 封装 WebSocket 连接和写锁，保证并发写入安全
type peerConn struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

// sendJSON 安全发送 JSON 消息
func (p *peerConn) sendJSON(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		slog.Error("JSON序列化失败", "error", err)
		return
	}
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if err := p.conn.WriteMessage(websocket.TextMessage, data); err != nil {
		slog.Error("WebSocket写入失败", "error", err)
	}
}

// sendError 发送错误消息
func (p *peerConn) sendError(message string) {
	response := ChatErrorResponse{
		Type:    TypeError,
		Message: message,
	}
	p.sendJSON(response)
}

// 玩家连接管理
var (
	playerPeers   = make(map[string]map[*peerConn]bool)
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

	// 设置消息大小限制（512KB）
	conn.SetReadLimit(512 * 1024)

	// 设置读取超时
	if err := conn.SetReadDeadline(time.Now().Add(60 * time.Second)); err != nil {
		slog.Error("设置读取超时失败", "error", err)
	}
	conn.SetPongHandler(func(string) error {
		if err := conn.SetReadDeadline(time.Now().Add(60 * time.Second)); err != nil {
			slog.Error("设置读取超时失败", "error", err)
		}
		return nil
	})

	slog.Info("WebSocket连接已建立", "playerId", playerID)

	// 创建封装的连接
	peer := &peerConn{conn: conn}

	// 注册连接
	registerPeer(playerID, peer)
	defer unregisterPeer(playerID, peer)

	// 启动心跳 goroutine
	done := make(chan struct{})
	defer close(done)
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				peer.writeMu.Lock()
				if err := conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(10*time.Second)); err != nil {
					peer.writeMu.Unlock()
					return
				}
				peer.writeMu.Unlock()
			case <-done:
				return
			}
		}
	}()

	// 消息处理循环
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Error("WebSocket读取错误", "playerId", playerID, "error", err)
			}
			break
		}

		// 解析消息
		var msg GenericMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			peer.sendError("无效的消息格式")
			continue
		}

		// 处理不同类型的消息
		switch msg.Type {
		case TypeJoin:
			handleJoin(peer, playerID, msg.GameIDs)
		case TypeLeave:
			handleLeave(peer, playerID, msg.GameIDs)
		case TypeChat:
			handleChat(peer, playerID, msg)
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

	return middleware.ValidatePlayer(ctx, playerID, password)
}

// registerPeer 注册连接
func registerPeer(playerID string, peer *peerConn) {
	playerPeersMu.Lock()
	defer playerPeersMu.Unlock()

	if playerPeers[playerID] == nil {
		playerPeers[playerID] = make(map[*peerConn]bool)
	}
	playerPeers[playerID][peer] = true
}

// unregisterPeer 注销连接
func unregisterPeer(playerID string, peer *peerConn) {
	playerPeersMu.Lock()
	defer playerPeersMu.Unlock()

	if peers, ok := playerPeers[playerID]; ok {
		delete(peers, peer)
		if len(peers) == 0 {
			delete(playerPeers, playerID)
		}
	}
}

// handleJoin 处理加入消息
func handleJoin(peer *peerConn, playerID string, gameIDs []string) {
	slog.Info("玩家加入聊天", "playerId", playerID, "gameIds", gameIDs)

	response := JoinSuccessResponse{
		Type:    TypeJoinSuccess,
		GameIDs: gameIDs,
	}
	peer.sendJSON(response)
}

// handleLeave 处理离开消息
func handleLeave(_ *peerConn, playerID string, gameIDs []string) {
	slog.Info("玩家离开聊天", "playerId", playerID, "gameIds", gameIDs)
}

// handleChat 处理聊天消息
func handleChat(peer *peerConn, playerID string, msg GenericMessage) {
	slog.Info("聊天消息", "playerId", playerID, "gameId", msg.GameID, "civName", msg.CivName, "message", msg.Message)

	// 使用带超时的 context 避免潜在阻塞
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 获取游戏中的所有玩家
	game, err := database.GetGameByID(ctx, msg.GameID)
	if err != nil {
		slog.Error("获取游戏失败", "gameId", msg.GameID, "error", err)
		peer.sendError("发送消息失败")
		return
	}

	if game == nil {
		peer.sendError("游戏不存在")
		return
	}

	// 广播消息给游戏中的所有玩家
	response := ChatMessage{
		Type:    TypeChat,
		GameID:  msg.GameID,
		CivName: msg.CivName,
		Message: msg.Message,
	}

	// 在持有锁时收集需要发送的连接列表
	playerPeersMu.RLock()
	var targetPeers []*peerConn
	for _, pID := range game.Players {
		if peers, ok := playerPeers[pID]; ok {
			for peer := range peers {
				targetPeers = append(targetPeers, peer)
			}
		}
	}
	playerPeersMu.RUnlock()

	// 释放锁后再执行 IO 操作
	for _, peer := range targetPeers {
		peer.sendJSON(response)
	}
}
