package utils

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
)

// GameIDRegex 游戏ID正则表达式
var GameIDRegex = regexp.MustCompile(`^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}(_Preview)?$`)

// MaxBodySize 最大请求体大小 (10MB)
const MaxBodySize = 10 * 1024 * 1024

// DecodeFile 解码游戏存档文件
// 输入: Base64 编码的 Gzip 压缩数据
// 输出: JSON 数据
func DecodeFile(encoded string) (json.RawMessage, error) {
	if encoded == "" {
		return nil, fmt.Errorf("空的文件数据")
	}

	// Base64 解码
	compressed, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("base64解码失败: %w", err)
	}

	// Gzip 解压
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, fmt.Errorf("gzip解压初始化失败: %w", err)
	}
	defer func(reader *gzip.Reader) { _ = reader.Close() }(reader)

	decompressed, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("gzip解压失败: %w", err)
	}

	// 验证 JSON 格式
	if !json.Valid(decompressed) {
		return nil, fmt.Errorf("无效的JSON格式")
	}

	return decompressed, nil
}

// EncodeFile 编码游戏存档文件
// 输入: JSON 数据
// 输出: Base64 编码的 Gzip 压缩数据
func EncodeFile(data json.RawMessage) (string, error) {
	// Gzip 压缩
	var buf bytes.Buffer
	writer := gzip.NewWriter(&buf)
	defer func(writer *gzip.Writer) { _ = writer.Close() }(writer)

	if _, err := writer.Write(data); err != nil {
		return "", fmt.Errorf("gzip压缩失败: %w", err)
	}

	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("gzip关闭失败: %w", err)
	}

	// Base64 编码
	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

// GameData 游戏数据结构（用于解析关键字段）
type GameData struct {
	GameID         string          `json:"gameId"`
	Turns          int             `json:"turns"`
	GameParameters *GameParameters `json:"gameParameters"`
}

// GameParameters 游戏参数
type GameParameters struct {
	Players []PlayerInfo `json:"players"`
}

// PlayerInfo 玩家信息
type PlayerInfo struct {
	PlayerID   string `json:"playerId"`
	PlayerType string `json:"playerType"`
}

// ParseGameData 解析游戏数据
func ParseGameData(data json.RawMessage) (*GameData, error) {
	var gameData GameData
	if err := json.Unmarshal(data, &gameData); err != nil {
		return nil, fmt.Errorf("解析游戏数据失败: %w", err)
	}
	return &gameData, nil
}

// GetPlayerIDsFromGameData 从游戏数据中获取人类玩家ID列表
func GetPlayerIDsFromGameData(data json.RawMessage) ([]string, error) {
	gameData, err := ParseGameData(data)
	if err != nil {
		return nil, err
	}

	var playerIDs []string
	if gameData.GameParameters != nil {
		for _, player := range gameData.GameParameters.Players {
			if player.PlayerType == "Human" && player.PlayerID != "" {
				playerIDs = append(playerIDs, player.PlayerID)
			}
		}
	}

	return playerIDs, nil
}

// ValidateGameID 验证游戏ID格式
func ValidateGameID(gameID string) bool {
	return GameIDRegex.MatchString(gameID)
}

// IsPreviewID 检查是否是预览ID
func IsPreviewID(gameID string) bool {
	return len(gameID) > 8 && gameID[len(gameID)-8:] == "_Preview"
}

// GetBaseGameID 获取基础游戏ID（去除_Preview后缀）
func GetBaseGameID(gameID string) string {
	if IsPreviewID(gameID) {
		return gameID[:len(gameID)-8]
	}
	return gameID
}
