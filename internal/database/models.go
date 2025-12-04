// Package database 提供数据库操作功能
package database

import (
	"encoding/json"
	"time"
)

// Player 玩家模型
type Player struct {
	PlayerID  string    `json:"playerId"`
	Password  string    `json:"password,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Whitelist bool      `json:"whitelist"`
	Remark    string    `json:"remark"`
	CreateIP  string    `json:"createIp,omitempty"`
	UpdateIP  string    `json:"updateIp,omitempty"`
}

// Game 游戏模型
type Game struct {
	GameID    string    `json:"gameId"`
	Players   []string  `json:"players"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Whitelist bool      `json:"whitelist"`
	Remark    string    `json:"remark"`
}

// FileContent 游戏内容模型
type FileContent struct {
	ID            int64           `json:"id"`
	GameID        string          `json:"gameId"`
	Turns         int             `json:"turns"`
	CreatedPlayer string          `json:"createdPlayer"`
	CreatedIP     string          `json:"createdIp,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	Data          json.RawMessage `json:"data"`
}

// FilePreview 游戏预览模型
type FilePreview struct {
	ID            int64           `json:"id"`
	GameID        string          `json:"gameId"`
	Turns         int             `json:"turns"`
	CreatedPlayer string          `json:"createdPlayer"`
	CreatedIP     string          `json:"createdIp,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	Data          json.RawMessage `json:"data"`
}

// GameWithTurns 游戏及其回合数
type GameWithTurns struct {
	Game
	Turns         int    `json:"turns"`
	CreatedPlayer string `json:"createdPlayer"`
}

// PlayerWithGames 玩家及其游戏数量统计
type PlayerWithGames struct {
	Player
	GameCount int `json:"gameCount"`
}
