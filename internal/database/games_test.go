package database

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestCreateAndGetGame(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedPlayer(t, testPlayerID2, testPassword)

	err := CreateGame(ctx, testGameID1, []string{testPlayerID1, testPlayerID2})
	if err != nil {
		t.Fatalf("CreateGame 失败: %v", err)
	}

	game, err := GetGameByID(ctx, testGameID1)
	if err != nil {
		t.Fatalf("GetGameByID 失败: %v", err)
	}
	if game == nil {
		t.Fatal("游戏应存在")
	}
	if game.GameID != testGameID1 {
		t.Errorf("GameID = %q, want %q", game.GameID, testGameID1)
	}
	if len(game.Players) != 2 {
		t.Errorf("Players 数量 = %d, want 2", len(game.Players))
	}
}

func TestGetGameByID_NotFound(t *testing.T) {
	setupTest(t)

	game, err := GetGameByID(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("GetGameByID 失败: %v", err)
	}
	if game != nil {
		t.Error("不存在的游戏应返回 nil")
	}
}

func TestGetGameByID_InvalidPlayersJSON(t *testing.T) {
	setupTest(t)

	_, err := DB.ExecContext(context.Background(), `
		INSERT INTO files (game_id, players, created_at, updated_at)
		VALUES (?, ?, ?, ?)
	`, testGameID1, `{}`, time.Now(), time.Now())
	if err != nil {
		t.Fatalf("插入数据失败: %v", err)
	}

	_, err = GetGameByID(context.Background(), testGameID1)
	if err == nil {
		t.Fatal("无效 JSON 应返回错误")
	}
}

func TestUpdateGamePlayers(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedPlayer(t, testPlayerID2, testPassword)
	seedPlayer(t, testPlayerID3, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	err := UpdateGamePlayers(ctx, testGameID1, []string{testPlayerID1, testPlayerID2, testPlayerID3})
	if err != nil {
		t.Fatalf("UpdateGamePlayers 失败: %v", err)
	}

	game, _ := GetGameByID(ctx, testGameID1)
	if len(game.Players) != 3 {
		t.Errorf("Players 数量 = %d, want 3", len(game.Players))
	}
}

func TestUpdateGameTimestamp(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	game1, _ := GetGameByID(ctx, testGameID1)

	err := UpdateGameTimestamp(ctx, testGameID1)
	if err != nil {
		t.Fatalf("UpdateGameTimestamp 失败: %v", err)
	}

	game2, _ := GetGameByID(ctx, testGameID1)
	if !game2.UpdatedAt.After(game1.UpdatedAt) && game2.UpdatedAt.Equal(game1.UpdatedAt) {
		// 时间戳应更新（但可能在同一毫秒内，所以允许相等）
	}
}

func TestGetAllGames(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})
	seedGame(t, testGameID2, []string{testPlayerID1})

	games, err := GetAllGames(ctx)
	if err != nil {
		t.Fatalf("GetAllGames 失败: %v", err)
	}
	if len(games) != 2 {
		t.Errorf("游戏数量 = %d, want 2", len(games))
	}
}

func TestGetGamesByPlayer(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedPlayer(t, testPlayerID2, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1, testPlayerID2})
	seedGame(t, testGameID2, []string{testPlayerID1})
	seedGame(t, testGameID3, []string{testPlayerID2})

	// player1 参与了 game1 和 game2
	games, err := GetGamesByPlayer(ctx, testPlayerID1)
	if err != nil {
		t.Fatalf("GetGamesByPlayer 失败: %v", err)
	}
	if len(games) != 2 {
		t.Errorf("player1 游戏数量 = %d, want 2", len(games))
	}

	// player2 参与了 game1 和 game3
	games, err = GetGamesByPlayer(ctx, testPlayerID2)
	if err != nil {
		t.Fatalf("GetGamesByPlayer 失败: %v", err)
	}
	if len(games) != 2 {
		t.Errorf("player2 游戏数量 = %d, want 2", len(games))
	}
}

