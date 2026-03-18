package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"unciv-srv/internal/database"

	"github.com/gorilla/websocket"
)

func resetChatPeers() {
	playerPeersMu.Lock()
	defer playerPeersMu.Unlock()
	playerPeers = make(map[string]map[*peerConn]bool)
}

func setupChatTest(t *testing.T) {
	t.Helper()
	setupHandlerTest(t)
	resetChatPeers()
	t.Cleanup(resetChatPeers)
}

func createChatPlayer(t *testing.T, playerID string) {
	t.Helper()
	if err := database.CreatePlayer(context.Background(), playerID, testPassword, "127.0.0.1"); err != nil {
		t.Fatalf("CreatePlayer 失败: %v", err)
	}
}

func dialChat(t *testing.T, serverURL, auth string) (*websocket.Conn, *http.Response) {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(serverURL, "http") + "/chat"
	header := http.Header{}
	if auth != "" {
		header.Set("Authorization", auth)
	}
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		if resp != nil {
			return nil, resp
		}
		t.Fatalf("Dial 失败: %v", err)
	}
	return conn, resp
}

func readChatMessage(t *testing.T, conn *websocket.Conn) GenericMessage {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline 失败: %v", err)
	}
	var msg GenericMessage
	if err := conn.ReadJSON(&msg); err != nil {
		t.Fatalf("ReadJSON 失败: %v", err)
	}
	return msg
}

func TestParseWebSocketAuth(t *testing.T) {
	setupChatTest(t)
	createChatPlayer(t, testPlayerID1)

	t.Run("缺少认证头", func(t *testing.T) {
		r := httptest.NewRequest("GET", "/chat", nil)
		_, err := parseWebSocketAuth(context.Background(), r)
		if err == nil {
			t.Fatal("应返回错误")
		}
	})

	t.Run("无效格式", func(t *testing.T) {
		r := httptest.NewRequest("GET", "/chat", nil)
		r.Header.Set("Authorization", "Bearer token")
		_, err := parseWebSocketAuth(context.Background(), r)
		if err == nil {
			t.Fatal("应返回错误")
		}
	})

	t.Run("无效 base64", func(t *testing.T) {
		r := httptest.NewRequest("GET", "/chat", nil)
		r.Header.Set("Authorization", "Basic !!!")
		_, err := parseWebSocketAuth(context.Background(), r)
		if err == nil {
			t.Fatal("应返回错误")
		}
	})

	t.Run("认证成功", func(t *testing.T) {
		payload := base64.StdEncoding.EncodeToString([]byte(testPlayerID1 + ":" + testPassword))
		r := httptest.NewRequest("GET", "/chat", nil)
		r.Header.Set("Authorization", "Basic "+payload)
		playerID, err := parseWebSocketAuth(context.Background(), r)
		if err != nil {
			t.Fatalf("parseWebSocketAuth 失败: %v", err)
		}
		if playerID != testPlayerID1 {
			t.Fatalf("playerID = %q, want %q", playerID, testPlayerID1)
		}
	})
}