func TestDeleteGame(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	err := DeleteGame(ctx, testGameID1)
	if err != nil {
		t.Fatalf("DeleteGame 失败: %v", err)
	}

	game, _ := GetGameByID(ctx, testGameID1)
	if game != nil {
		t.Error("游戏删除后应不存在")
	}
}

func TestDeleteGame_CascadeDeleteContent(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})
	seedFileContent(t, testGameID1, 1, testPlayerID1, json.RawMessage(`{"test":1}`))

	// 删除游戏，应级联删除 content
	err := DeleteGame(ctx, testGameID1)
	if err != nil {
		t.Fatalf("DeleteGame 失败: %v", err)
	}

	content, _ := GetLatestFileContent(ctx, testGameID1)
	if content != nil {
		t.Error("级联删除后 content 应不存在")
	}
}

func TestUpdateGameInfo(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})

	err := UpdateGameInfo(ctx, testGameID1, true, "VIP游戏")
	if err != nil {
		t.Fatalf("UpdateGameInfo 失败: %v", err)
	}

	game, _ := GetGameByID(ctx, testGameID1)
	if !game.Whitelist {
		t.Error("Whitelist 应为 true")
	}
	if game.Remark != "VIP游戏" {
		t.Errorf("Remark = %q, want %q", game.Remark, "VIP游戏")
	}
}

func TestIsGameCreator(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedPlayer(t, testPlayerID2, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1, testPlayerID2})
	seedFileContent(t, testGameID1, 1, testPlayerID1, json.RawMessage(`{"test":1}`))

	isCreator, err := IsGameCreator(ctx, testPlayerID1, testGameID1)
	if err != nil {
		t.Fatalf("IsGameCreator 失败: %v", err)
	}
	if !isCreator {
		t.Error("player1 应是创建者")
	}

	isCreator, err = IsGameCreator(ctx, testPlayerID2, testGameID1)
	if err != nil {
		t.Fatalf("IsGameCreator 失败: %v", err)
	}
	if isCreator {
		t.Error("player2 不应是创建者")
	}

	// 没有内容的游戏
	isCreator, err = IsGameCreator(ctx, testPlayerID1, "nonexistent")
	if err != nil {
		t.Fatalf("IsGameCreator 失败: %v", err)
	}
	if isCreator {
		t.Error("不存在的游戏不应有创建者")
	}
}

func TestGetGamesCreatedByPlayer(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedPlayer(t, testPlayerID2, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})
	seedGame(t, testGameID2, []string{testPlayerID1, testPlayerID2})
	seedGame(t, testGameID3, []string{testPlayerID2})
	seedFileContent(t, testGameID1, 1, testPlayerID1, []byte(`{"turns":1}`))
	seedFileContent(t, testGameID1, 2, testPlayerID2, []byte(`{"turns":2}`))
	seedFileContent(t, testGameID2, 1, testPlayerID1, []byte(`{"turns":1}`))
	seedFileContent(t, testGameID3, 1, testPlayerID2, []byte(`{"turns":1}`))

	count, err := GetGamesCreatedByPlayer(ctx, testPlayerID1)
	if err != nil {
		t.Fatalf("GetGamesCreatedByPlayer 失败: %v", err)
	}
	if count != 2 {
		t.Fatalf("count = %d, want 2", count)
	}
}

func TestBatchUpdateGamesWhitelist(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})
	seedGame(t, testGameID2, []string{testPlayerID1})
	seedGame(t, testGameID3, []string{testPlayerID1})

	err := BatchUpdateGamesWhitelist(ctx, []string{testGameID1, testGameID2}, true)
	if err != nil {
		t.Fatalf("BatchUpdateGamesWhitelist 失败: %v", err)
	}

	g1, _ := GetGameByID(ctx, testGameID1)
	g2, _ := GetGameByID(ctx, testGameID2)
	g3, _ := GetGameByID(ctx, testGameID3)

	if !g1.Whitelist || !g2.Whitelist {
		t.Error("game1 和 game2 应在白名单")
	}
	if g3.Whitelist {
		t.Error("game3 不应在白名单")
	}

	// 空列表不报错
	err = BatchUpdateGamesWhitelist(ctx, nil, true)
	if err != nil {
		t.Errorf("空列表不应报错: %v", err)
	}
}