func TestChatWebSocket_Unauthorized(t *testing.T) {
	setupChatTest(t)

	server := httptest.NewServer(http.HandlerFunc(ChatWebSocket))
	defer server.Close()

	_, resp := dialChat(t, server.URL, "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("状态码 = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
}

func TestChatWebSocket_JoinAndBroadcast(t *testing.T) {
	setupChatTest(t)
	ctx := context.Background()
	createChatPlayer(t, testPlayerID1)
	createChatPlayer(t, testPlayerID2)

	if err := database.CreateGame(ctx, testGameID1, []string{testPlayerID1, testPlayerID2}); err != nil {
		t.Fatalf("CreateGame 失败: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(ChatWebSocket))
	defer server.Close()

	auth1 := "Basic " + base64.StdEncoding.EncodeToString([]byte(testPlayerID1+":"+testPassword))
	auth2 := "Basic " + base64.StdEncoding.EncodeToString([]byte(testPlayerID2+":"+testPassword))

	conn1, _ := dialChat(t, server.URL, auth1)
	defer func() { _ = conn1.Close() }()
	conn2, _ := dialChat(t, server.URL, auth2)
	defer func() { _ = conn2.Close() }()

	if err := conn1.WriteJSON(JoinMessage{Type: TypeJoin, GameIDs: []string{testGameID1}}); err != nil {
		t.Fatalf("WriteJSON join 失败: %v", err)
	}
	joinResp := readChatMessage(t, conn1)
	if joinResp.Type != TypeJoinSuccess {
		t.Fatalf("joinResp.Type = %q, want %q", joinResp.Type, TypeJoinSuccess)
	}

	if err := conn1.WriteJSON(ChatMessage{
		Type:    TypeChat,
		GameID:  testGameID1,
		CivName: "Rome",
		Message: "hello",
	}); err != nil {
		t.Fatalf("WriteJSON chat 失败: %v", err)
	}

	msg1 := readChatMessage(t, conn1)
	msg2 := readChatMessage(t, conn2)
	if msg1.Type != TypeChat || msg2.Type != TypeChat {
		t.Fatalf("广播类型异常: msg1=%q msg2=%q", msg1.Type, msg2.Type)
	}
	if msg2.Message != "hello" {
		t.Fatalf("接收消息 = %q, want hello", msg2.Message)
	}
}

func TestChatWebSocket_InvalidMessageAndMissingGame(t *testing.T) {
	setupChatTest(t)
	createChatPlayer(t, testPlayerID1)

	server := httptest.NewServer(http.HandlerFunc(ChatWebSocket))
	defer server.Close()

	auth := "Basic " + base64.StdEncoding.EncodeToString([]byte(testPlayerID1+":"+testPassword))
	conn, _ := dialChat(t, server.URL, auth)
	defer func() { _ = conn.Close() }()

	if err := conn.WriteMessage(websocket.TextMessage, []byte("{")); err != nil {
		t.Fatalf("WriteMessage 失败: %v", err)
	}
	msg := readChatMessage(t, conn)
	if msg.Type != TypeError || msg.Message != "无效的消息格式" {
		t.Fatalf("msg = %#v, want error", msg)
	}

	if err := conn.WriteJSON(ChatMessage{
		Type:    TypeChat,
		GameID:  testGameID3,
		CivName: "Rome",
		Message: "hello",
	}); err != nil {
		t.Fatalf("WriteJSON 失败: %v", err)
	}
	msg = readChatMessage(t, conn)
	if msg.Type != TypeError || msg.Message != "游戏不存在" {
		t.Fatalf("msg = %#v, want 游戏不存在", msg)
	}
}

func TestHandleChat_DBError(t *testing.T) {
	setupChatTest(t)
	createChatPlayer(t, testPlayerID1)

	server := httptest.NewServer(http.HandlerFunc(ChatWebSocket))
	defer server.Close()

	auth := "Basic " + base64.StdEncoding.EncodeToString([]byte(testPlayerID1+":"+testPassword))
	conn, _ := dialChat(t, server.URL, auth)
	defer func() { _ = conn.Close() }()

	if err := database.DB.Close(); err != nil {
		t.Fatalf("关闭数据库失败: %v", err)
	}
	if err := conn.WriteJSON(ChatMessage{
		Type:    TypeChat,
		GameID:  testGameID1,
		CivName: "Rome",
		Message: "hello",
	}); err != nil {
		t.Fatalf("WriteJSON 失败: %v", err)
	}

	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline 失败: %v", err)
	}
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage 失败: %v", err)
	}

	var msg GenericMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("Unmarshal 失败: %v", err)
	}
	if msg.Type != TypeError || msg.Message != "发送消息失败" {
		t.Fatalf("msg = %#v, want 发送消息失败", msg)
	}
}