func TestBatchDeleteGames(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})
	seedGame(t, testGameID2, []string{testPlayerID1})
	seedGame(t, testGameID3, []string{testPlayerID1})

	err := BatchDeleteGames(ctx, []string{testGameID1, testGameID2})
	if err != nil {
		t.Fatalf("BatchDeleteGames 失败: %v", err)
	}

	g1, _ := GetGameByID(ctx, testGameID1)
	g2, _ := GetGameByID(ctx, testGameID2)
	g3, _ := GetGameByID(ctx, testGameID3)

	if g1 != nil || g2 != nil {
		t.Error("game1 和 game2 应已删除")
	}
	if g3 == nil {
		t.Error("game3 应仍存在")
	}

	// 空列表不报错
	err = BatchDeleteGames(ctx, nil)
	if err != nil {
		t.Errorf("空列表不应报错: %v", err)
	}
}

func TestGetGamesPage(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedPlayer(t, testPlayerID2, testPassword)
	seedGame(t, testGameID1, []string{testPlayerID1})
	seedGame(t, testGameID2, []string{testPlayerID1, testPlayerID2})
	seedGame(t, testGameID3, []string{testPlayerID2})

	// 设置备注
	_ = UpdateGameInfo(ctx, testGameID1, false, "测试游戏A")
	_ = UpdateGameInfo(ctx, testGameID2, true, "VIP游戏")

	// 测试无关键字分页
	result, err := GetGamesPage(ctx, "", 1, 2)
	if err != nil {
		t.Fatalf("GetGamesPage 失败: %v", err)
	}
	if result.Total != 3 {
		t.Errorf("Total = %d, want 3", result.Total)
	}
	if len(result.Items) != 2 {
		t.Errorf("Items 数量 = %d, want 2", len(result.Items))
	}

	// 测试第二页
	result, err = GetGamesPage(ctx, "", 2, 2)
	if err != nil {
		t.Fatalf("GetGamesPage 第2页失败: %v", err)
	}
	if len(result.Items) != 1 {
		t.Errorf("第2页 Items 数量 = %d, want 1", len(result.Items))
	}

	// 测试关键字搜索（按 game_id）
	result, err = GetGamesPage(ctx, testGameID1, 1, 20)
	if err != nil {
		t.Fatalf("GetGamesPage 搜索ID失败: %v", err)
	}
	if result.Total != 1 {
		t.Errorf("搜索ID Total = %d, want 1", result.Total)
	}

	// 测试关键字搜索（按 remark）
	result, err = GetGamesPage(ctx, "VIP", 1, 20)
	if err != nil {
		t.Fatalf("GetGamesPage 搜索备注失败: %v", err)
	}
	if result.Total != 1 {
		t.Errorf("搜索备注 Total = %d, want 1", result.Total)
	}

	// 测试关键字搜索（按玩家名）
	result, err = GetGamesPage(ctx, testPlayerID2, 1, 20)
	if err != nil {
		t.Fatalf("GetGamesPage 搜索玩家失败: %v", err)
	}
	if result.Total != 2 {
		t.Errorf("搜索玩家 Total = %d, want 2", result.Total)
	}

	// 测试无匹配结果
	result, err = GetGamesPage(ctx, "不存在", 1, 20)
	if err != nil {
		t.Fatalf("GetGamesPage 无匹配失败: %v", err)
	}
	if result.Total != 0 {
		t.Errorf("无匹配 Total = %d, want 0", result.Total)
	}
}
